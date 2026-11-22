/**
 * The reel studio (local tool: `npm run studio`; never part of the app or the
 * site). Pick a song from local-media/songs, see its whole-song analysis on one
 * strip (waveform, intensity, beats and bars, builds / drops / breakdowns /
 * big hits), pick a window that snaps to bars (drops, drag, 15 / 20 / 30 s or
 * custom, three suggestions), choose a format and the visual, preview it live
 * in a 9:16 frame in time with the audio (with Instagram's safe zones), and
 * render it (scripts/reel/render.mjs) or add it to the overnight queue.
 */

import '../ui/ds/ds.css';
import '../ui/screens/screens.css';
import './studio.css';
import { buildPlan, COMBOS, LABEL_TIMING, PALETTE_NAMES, paletteName, snapToBar, styleLine, TOAST_TIMING, type Analysis, type Plan, type StudioState } from '../export/plan-lib.mjs';
import { drawStrip as paintStrip, stripPx, stripTime } from '../export/strip';
import { paletteFromArt } from '../app/album-colours';
import { decodeWavMono } from '../audio/wav';
import { WasmFrameSource } from '../audio/wasm-source';
import { setDebugFlags } from '../engine/debug-flags';
import { initRenderer } from '../engine/renderer';
import { presetsFor } from '../styles/registry';
import { button, segmented, select, slider, toggle } from '../ui/ds/components';
import { h } from '../ui/ds/dom';
import { lockup } from '../ui/screens/brand';
import type { Layer } from './overlay';

interface SongInfo { slug: string; file: string; title: string; artist: string; album: string; cover: boolean }
const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;
const fmt = (t: number): string => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

const state: StudioState = {
  format: 'song', song: '', title: '', artist: '', window: { start: 30, end: 60 },
  combo: 'silk-depth', palette: 0, combo2: 'voyage-void', palette2: 0, showcase: 'palettes',
  tour: { combos: ['silk-depth', 'ink-glow-depth', 'wisp-tunnel', 'warp', 'voyage-void'], every: 2 },
  text: 'full', labels: true, nowPlaying: false, camera: 'planet',
};
let analysis: Analysis | null = null;
let songs: SongInfo[] = [];
let length = 30;
let pickSwitch = false;

// ── Layout ──
document.body.classList.add('s-root', 'studio');
const songSel = h('div', { class: 'st-song' });
const status = h('span', { class: 's-micro st-status' }, 'loading songs…');
document.body.append(
  h('header', { class: 'st-head' }, h('div', { class: 'st-brand' }, lockup(), h('span', { class: 's-label' }, 'reel studio')), songSel, status),
  h('main', { class: 'st-main' },
    h('div', { class: 'st-left' },
      h('section', { class: 'st-panel' }, h('div', { class: 'st-ph' }, h('h2', { class: 's-label s-bone' }, 'the moment'), h('span', { class: 's-micro', id: 'win-readout' })),
        h('canvas', { class: 'st-strip', id: 'strip' }), h('div', { class: 'st-legend s-micro', id: 'legend' }),
        h('div', { class: 'st-row', id: 'win-ctl' }), h('div', { class: 'st-row', id: 'suggest' })),
      h('section', { class: 'st-panel', id: 'visual' }),
      h('section', { class: 'st-panel', id: 'textp' }),
      h('section', { class: 'st-panel', id: 'actions' })),
    h('div', { class: 'st-right' },
      h('div', { class: 'st-phone', id: 'phone' }, h('canvas', { id: 'canvas' }), h('iframe', { id: 'ov', src: '/reel-overlay.html', title: 'overlays', tabindex: '-1' }), h('div', { class: 'st-safe', id: 'safe' }, h('i', { class: 'top' }), h('i', { class: 'bottom' }), h('i', { class: 'side' }), h('i', { class: 'crop' }))),
      h('div', { class: 'st-transport', id: 'transport' }))));

