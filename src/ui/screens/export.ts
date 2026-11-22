/**
 * Export: an audio file → a video of sonora reacting to it, rendered offline
 * (deterministic, in audio time) and saved to Videos\sonora. Pick the file,
 * the section (whole track, or a window on the song strip snapped to bars,
 * with three suggestions), the visual (single style, styles tour, beat switch,
 * showcase; style, look, view, palette with album colours and custom hue),
 * text (title card, lines, now playing), and the output (aspect, resolution,
 * frame rate, quality, the corner the mark sits in, the outro). The preview
 * plays the plan with the song in the chosen aspect, overlays drawn by the
 * same code the export uses. Desktop only (the web page hides the entry).
 */

import { paletteFromArt } from '../../app/album-colours';
import type { Palette } from '../../engine/color-engine';
import { presetsFor } from '../../styles/registry';
import type { StyleId } from '../../styles/visual-style';
import { WINDOW_LENGTHS } from '../../export/analysis';
import type { Sink } from '../../export/mp4';
import { renderExport, type AacEncoderLike, type ExportProgress, type ExportSettings } from '../../export/offline';
import { FONTS, OUTRO_S, type Corner, type FontId, type OverlaySpec, type TextCase, type TextOverlay, type TextPos, type TextSize } from '../../export/overlay';
import { buildPlan, COMBOS, PALETTE_NAMES, snapToBar, styleLine, type PalettePick, type Plan, type StudioState } from '../../export/plan-lib.mjs';
import { createPreview, type Preview } from '../../export/preview';
import { loadSong, type Song } from '../../export/song';
import { button, segmented, select, slider, toggle } from '../ds/components';
import { h } from '../ds/dom';
import { lockup } from './brand';
import './export.css';


// ── Tuning ──────────────────────────────────────────────────────
/** Render long side cap for Best (supersampled) quality (px). */
const BEST_MAX_LONG = 5120;
/** Best quality's render scale (before the cap). */
const BEST_SCALE = 1.5;
/** Preferences are kept in local storage under this key. */
const PREFS_KEY = 'sonora.export.v1';

export interface ExportIo {
  sink(name: string): Promise<Sink & { free: number }>;
  aac(sampleRate: number, channels: number, kbps: number): Promise<AacEncoderLike>;
  reveal(path: string): void;
}

export interface ExportScreen { el: HTMLElement; show(): void; hide(): void; busy(): boolean }

type Aspect = '16:9' | '9:16' | '1:1' | '4:5';
type Res = '720' | '1080' | '1440' | '2160';
type Format = 'song' | 'tour' | 'beatswitch' | 'showcase';

interface Prefs {
  format: Format; combo: string; palette: PalettePick; camera: string; combo2: string; palette2: PalettePick;
  showcase: 'palettes' | 'looks'; tour: { combos: string[]; every: number };
  title: 'off' | 'reel' | 'cinematic'; titleIn: number; titleOut: number; nowPlaying: boolean;
  aspect: Aspect; res: Res; fps: 30 | 60; quality: 'standard' | 'best'; corner: Corner; outro: boolean; length: number;
}
const DEFAULTS: Prefs = {
  format: 'song', combo: 'ink-glow-depth', palette: 0, camera: 'glide', combo2: 'voyage-void', palette2: 0,
  showcase: 'palettes', tour: { combos: ['silk-depth', 'ink-glow-depth', 'wisp-tunnel', 'warp', 'voyage-void'], every: 2 },
  title: 'reel', titleIn: 0, titleOut: 4, nowPlaying: false,
  aspect: '16:9', res: '1080', fps: 60, quality: 'standard', corner: 'br', outro: true, length: 30,
};

/** Output size for an aspect and a resolution (the short side; 4K = 2160). */
export function outputSize(a: Aspect, r: Res): [number, number] {
  const s = Number(r);
  const even = (x: number): number => Math.round(x / 2) * 2;
  if (a === '16:9') return [even((s * 16) / 9), s];
  if (a === '9:16') return [s, even((s * 16) / 9)];
  if (a === '1:1') return [s, s];
  return [s, even((s * 5) / 4)];
}

const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;
const fmtEta = (s: number): string => (s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min` : s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.max(1, Math.round(s))} s`);