// ── Engine for the preview (portrait framing: studio only) ──
const canvas = $<HTMLCanvasElement>('#canvas');
const renderer = initRenderer(canvas, { autoStart: false, seed: 1234 });
setDebugFlags({ portrait: 1 });
let source: WasmFrameSource | null = null;
let pcm: { mono: Float32Array; sampleRate: number } | null = null;
let audioBuf: AudioBuffer | null = null;
let actx: AudioContext | null = null;
let coverUrl = '';

async function loadSongs(): Promise<void> {
  songs = await fetch('/api/songs').then((r) => r.json()) as SongInfo[];
  if (!songs.length) { status.textContent = 'put songs in local-media/songs (audio or video files)'; return; }
  const sel = select(songs.map((s) => ({ value: s.slug, label: `${s.title} — ${s.artist}` })), songs[0].slug, (v) => void openSong(v), 'Song');
  songSel.replaceChildren(sel.el);
  await openSong(songs[0].slug);
}

async function openSong(slug: string): Promise<void> {
  const s = songs.find((x) => x.slug === slug)!;
  stop();
  status.textContent = 'analysing the whole song…';
  state.song = s.file;
  state.title = s.title.replace(/\s*\((clean|explicit)\)/i, '');
  state.artist = s.artist.replace(/\s*\(feat\..*?\)/i, '');
  analysis = await fetch(`/api/analysis?song=${slug}`).then((r) => r.json()) as Analysis;
  const buf = await fetch(`/api/wav?song=${slug}`).then((r) => r.arrayBuffer());
  pcm = decodeWavMono(buf.slice(0));
  actx ??= new AudioContext();
  audioBuf = await actx.decodeAudioData(buf);
  source ??= await WasmFrameSource.create();
  coverUrl = s.cover ? `/api/cover?song=${slug}` : '';
  const sug = analysis.suggestions[String(length)]?.[0];
  state.window = sug ? { start: sug.start, end: sug.end } : { start: Math.min(30, analysis.duration / 3), end: Math.min(analysis.duration, 60) };
  status.textContent = `${analysis.duration.toFixed(0)} s · ${analysis.bpm.toFixed(0)} bpm · ${analysis.bars.length} bars · ${analysis.events.filter((e) => e.type === 'drop').length} drops`;
  renderAll();
}

// ── The strip (shared with the app's Export screen) ──
const strip = $<HTMLCanvasElement>('#strip');
let playhead = -1;
function drawStrip(): void {
  if (!analysis) return;
  paintStrip(strip, analysis, { window: state.window, playhead, marker: state.format === 'beatswitch' ? state.switchAt : undefined });
  $('#win-readout').textContent = `${fmt(state.window.start)} → ${fmt(state.window.end)} · ${(state.window.end - state.window.start).toFixed(1)} s · ${analysis.bars.filter((b) => b >= state.window.start && b < state.window.end).length} bars`;
}
let drag: { x0: number } | null = null;
strip.addEventListener('pointerdown', (e) => {
  if (!analysis) return;
  const t = stripTime(strip, analysis, e.clientX);
  if (pickSwitch || (state.format === 'beatswitch' && e.altKey)) { state.switchAt = snapToBar(t, analysis.bars); pickSwitch = false; renderAll(); return; }
  // Near a drop: frame the window around it (a quarter in), snapped to bars.
  const drop = analysis.events.find((ev) => ev.type === 'drop' && stripPx(strip, analysis!, ev.t - t) < 10);
  if (drop) { setWindow(drop.t - length * 0.3, length); return; }
  drag = { x0: t };
  strip.setPointerCapture(e.pointerId);
});
strip.addEventListener('pointermove', (e) => {
  if (!drag || !analysis) return;
  const x = stripTime(strip, analysis, e.clientX);
  const a = Math.min(drag.x0, x), b = Math.max(drag.x0, x);
  state.window = { start: snapToBar(a, analysis.bars), end: snapToBar(b, analysis.bars) };
  drawStrip();
});
strip.addEventListener('pointerup', () => {
  if (!drag || !analysis) return;
  drag = null;
  if (state.window.end - state.window.start < 4) setWindow(state.window.start, length);
  else { length = Math.round(state.window.end - state.window.start); renderAll(); }
});
function setWindow(start: number, len: number): void {
  if (!analysis) return;
  const s = snapToBar(Math.max(8, start), analysis.bars);
  const e = snapToBar(Math.min(analysis.duration - 0.5, s + len), analysis.bars);
  state.window = { start: s, end: e > s ? e : Math.min(analysis.duration, s + len) };
  renderAll();
}

// ── Panels ──
const row = (label: string, ...c: (Node | null)[]): HTMLElement => h('div', { class: 'st-r' }, h('span', { class: 's-micro st-rl' }, label), ...c);
const comboOpts = COMBOS.map((c) => ({ value: c.id, label: c.label }));
const palOpts = [...PALETTE_NAMES.map((n, i) => ({ value: String(i), label: n })), { value: 'album', label: 'album colours' }, { value: 'hue', label: 'custom hue' }, { value: 'drift', label: 'auto drift' }];
const palValue = (p: StudioState['palette']): string => (p === 'album' ? 'album' : typeof p === 'number' ? String(p) : 'hue' in p ? 'hue' : 'drift');
const palFrom = (v: string, prev: StudioState['palette']): StudioState['palette'] => (v === 'album' ? 'album' : v === 'hue' ? { hue: typeof prev === 'object' && 'hue' in prev ? prev.hue : 200 } : v === 'drift' ? { drift: true, index: typeof prev === 'number' ? prev : 0 } : Number(v));

function renderControls(): void {
  // Window
  const lens = segmented(['15', '20', '30', 'custom'].map((v) => ({ value: v, label: v === 'custom' ? 'custom' : `${v} s` })), [15, 20, 30].includes(length) ? String(length) : 'custom', (v) => { if (v !== 'custom') { length = Number(v); setWindow(state.window.start, length); } }, 'Length');
  const custom = h('input', { type: 'number', min: 5, max: 90, value: length, class: 'st-num', 'aria-label': 'Custom length (s)' });
  custom.addEventListener('change', () => { length = Math.max(5, Math.min(90, Number(custom.value) || 30)); setWindow(state.window.start, length); });
  $('#win-ctl').replaceChildren(row('length', lens.el, custom, h('span', { class: 's-micro st-note' }, 'click a drop · drag to choose · ends snap to bars')));
  const sug = (analysis?.suggestions[String(length)] ?? analysis?.suggestions['30'] ?? []);
  $('#suggest').replaceChildren(row('suggested', ...sug.map((s, i) => { const b = button(`${i + 1} · ${fmt(s.start)}`, { size: 'sm', title: s.why, onClick: () => { state.window = { start: s.start, end: s.end }; renderAll(); } }); return b; }),
    h('span', { class: 's-micro st-note' }, sug[0]?.why ?? '')));

  // Visual
  const f = segmented([{ value: 'song', label: 'song' }, { value: 'beatswitch', label: 'beat switch' }, { value: 'showcase', label: 'showcase' }, { value: 'tour', label: 'styles tour' }, { value: 'album', label: 'album colours' }], state.format, (v) => { state.format = v; if (v === 'beatswitch' && analysis && state.switchAt === undefined) { const d = analysis.events.find((e) => e.type === 'drop' && e.t > state.window.start && e.t < state.window.end); state.switchAt = snapToBar(d ? d.t : (state.window.start + state.window.end) / 2, analysis.bars); } renderAll(); }, 'Format');
  const combo = select(comboOpts, state.combo, (v) => { state.combo = v; renderAll(); }, 'Style').el;
  const pal = select(palOpts, palValue(state.palette), (v) => { state.palette = palFrom(v, state.palette); renderAll(); }, 'Palette').el;
  const c0 = COMBOS.find((c) => c.id === state.combo)!;
  const cam = c0.depth && !(c0.style === 'wisp' && c0.variant === 'tunnel') ? select(presetsFor(c0.style).map((p) => ({ value: p.id, label: p.label })), state.camera ?? 'glide', (v) => { state.camera = v; }, 'Camera').el : null;
  const hue = typeof state.palette === 'object' && 'hue' in state.palette ? slider({ min: 0, max: 360, value: state.palette.hue, hue: true, ariaLabel: 'Hue', onInput: (v) => { state.palette = { hue: v }; } }).el : null;
  const extra: HTMLElement[] = [];
  if (state.format === 'beatswitch') {
    extra.push(row('then', select(comboOpts, state.combo2 ?? 'voyage-void', (v) => { state.combo2 = v; renderAll(); }, 'Second style').el, select(palOpts, palValue(state.palette2 ?? 0), (v) => { state.palette2 = palFrom(v, state.palette2 ?? 0); renderAll(); }, 'Second palette').el));
    extra.push(row('switch on', h('span', { class: 's-micro' }, state.switchAt !== undefined ? fmt(state.switchAt) : '–'), button(pickSwitch ? 'click a bar on the strip…' : 'pick the bar', { size: 'sm', onClick: () => { pickSwitch = true; renderControls(); } })));
  } else if (state.format === 'showcase') {
    extra.push(row('every bar', segmented([{ value: 'palettes', label: 'next palette' }, { value: 'looks', label: 'next look' }], state.showcase ?? 'palettes', (v) => { state.showcase = v; }, 'Showcase').el));
  } else if (state.format === 'tour') {
    const box = h('div', { class: 'st-checks' });
    for (const c of COMBOS) box.append(toggle(c.label, state.tour!.combos.includes(c.id), (on) => { const l = state.tour!.combos.filter((x) => x !== c.id); if (on) l.push(c.id); state.tour!.combos = COMBOS.map((x) => x.id).filter((id) => l.includes(id)); }).el);
    extra.push(row('styles', box));
    extra.push(row('cut every', segmented(['1', '2', '4'].map((v) => ({ value: v, label: `${v} bar${v === '1' ? '' : 's'}` })), String(state.tour!.every), (v) => { state.tour!.every = Number(v); }, 'Cut every').el, h('span', { class: 's-micro st-note' }, 'drops land on a cut')));
  } else if (state.format === 'album') {
    extra.push(row('cover', coverUrl ? h('img', { src: coverUrl, class: 'st-cover', alt: '' }) : h('span', { class: 's-micro' }, 'no cover: add one to local-media/covers')));
  }
  $('#visual').replaceChildren(h('div', { class: 'st-ph' }, h('h2', { class: 's-label s-bone' }, 'the visual')),
    row('format', f.el),
    row('style', combo, state.format === 'album' ? null : pal, cam), ...(hue ? [row('hue', hue)] : []), ...extra);
  // Text
  $('#textp').replaceChildren(h('div', { class: 'st-ph' }, h('h2', { class: 's-label s-bone' }, 'house style')),
    row('title', (() => { const i = h('input', { class: 'st-text', value: `${state.title} — ${state.artist}`.toLowerCase() }); i.addEventListener('change', () => { const [t, a] = i.value.split(/\s+—\s+/); state.title = t ?? ''; state.artist = a ?? ''; }); return i; })()),
    row('text', segmented([{ value: 'full', label: 'full' }, { value: 'intro', label: 'intro' }, { value: 'none', label: 'none' }], state.text, (v) => { state.text = v; renderOverlay(true); }, 'Text').el),
    row('style labels', toggle('', state.labels, (v) => { state.labels = v; }).el),
    row('now playing', toggle('', state.nowPlaying, (v) => { state.nowPlaying = v; }).el, h('span', { class: 's-micro st-note' }, 'the app’s toast at the start')));
  // Actions
  const log = h('pre', { class: 'st-log', id: 'log' });
  $('#actions').replaceChildren(h('div', { class: 'st-ph' }, h('h2', { class: 's-label s-bone' }, 'render')),
    h('div', { class: 'st-btns' },
      button('Render draft', { onClick: () => void render(true) }),
      button('Render', { variant: 'primary', onClick: () => void render(false) }),
      button('Add to queue', { onClick: () => void queue() }),
      button('Save plan', { onClick: () => void savePlan() })),
    h('p', { class: 's-micro st-note' }, 'Renders: High quality, supersampled, 1080×1920 at 60 fps, 8 s warm-up from the song’s start; out to local-media/reels/out/. Queue: npm run reel -- --queue.'),
    log);
  // Transport
  $('#transport').replaceChildren(
    button(playing ? 'Stop' : 'Preview', { icon: playing ? 'pause' : 'play', onClick: () => (playing ? stop() : void play()) }),
    toggle('safe zones', safeOn, (v) => { safeOn = v; $('#safe').hidden = !v; }).el,
    h('span', { class: 's-micro st-note', id: 'pv-note' }, 'the preview starts each style fresh at a cut; the render warms every shot'));
}