export function createExport(io: ExportIo, on: { back(): void }): ExportScreen {
  const prefs: Prefs = { ...DEFAULTS, ...(() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Prefs>; } catch { return {}; } })() };
  const savePrefs = (): void => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* private mode */ } };

  let song: Song | null = null;
  let album: Palette | null = null;
  let whole = false;
  let win = { start: 30, end: 60 };
  let switchAt: number | undefined;
  let pickSwitch = false;
  let titleText = '', artistText = '';
  const texts: (TextOverlay & { snap: boolean })[] = [];
  let rendering: AbortController | null = null;
  let preview: Preview | null = null;
  let playhead = -1;

  // ── Layout ──
  const backBtn = button('Menu', { variant: 'ghost', icon: 'arrowLeft', onClick: () => leave() });
  const top = h('header', { class: 'topbar' }, h('div', { style: { display: 'flex', alignItems: 'center', gap: '28px' } }, lockup(), backBtn), h('span', { class: 's-label' }, 'export a video'));
  const colL = h('div', { class: 'ex-left' });
  const pvBox = h('div', { class: 'ex-pv' });
  const pvWrap = h('div', { class: 'ex-pv-wrap' }, pvBox);
  const pvBar = h('div', { class: 'ex-pv-bar' });
  const pvNote = h('span', { class: 's-micro' });
  const colR = h('div', { class: 'ex-right' }, pvWrap, pvBar, pvNote);
  const el = h('section', { class: 'scr scr-export s-root', hidden: true, 'aria-label': 'Export' }, top, h('div', { class: 'ex-wrap' }, colL, colR));

  const secSong = h('section', { class: 'ex-sec' });
  const secPart = h('section', { class: 'ex-sec' });
  const secVisual = h('section', { class: 'ex-sec' });
  const secText = h('section', { class: 'ex-sec' });
  const secOut = h('section', { class: 'ex-sec' });
  const secGo = h('section', { class: 'ex-sec ex-go' });
  colL.append(secSong, secPart, secVisual, secText, secOut, secGo);

  const head = (n: string, title: string, note?: Node | string | null): HTMLElement => h('div', { class: 'ex-head' }, h('span', { class: 's-label s-bone' }, `${n} · ${title}`), note ? (typeof note === 'string' ? h('span', { class: 's-micro' }, note) : note) : null);
  const row = (label: string, ...c: (Node | null | false)[]): HTMLElement => h('div', { class: 'ex-row' }, h('span', { class: 's-micro ex-rl' }, label), h('div', { class: 'ex-rc' }, ...c.filter((x): x is Node => !!x)));

  // ── 1 · The song ──
  const fileInput = h('input', { type: 'file', accept: '.mp3,.wav,.flac,.m4a,.aac,.ogg,.oga,.opus,.mp4,.mov,.m4v,audio/*,video/mp4,video/quicktime', hidden: true });
  fileInput.addEventListener('change', () => { const f = fileInput.files?.[0]; if (f) void openFile(f); fileInput.value = ''; });
  const songStatus = h('span', { class: 's-micro' });
  function renderSong(): void {
    const pick = button(song ? 'Choose another' : 'Choose a file', { variant: song ? 'default' : 'primary', onClick: () => fileInput.click() });
    const info = song ? h('div', { class: 'ex-song' },
      song.cover ? h('img', { src: song.cover, alt: '' }) : h('i', { class: 'ex-nocover' }),
      h('div', { class: 'ex-song-t' },
        h('span', { class: 'ex-song-title' }, song.title || song.file),
        h('span', { class: 's-micro' }, [song.artist, song.album, `${fmt(song.duration)} · ${song.analysis.bpm.toFixed(0)} bpm`].filter(Boolean).join(' · ')))) : null;
    secSong.replaceChildren(...[head('01', 'the song', songStatus), h('div', { class: 'ex-row ex-row--song' }, info, pick, fileInput),
      song ? null : h('p', { class: 's-micro ex-note' }, 'mp3, wav, flac, m4a, ogg / opus, or the sound of an mp4 / mov. artwork in the file gives album colours.'),
      h('p', { class: 'ex-rights' }, 'only export music you have the rights to use.')].filter((x): x is HTMLElement => !!x));
  }

  async function openFile(f: File): Promise<void> {
    stopPreview();
    songStatus.textContent = 'reading…';
    try {
      song = await loadSong(f, (stage, p) => { songStatus.textContent = `${stage}${p > 0 ? ` ${Math.round(p * 100)}%` : '…'}`; });
    } catch (e) {
      songStatus.textContent = String(e instanceof Error ? e.message : e);
      return;
    }
    album = song.cover ? await paletteFromArt(song.cover).catch(() => null) : null;
    titleText = song.title; artistText = song.artist;
    const sug = song.analysis.suggestions[String(prefs.length)]?.[0] ?? song.analysis.suggestions['30']?.[0];
    win = sug ? { start: sug.start, end: sug.end } : { start: Math.min(30, song.duration / 3), end: Math.min(song.duration, Math.min(30, song.duration / 3) + 30) };
    whole = false;
    switchAt = undefined;
    songStatus.textContent = album ? 'album colours from the artwork' : song.cover ? 'artwork without strong colours' : '';
    renderAll();
  }

  // ── 2 · The section ──
  const stripCanvas = h('canvas', { class: 'ex-strip' });
  const winReadout = h('span', { class: 's-micro' });
  function windowNow(): { start: number; end: number } { return song ? (whole ? { start: 0, end: song.duration } : win) : win; }
  function drawStripNow(): void {
    if (!song) return;
    void import('../../export/strip').then(({ drawStrip }) => drawStrip(stripCanvas, song!.analysis, { window: windowNow(), playhead, marker: prefs.format === 'beatswitch' ? switchAt : undefined }));
    const w = windowNow();
    winReadout.textContent = `${fmt(w.start)} → ${fmt(w.end)} · ${(w.end - w.start).toFixed(1)} s · ${song.analysis.bars.filter((b) => b >= w.start && b < w.end).length} bars`;
  }
  function setWindow(start: number, len: number): void {
    if (!song) return;
    const bars = song.analysis.bars;
    const s0 = snapToBar(Math.max(0, start), bars);
    const e = snapToBar(Math.min(song.duration - 0.2, s0 + len), bars);
    win = { start: s0, end: e > s0 + 1 ? e : Math.min(song.duration, s0 + len) };
    renderAll();
  }
  let drag: number | null = null;
  stripCanvas.addEventListener('pointerdown', (e) => {
    if (!song || whole) return;
    void import('../../export/strip').then(({ stripTime, stripPx }) => {
      const t = stripTime(stripCanvas, song!.analysis, e.clientX);
      if (pickSwitch) { switchAt = snapToBar(t, song!.analysis.bars); pickSwitch = false; renderAll(); return; }
      const drop = song!.analysis.events.find((ev) => ev.type === 'drop' && stripPx(stripCanvas, song!.analysis, ev.t - t) < 10);
      if (drop) { setWindow(drop.t - prefs.length * 0.3, prefs.length); return; }
      drag = t;
      stripCanvas.setPointerCapture(e.pointerId);
    });
  });
  stripCanvas.addEventListener('pointermove', (e) => {
    if (drag === null || !song) return;
    void import('../../export/strip').then(({ stripTime }) => {
      if (drag === null || !song) return;
      const x = stripTime(stripCanvas, song.analysis, e.clientX);
      win = { start: snapToBar(Math.min(drag, x), song.analysis.bars), end: snapToBar(Math.max(drag, x), song.analysis.bars) };
      drawStripNow();
    });
  });
  stripCanvas.addEventListener('pointerup', () => {
    if (drag === null) return;
    drag = null;
    if (win.end - win.start < 3) setWindow(win.start, prefs.length);
    else { prefs.length = Math.round(win.end - win.start); savePrefs(); renderAll(); }
  });
  function renderPart(): void {
    if (!song) { secPart.replaceChildren(head('02', 'the section'), h('p', { class: 's-micro ex-note' }, 'choose a song first.')); return; }
    const which = segmented([{ value: 'part', label: 'a part' }, { value: 'whole', label: 'the whole track' }], whole ? 'whole' : 'part', (v) => { whole = v === 'whole'; renderAll(); }, 'Section');
    const lens = segmented([...WINDOW_LENGTHS.map((v) => ({ value: String(v), label: `${v} s` })), { value: 'custom', label: 'custom' }], WINDOW_LENGTHS.includes(prefs.length) ? String(prefs.length) : 'custom', (v) => { if (v !== 'custom') { prefs.length = Number(v); savePrefs(); setWindow(win.start, prefs.length); } }, 'Length');
    const custom = h('input', { type: 'number', min: 4, max: 600, value: Math.round(win.end - win.start), class: 'ex-num', 'aria-label': 'Length in seconds' });
    custom.addEventListener('change', () => { prefs.length = Math.max(4, Math.min(600, Number(custom.value) || 30)); savePrefs(); setWindow(win.start, prefs.length); });
    const sug = song.analysis.suggestions[String(prefs.length)] ?? song.analysis.suggestions['30'] ?? [];
    secPart.replaceChildren(...[head('02', 'the section', winReadout), row('take', which.el),
      whole ? null : h('div', { class: 'ex-strip-wrap' }, stripCanvas, h('div', { class: 's-micro ex-legend' }, 'click a drop · drag to choose · ends snap to bars')),
      whole ? null : row('length', lens.el, custom),
      whole ? null : row('suggested', ...sug.map((s, i) => button(`${i + 1} · ${fmt(s.start)}`, { size: 'sm', title: s.why, onClick: () => { win = { start: s.start, end: s.end }; renderAll(); } })), sug[0] ? h('span', { class: 's-micro ex-why' }, sug[0].why) : null)].filter((x): x is HTMLElement => !!x));
    requestAnimationFrame(() => drawStripNow());
  }

  // ── 3 · The visual ──
  const comboOpts = COMBOS.map((c) => ({ value: c.id, label: c.label }));
  const palOpts = [{ value: 'album', label: 'album colours' }, ...PALETTE_NAMES.map((n, i) => ({ value: String(i), label: n })), { value: 'hue', label: 'custom hue' }, { value: 'drift', label: 'auto drift' }];
  const palValue = (p: PalettePick): string => (p === 'album' ? 'album' : typeof p === 'number' ? String(p) : 'hue' in p ? 'hue' : 'drift');
  const palFrom = (v: string, prev: PalettePick): PalettePick => (v === 'album' ? 'album' : v === 'hue' ? { hue: typeof prev === 'object' && 'hue' in prev ? prev.hue : 200 } : v === 'drift' ? { drift: true, index: typeof prev === 'number' ? prev : 0 } : Number(v));
  function palControls(p: PalettePick, set: (p: PalettePick) => void, label: string): Node[] {
    const sel = select(palOpts, palValue(p), (v) => { set(palFrom(v, p)); renderAll(); }, label).el;
    const out: Node[] = [sel];
    if (typeof p === 'object' && 'hue' in p) out.push(h('div', { class: 'ex-hue' }, slider({ min: 0, max: 360, value: p.hue, hue: true, ariaLabel: 'Hue', onInput: (v) => set({ hue: v }), onCommit: () => replay() }).el));
    if (p === 'album' && !album) out.push(h('span', { class: 's-micro ex-why' }, song?.cover ? 'this artwork gives no colours: ocean is used' : 'no artwork in the file: ocean is used'));
    return out;
  }
  function renderVisual(): void {
    const f = segmented<Format>([{ value: 'song', label: 'single style' }, { value: 'tour', label: 'styles tour' }, { value: 'beatswitch', label: 'beat switch' }, { value: 'showcase', label: 'showcase' }], prefs.format, (v) => {
      prefs.format = v; savePrefs();
      if (v === 'beatswitch' && song && switchAt === undefined) { const w = windowNow(); const d = song.analysis.events.find((e) => e.type === 'drop' && e.t > w.start && e.t < w.end); switchAt = snapToBar(d ? d.t : (w.start + w.end) / 2, song.analysis.bars); }
      renderAll();
    }, 'Format');
    const c0 = COMBOS.find((c) => c.id === prefs.combo) ?? COMBOS[0];
    const cam = prefs.format !== 'tour' && c0.depth && !(c0.style === 'wisp' && c0.variant === 'tunnel')
      ? select(presetsFor(c0.style as StyleId).map((p) => ({ value: p.id, label: p.label.toLowerCase() })), prefs.camera, (v) => { prefs.camera = v; savePrefs(); replay(); }, 'Camera').el : null;
    const rows: (HTMLElement | null)[] = [row('format', f.el)];
    if (prefs.format !== 'tour') rows.push(row('style', select(comboOpts, prefs.combo, (v) => { prefs.combo = v; savePrefs(); renderAll(); }, 'Style').el, cam));
    rows.push(row('palette', ...palControls(prefs.palette, (p) => { prefs.palette = p; savePrefs(); }, 'Palette')));
    if (prefs.format === 'beatswitch') {
      rows.push(row('then', select(comboOpts, prefs.combo2, (v) => { prefs.combo2 = v; savePrefs(); renderAll(); }, 'Second style').el));
      rows.push(row('its palette', ...palControls(prefs.palette2, (p) => { prefs.palette2 = p; savePrefs(); }, 'Second palette')));
      rows.push(row('switch on', h('span', { class: 's-micro' }, switchAt !== undefined ? fmt(switchAt) : '–'), button(pickSwitch ? 'click a bar on the strip…' : 'pick the bar', { size: 'sm', onClick: () => { pickSwitch = true; renderVisual(); } })));
    } else if (prefs.format === 'showcase') {
      rows.push(row('every bar', segmented([{ value: 'palettes', label: 'next palette' }, { value: 'looks', label: 'next look' }], prefs.showcase, (v) => { prefs.showcase = v; savePrefs(); replay(); }, 'Showcase').el));
    } else if (prefs.format === 'tour') {
      const box = h('div', { class: 'ex-checks' });
      for (const c of COMBOS) box.append(toggle(c.label, prefs.tour.combos.includes(c.id), (v) => { const l = prefs.tour.combos.filter((x) => x !== c.id); if (v) l.push(c.id); prefs.tour.combos = COMBOS.map((x) => x.id).filter((id) => l.includes(id)); savePrefs(); }).el);
      rows.push(row('styles', box));
      rows.push(row('cut every', segmented(['1', '2', '4'].map((v) => ({ value: v, label: `${v} bar${v === '1' ? '' : 's'}` })), String(prefs.tour.every), (v) => { prefs.tour.every = Number(v); savePrefs(); }, 'Cut every').el, h('span', { class: 's-micro ex-why' }, 'drops land on a cut')));
    }
    secVisual.replaceChildren(head('03', 'the visual'), ...rows.filter((x): x is HTMLElement => !!x));
  }

  // ── 4 · Text ──
  const snapT = (t: number): number => (song ? snapToBar(t + windowNow().start, song.analysis.bars) - windowNow().start : t);
  function renderText(): void {
    const D = windowNow().end - windowNow().start;
    const tSeg = segmented([{ value: 'off', label: 'off' }, { value: 'reel', label: 'reel line' }, { value: 'cinematic', label: 'cinematic' }], prefs.title, (v) => { prefs.title = v; savePrefs(); renderText(); refreshStill(); }, 'Title card');
    const num = (v: number, set: (x: number) => void, label: string, max = 600): HTMLInputElement => {
      const i = h('input', { type: 'number', min: 0, max, step: 0.1, value: +v.toFixed(2), class: 'ex-num', 'aria-label': label });
      i.addEventListener('change', () => { set(Math.max(0, Math.min(max, Number(i.value) || 0))); refreshStill(); });
      return i;
    };
    const txt = (v: string, set: (x: string) => void, label: string, area = false): HTMLInputElement | HTMLTextAreaElement => {
      const i = area ? h('textarea', { class: 'ex-text', rows: 2, 'aria-label': label }) : h('input', { class: 'ex-text', value: v, 'aria-label': label });
      if (area) (i as HTMLTextAreaElement).value = v;
      i.addEventListener('input', () => { set(i.value); refreshStill(); });
      return i;
    };
    const rows: HTMLElement[] = [row('title card', tSeg.el)];
    if (prefs.title !== 'off') {
      rows.push(row('song', txt(titleText, (x) => { titleText = x; }, 'Song title'), txt(artistText, (x) => { artistText = x; }, 'Artist')));
      rows.push(row('on screen', h('span', { class: 's-micro' }, 'from'), num(prefs.titleIn, (x) => { prefs.titleIn = x; savePrefs(); }, 'Title in (s)'), h('span', { class: 's-micro' }, 'to'), num(Math.min(prefs.titleOut, D), (x) => { prefs.titleOut = x; savePrefs(); }, 'Title out (s)'), h('span', { class: 's-micro ex-why' }, 's from the start')));
    }
    rows.push(row('now playing', toggle('', prefs.nowPlaying, (v) => { prefs.nowPlaying = v; savePrefs(); refreshStill(); }).el, h('span', { class: 's-micro ex-why' }, 'the app’s card with the artwork, at the start')));
    texts.forEach((t, i) => {
      const pos = select(([['tl', 'top left'], ['top', 'top'], ['tr', 'top right'], ['center', 'centre'], ['bl', 'bottom left'], ['bottom', 'bottom'], ['br', 'bottom right']] as [TextPos, string][]).map(([value, label]) => ({ value, label })), t.pos, (v) => { t.pos = v as TextPos; refreshStill(); }, 'Position').el;
      const size = segmented<TextSize>([{ value: 's', label: 's' }, { value: 'm', label: 'm' }, { value: 'l', label: 'l' }, { value: 'xl', label: 'xl' }], t.size, (v) => { t.size = v; refreshStill(); }, 'Size').el;
      const font = select((Object.keys(FONTS) as FontId[]).map((k) => ({ value: k, label: FONTS[k].label })), t.font, (v) => { t.font = v as FontId; refreshStill(); }, 'Font').el;
      const cs = select([{ value: 'as-typed', label: 'as typed' }, { value: 'lower', label: 'lowercase' }, { value: 'upper', label: 'uppercase' }], t.case, (v) => { t.case = v as TextCase; refreshStill(); }, 'Case').el;
      const start = num(t.start, (x) => { t.start = t.snap ? snapT(x) : x; renderText(); }, 'Start (s)');
      const end = num(t.end, (x) => { t.end = t.snap ? snapT(x) : x; renderText(); }, 'End (s)');
      rows.push(h('div', { class: 'ex-line' },
        h('div', { class: 'ex-line-head' }, h('span', { class: 's-micro' }, `line ${i + 1}`), button('Remove', { size: 'sm', variant: 'ghost', onClick: () => { texts.splice(i, 1); renderText(); refreshStill(); } })),
        txt(t.text, (x) => { t.text = x; }, `Line ${i + 1} text`, true),
        row('time', start, h('span', { class: 's-micro' }, 'to'), end, toggle('snap to bars', t.snap, (v) => { t.snap = v; if (v) { t.start = snapT(t.start); t.end = snapT(t.end); renderText(); } }).el),
        row('place', pos, size),
        row('style', font, cs)));
    });
    rows.push(h('div', { class: 'ex-row' }, h('span', { class: 's-micro ex-rl' }), button('Add a line', { size: 'sm', onClick: () => { const s0 = Math.min(D - 1, 2); texts.push({ text: '', start: s0, end: Math.min(D, s0 + 4), pos: 'center', size: 'l', font: 'inter', case: 'lower', snap: false }); renderText(); } })));
    secText.replaceChildren(head('04', 'text'), ...rows);
  }

  // ── 5 · Output ──
  function renderOut(): void {
    const [W, H] = outputSize(prefs.aspect, prefs.res);
    const asp = segmented<Aspect>([{ value: '16:9', label: '16:9' }, { value: '9:16', label: '9:16' }, { value: '1:1', label: '1:1' }, { value: '4:5', label: '4:5' }], prefs.aspect, (v) => { prefs.aspect = v; savePrefs(); renderAll(); }, 'Aspect');
    const res = segmented<Res>([{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '1440', label: '1440p' }, { value: '2160', label: '4k' }], prefs.res, (v) => { prefs.res = v; savePrefs(); renderOut(); }, 'Resolution');
    const fps = segmented([{ value: '30', label: '30 fps' }, { value: '60', label: '60 fps' }], String(prefs.fps), (v) => { prefs.fps = Number(v) as 30 | 60; savePrefs(); renderOut(); }, 'Frame rate');
    const q = segmented([{ value: 'standard', label: 'standard' }, { value: 'best', label: 'best' }], prefs.quality, (v) => { prefs.quality = v; savePrefs(); renderOut(); }, 'Quality');
    const corner = segmented<Corner>([{ value: 'tl', label: 'top left' }, { value: 'tr', label: 'top right' }, { value: 'bl', label: 'bottom left' }, { value: 'br', label: 'bottom right' }], prefs.corner, (v) => { prefs.corner = v; savePrefs(); refreshStill(); }, 'Mark corner');
    secOut.replaceChildren(head('05', 'output', `${W} × ${H}`),
      row('aspect', asp.el), row('resolution', res.el), row('frame rate', fps.el),
      row('quality', q.el, h('span', { class: 's-micro ex-why' }, prefs.quality === 'best' ? 'supersampled: sharper, slower' : 'rendered at the output size')),
      row('mark', corner.el, h('span', { class: 's-micro ex-why' }, 'the sonora mark, small, on every export')),
      row('outro', toggle('', prefs.outro, (v) => { prefs.outro = v; savePrefs(); refreshStill(); }).el, h('span', { class: 's-micro ex-why' }, `a ${OUTRO_S} s end card: made with sonora · sonoravisuals.com`)));
    layoutPreview();
  }

  // ── 6 · Render ──
  const bar = h('i', { class: 'ex-bar-fill' });
  const progLine = h('span', { class: 's-micro' });
  function renderGo(state: 'idle' | 'busy' | 'done' | 'error' = 'idle', msg = '', path = ''): void {
    const go = button('Render', { variant: 'primary', size: 'lg', iconAfter: 'arrowRight', onClick: () => void start() });
    go.disabled = !song;
    if (state === 'busy') {
      secGo.replaceChildren(h('div', { class: 'ex-bar' }, bar), h('div', { class: 'ex-go-row' }, progLine, button('Cancel', { onClick: () => rendering?.abort() })));
      return;
    }
    const after = state === 'done' ? h('div', { class: 'ex-go-row' }, h('span', { class: 's-micro ex-done' }, msg), button('Open folder', { onClick: () => io.reveal(path) }))
      : state === 'error' ? h('p', { class: 's-micro ex-err' }, msg) : null;
    const [W, H] = outputSize(prefs.aspect, prefs.res);
    const len = (windowNow().end - windowNow().start) + (prefs.outro ? OUTRO_S : 0);
    secGo.replaceChildren(h('div', { class: 'ex-go-row' }, go, h('span', { class: 's-micro' }, song ? `${W} × ${H} · ${prefs.fps} fps · ${len.toFixed(1)} s → videos\\sonora` : 'choose a song to render')), ...(after ? [after] : []));
  }

  function plan(): Plan {
    const w = windowNow();
    const state: StudioState = {
      format: prefs.format, song: song?.file ?? '', title: titleText, artist: artistText, window: { start: w.start, end: w.end },
      combo: prefs.combo, palette: prefs.palette, combo2: prefs.combo2, palette2: prefs.palette2, switchAt,
      showcase: prefs.showcase, tour: prefs.tour, text: 'none', labels: false, nowPlaying: false,
      size: outputSize(prefs.aspect, prefs.res), camera: prefs.camera,
    };
    const p = buildPlan(state, song?.analysis ?? null);
    // A tour over the whole track starts on the song's first bar.
    return p;
  }
  function overlaySpec(): Omit<OverlaySpec, 'size'> {
    const w = windowNow();
    const D = w.end - w.start;
    return {
      duration: D,
      mark: { corner: prefs.corner },
      outro: prefs.outro,
      title: prefs.title === 'off' ? null : { style: prefs.title, title: titleText, artist: artistText, in: Math.min(prefs.titleIn, D), out: Math.min(prefs.titleOut, D) },
      texts: texts.map(({ snap: _s, ...t }) => t),
      nowPlaying: prefs.nowPlaying && song ? { at: 0.4, title: titleText, artist: artistText, album: song.album, art: song.cover || null } : null,
    };
  }

  async function start(): Promise<void> {
    if (!song || rendering) return;
    stopPreview();
    const [W, H] = outputSize(prefs.aspect, prefs.res);
    const ss = prefs.quality === 'best' ? Math.min(BEST_SCALE, BEST_MAX_LONG / Math.max(W, H)) : 1;
    const p = plan();
    const settings: ExportSettings = { plan: p, size: [W, H], fps: prefs.fps, supersample: ss, overlay: { ...overlaySpec(), size: [W, H] }, albumPalette: album, portrait: true };
    const name = `${(titleText || song.file.replace(/\.[^.]+$/, '')).toLowerCase()}${artistText ? ` - ${artistText.toLowerCase()}` : ''} · ${prefs.aspect.replace(':', 'x')} ${prefs.res === '2160' ? '4k' : `${prefs.res}p`}${prefs.fps}`;
    rendering = new AbortController();
    renderGo('busy');
    progLine.textContent = 'starting…';
    let sink: (Sink & { free: number }) | null = null;
    try {
      sink = await io.sink(name);
      const estBytes = (W * H * prefs.fps * 0.21 / 8) * ((p.window.end - p.window.start) + OUTRO_S) * 1.1;
      if (sink.free < estBytes * 1.5) throw new Error(`not enough disk space: about ${(estBytes / 1e9).toFixed(1)} GB needed`);
      const aac = await io.aac(song.sampleRate, 2, 192);
      const res = await renderExport(song, settings, sink, aac, (pr: ExportProgress) => {
        bar.style.width = `${(pr.frame / Math.max(1, pr.total)) * 100}%`;
        const what = pr.stage === 'warming' ? `warming up${pr.shots > 1 ? ` shot ${pr.shot + 1} of ${pr.shots}` : ''}` : pr.stage === 'finishing' ? 'finishing' : `frame ${pr.frame} of ${pr.total}`;
        progLine.textContent = `${what}${pr.rate > 0 ? ` · ${pr.rate.toFixed(0)} fps · about ${fmtEta(pr.eta)} left` : ''}`;
      }, rendering.signal);
      renderGo('done', `saved · ${(res.bytes / 1048576).toFixed(1)} MB · rendered in ${fmtEta(res.wallSeconds)}`, res.path);
    } catch (e) {
      const cancelled = e instanceof DOMException && e.name === 'AbortError';
      renderGo(cancelled ? 'idle' : 'error', cancelled ? '' : `couldn’t export: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      rendering = null;
    }
  }

  // ── Preview ──
  const playBtn = (): HTMLButtonElement => button(preview?.playing() ? 'Stop' : 'Preview', { icon: preview?.playing() ? 'pause' : 'play', onClick: () => (preview?.playing() ? stopPreview() : void playPreview()) });
  let guidesOn = true;
  function renderPvBar(): void {
    const tall = prefs.aspect === '9:16';
    pvBar.replaceChildren(playBtn(), tall ? toggle('safe zones', guidesOn, (v) => { guidesOn = v; preview?.setGuides(v); refreshStill(); }).el : h('span'), h('span', { class: 's-micro ex-time' }, playhead >= 0 ? fmt(playhead) : ''));
    pvNote.textContent = song ? 'the preview starts each style fresh at a cut; the export warms every shot up' : 'choose a song to preview';
  }
  function layoutPreview(): void {
    if (!preview) return;
    const [W, H] = outputSize(prefs.aspect, prefs.res);
    const r = pvWrap.getBoundingClientRect();
    preview.layout(Math.max(100, r.width), Math.max(100, r.height), W, H);
    preview.setGuides(guidesOn && prefs.aspect === '9:16');
    refreshStill();
  }
  function refreshStill(): void {
    if (!preview || preview.playing()) return;
    void preview.still(overlaySpec(), Math.min(prefs.titleIn + 1, 1.5));
  }
  async function playPreview(): Promise<void> {
    if (!song || !preview) return;
    layoutPreview();
    const p = plan();
    await preview.play(song, p, overlaySpec(), album, true, (t) => { playhead = t; drawStripNow(); const tEl = pvBar.querySelector('.ex-time'); if (tEl) tEl.textContent = fmt(t); }, () => { playhead = -1; renderPvBar(); drawStripNow(); });
    renderPvBar();
  }
  function stopPreview(): void { preview?.stop(); playhead = -1; renderPvBar(); }
  function replay(): void { if (preview?.playing()) void playPreview(); }

  function renderAll(): void {
    renderSong(); renderPart(); renderVisual(); renderText(); renderOut(); renderPvBar();
    if (!rendering) renderGo();
  }

  const onResize = (): void => { layoutPreview(); drawStripNow(); };
  function leave(): void {
    if (rendering) return;
    on.back();
  }

  return {
    el,
    show() {
      el.hidden = false;
      preview ??= createPreview(pvBox);
      renderAll();
      window.addEventListener('resize', onResize);
      requestAnimationFrame(() => layoutPreview());
      el.classList.remove('is-in');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
    },
    hide() {
      stopPreview();
      preview?.dispose();
      preview = null;
      pvBox.replaceChildren();
      window.removeEventListener('resize', onResize);
      el.hidden = true;
    },
    busy: () => !!rendering,
  };
}

export { styleLine };