function renderAll(): void { drawStrip(); renderControls(); renderOverlay(true); }

// ── Plan, render, queue ──
const plan = (): Plan => buildPlan({ ...state, name: `${new Date().toISOString().slice(0, 10)}-${state.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${state.format}` }, analysis);
async function render(draft: boolean): Promise<void> {
  const { id } = await fetch('/api/render', { method: 'POST', body: JSON.stringify({ plan: plan(), draft }) }).then((r) => r.json()) as { id: string };
  const log = $('#log');
  const poll = async (): Promise<void> => {
    const j = await fetch(`/api/render?id=${id}`).then((r) => r.json()) as { status: string; log: string; out: string | null };
    log.textContent = `${j.status}${j.out ? ` → ${j.out}` : ''}\n${j.log.split('\n').slice(-12).join('\n')}`;
    if (j.status === 'running') window.setTimeout(() => void poll(), 1500);
    else if (j.out) log.append(h('br'), button('Open the folder', { size: 'sm', onClick: () => void fetch('/api/open', { method: 'POST', body: JSON.stringify({ path: j.out }) }) }));
  };
  void poll();
}
async function queue(): Promise<void> {
  const r = await fetch('/api/queue', { method: 'POST', body: JSON.stringify(plan()) }).then((x) => x.json()) as { jobs: number };
  $('#log').textContent = `added · ${r.jobs} job(s) waiting · run npm run reel -- --queue`;
}
async function savePlan(): Promise<void> {
  const r = await fetch('/api/plan', { method: 'POST', body: JSON.stringify(plan()) }).then((x) => x.json()) as { file: string };
  $('#log').textContent = `saved ${r.file}`;
}

// ── Overlays in the preview (the same layers the render burns in) ──
const ov = $<HTMLIFrameElement>('#ov');
let lastOverlayKey = '';
function layersAt(p: Plan, t: number): { layer: Layer; opacity: number }[] {
  const out: { layer: Layer; opacity: number }[] = [];
  const W0 = p.window.start, rel = t - W0;
  const fade = (a: number, fin: number, hold: number, fo: number): number => (rel < a || rel > a + fin + hold + fo ? 0 : rel < a + fin ? (rel - a) / fin : rel > a + fin + hold ? 1 - (rel - a - fin - hold) / fo : 1);
  if (p.text !== 'none' && (p.text === 'full' || rel < 3.5)) {
    out.push({ layer: { kind: 'title', text: `${p.title ?? ''} — ${p.artist ?? ''}`.toLowerCase() }, opacity: 1 });
    const shot = [...p.shots].reverse().find((s) => s.at <= t + 1e-3) ?? p.shots[0];
    out.push({ layer: { kind: 'styleline', text: styleLine(shot) }, opacity: 1 });
  }
  out.push({ layer: { kind: 'mark' }, opacity: 1 });
  if (p.labels) p.shots.forEach((s, i) => { const o = fade(s.at - W0 + (i === 0 ? 0.6 : 0.15), LABEL_TIMING.in, LABEL_TIMING.hold, LABEL_TIMING.out); if (o > 0) out.push({ layer: { kind: 'label', text: styleLine(s, false) }, opacity: o }); });
  if (p.nowPlaying) for (const at of p.nowPlaying) { const o = fade(at - W0, TOAST_TIMING.in, TOAST_TIMING.hold, TOAST_TIMING.out); if (o > 0) out.push({ layer: { kind: 'toast', title: p.title ?? '', artist: p.artist ?? '', art: coverUrl }, opacity: o }); }
  return out;
}
function renderOverlay(force = false, t = state.window.start): void {
  const w = ov.contentWindow as (Window & { __overlay?: { renderMany(l: { layer: Layer; opacity: number }[]): void } }) | null;
  if (!w?.__overlay || !analysis) return;
  const ls = layersAt(plan(), t);
  const key = JSON.stringify(ls.map((l) => [l.layer, Math.round(l.opacity * 20)]));
  if (!force && key === lastOverlayKey) return;
  lastOverlayKey = key;
  w.__overlay.renderMany(ls);
}
ov.addEventListener('load', () => renderOverlay(true));

// ── Live preview ──
let playing = false;
let safeOn = true;
let raf = 0;
let srcNode: AudioBufferSourceNode | null = null;
async function applyShot(s: Plan['shots'][number]): Promise<void> {
  renderer.transition({ style: s.style, variant: s.variant, depth: s.depth, cut: true });
  renderer.setDepth(s.depth);
  const ce = renderer.colorEngine;
  ce.setAutoDrift(false);
  const p = s.palette ?? 0;
  if (p === 'album') { const pal = coverUrl ? await paletteFromArt(coverUrl) : null; ce.setAlbum(pal, 0, true); }
  else { ce.setAlbum(null, 0, true); if (typeof p === 'number') ce.setPalette(p, true); else if ('hue' in p) { ce.setCustomHue(p.hue); ce.update(10); } else { ce.setPalette(p.index ?? 0, true); ce.setAutoDrift(true); } }
  const preset = presetsFor(s.style).find((x) => x.id === s.camera);
  if (preset) renderer.camera.setView(preset.view);
}
async function play(): Promise<void> {
  if (!analysis || !pcm || !source || !audioBuf || !actx) return;
  const p = plan();
  playing = true; renderControls();
  $('#pv-note').textContent = 'warming up…';
  source.loadOffline(pcm.mono, pcm.sampleRate);
  source.subscribe((f) => renderer.pushFrame(f));
  await applyShot(p.shots[0]);
  const W0 = p.window.start;
  const warm = Math.min(8, W0);
  source.stepOffline(W0 - warm);
  for (let i = 0; i < warm * 60; i++) { source.stepOffline(1 / 60); renderer.step(1 / 60); }
  await actx.resume();
  srcNode = actx.createBufferSource();
  srcNode.buffer = audioBuf;
  srcNode.connect(actx.destination);
  const t0 = actx.currentTime;
  srcNode.start(0, W0);
  let songT = W0, shotI = 0;
  const changes = [...(p.changes ?? [])];
  $('#pv-note').textContent = 'the preview starts each style fresh at a cut; the render warms every shot';
  const tick = (): void => {
    if (!playing) return;
    const target = W0 + (actx!.currentTime - t0) - (actx!.outputLatency || 0);
    const dt = Math.max(0, Math.min(0.1, target - songT));
    if (dt > 0) { source!.stepOffline(dt); renderer.step(dt); songT += dt; }
    while (shotI + 1 < p.shots.length && p.shots[shotI + 1].at <= songT) void applyShot(p.shots[++shotI]);
    while (changes.length && changes[0].at <= songT) { const c = changes.shift()!; if (typeof c.palette === 'number') renderer.colorEngine.setPalette(c.palette); }
    playhead = songT; drawStrip();
    renderOverlay(false, songT);
    if (songT >= p.window.end) { stop(); return; }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
}
function stop(): void {
  playing = false;
  cancelAnimationFrame(raf);
  try { srcNode?.stop(); } catch { /* not started */ }
  srcNode = null;
  playhead = -1;
  if (analysis) { drawStrip(); renderControls(); }
}
window.addEventListener('resize', () => drawStrip());
void paletteName;
void loadSongs();
