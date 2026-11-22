/**
 * The controller: sonora's remote for a second screen (D84). The visual runs
 * full screen on the output (the TV); this window shows a live preview of
 * exactly what it shows, now playing, Set Mode, style / look / view, palettes
 * (Album first), quick feel controls, the output display, blackout and freeze,
 * and every setting (the app's own settings sheet). Keys pressed here act on
 * the output. Closing it never touches the output.
 */

import { albumTile } from '../ui/screens/album-tile';
import { lockup } from '../ui/screens/brand';
import { ART_STYLES, describe, mediaFor, mediaNameFor, PIECES, STYLE_INFO } from '../app/catalog';
import { openLink, PING_MS, PREVIEW_CHANNEL, wallMs, type PreviewMsg, type RemoteState } from '../app/link';
import type { MonitorInfo } from '../app/platform';
import { audioStatus, nowPlaying, type MediaInfo } from '../app/stores';
import { PALETTES, swatchCss } from '../engine/color-engine';
import { GLOW_MAX, GLOW_MIN, SET_MODE_INTERVALS } from '../ipc/settings';
import { getStyle, presetsFor } from '../styles/registry';
import { button, icon, infoButton, meter, segmented, select, slider, thumb, toggle } from '../ui/ds/components';
import { h } from '../ui/ds/dom';
import { createSettings } from '../ui/screens/settings';
import { createProxy } from './proxy';
import '../ui/ds/ds.css';
import '../ui/screens/screens.css';
import './controller.css';

// ── Tuning ──────────────────────────────────────────────────────
/** Window over which preview fps and latency are averaged (ms). */
const STATS_WINDOW_MS = 1000;
/** Keys forwarded to the output (its own shortcuts). */
const FORWARD = /^(f|F11|Escape|h|m|s|v|c|p|a|[0-9])$/i;

interface Desktop { listDevices?: () => Promise<{ id: string; name: string }[]>; listMonitors?: () => Promise<MonitorInfo[]>; close?: () => void }

export async function bootController(desktop: Desktop = {}): Promise<void> {
  document.body.classList.add('s-root', 'ctl');
  const link = openLink();
  const px = createProxy(link, desktop);
  const { ctl, platform, state, act } = px;
  const s = ctl.settings;

  // ── Layout ──
  const status = h('span', { class: 'ctl-status s-micro' }, 'waiting for sonora…');
  const outputSel = h('div', { class: 'ctl-output' });
  const allBtn = button('All settings', { icon: 'settings', size: 'sm', onClick: () => sheet.open() });
  const head = h('header', { class: 'ctl-head' },
    h('div', { class: 'ctl-brand' }, lockup(), h('span', { class: 's-label' }, 'controller')),
    h('div', { class: 'ctl-head-r' }, status, outputSel, allBtn));

  const canvas = h('canvas', { class: 'ctl-canvas', 'aria-label': 'Live preview of the output' });
  const badge = h('span', { class: 'ctl-badge s-label' });
  const desc = h('span', { class: 'ctl-desc s-micro' });
  const preview = h('div', { class: 'ctl-preview' }, canvas, h('div', { class: 'ctl-preview-top' }, h('span', { class: 's-label' }, 'output'), desc), badge);
  const actions = h('div', { class: 'ctl-actions' });
  const np = h('div', { class: 'ctl-np' });
  const left = h('section', { class: 'ctl-left' }, preview, actions, np);

  const pSet = h('section', { class: 'ctl-panel ctl-set' });
  const pStyle = h('section', { class: 'ctl-panel ctl-style' });
  const pColour = h('section', { class: 'ctl-panel ctl-colour' });
  const pFeel = h('section', { class: 'ctl-panel ctl-feel' });
  // Two columns on wide screens; one (Set Mode, style, colour, feel) on laptops.
  const right = h('div', { class: 'ctl-right' }, h('div', { class: 'ctl-col' }, pSet, pFeel), h('div', { class: 'ctl-col' }, pStyle, pColour));
  let showInclude = sessionStorage.getItem('ctl-include') === '1';
  const main = h('main', { class: 'ctl-main' }, left, right);
  document.body.append(head, main);

  const sheet = createSettings(ctl, platform, { setSetMode: (on) => act({ a: 'setSetMode', on }) });

  // ── Preview ──
  const g = canvas.getContext('2d')!;
  const frames: number[] = [];
  const lags: number[] = [];
  const pch = new BroadcastChannel(PREVIEW_CHANNEL);
  let drawing = false;
  pch.onmessage = async (e: MessageEvent<PreviewMsg>) => {
    if (e.data.t !== 'frame' || drawing) return;
    drawing = true;
    try {
      const bmp = await createImageBitmap(e.data.blob);
      const r = canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = Math.max(1, Math.round(r.width * dpr)), H = Math.max(1, Math.round(r.height * dpr));
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      // readPixels rows are bottom-up: flip while drawing.
      if (e.data.flip) g.setTransform(1, 0, 0, -1, 0, H);
      g.imageSmoothingQuality = 'high';
      g.drawImage(bmp, 0, 0, W, H);
      g.setTransform(1, 0, 0, 1, 0, 0);
      bmp.close();
      const now = wallMs();
      frames.push(now); lags.push(now - e.data.at);
      while (frames.length && now - frames[0] > STATS_WINDOW_MS) { frames.shift(); lags.shift(); }
      preview.classList.add('is-live');
    } finally { drawing = false; }
  };
  window.setInterval(() => {
    const st = state.get();
    const now = wallMs();
    while (frames.length && now - frames[0] > STATS_WINDOW_MS) { frames.shift(); lags.shift(); }
    if (!st) { status.textContent = 'waiting for sonora…'; status.dataset.live = 'off'; return; }
    const fps = frames.length;
    const lag = lags.length ? lags.reduce((a, b) => a + b, 0) / lags.length : 0;
    status.dataset.live = fps ? 'on' : 'idle';
    status.textContent = fps ? `live · ${fps} fps · ${Math.round(lag)} ms` : st.screen === 'visual' ? 'linked' : 'linked · visual paused';
    (window as unknown as { __ctlStats?: unknown }).__ctlStats = { fps, lag };
  }, 250);

  // ── Link heartbeat ──
  link.send({ t: 'hello' });
  window.setInterval(() => link.send({ t: 'ping' }), PING_MS);

  // ── Panels ──
  const panelHead = (title: string, ...extra: (Node | null)[]): HTMLElement => h('div', { class: 'ctl-ph' }, h('h2', { class: 's-label s-bone' }, title), ...extra);
  const row = (label: string, ...ctrl: (Node | null)[]): HTMLElement => h('div', { class: 'ctl-row' }, h('span', { class: 'ctl-rl s-micro' }, label), ...ctrl);

  function renderActions(st: RemoteState): void {
    const black = button(st.blackout ? 'Back from black' : 'Blackout', { icon: 'collapse', onClick: () => ctl.setBlackout(!st.blackout) });
    black.classList.add('ctl-big');
    black.setAttribute('aria-pressed', String(st.blackout));
    const freeze = button(st.frozen ? 'Unfreeze' : 'Freeze', { icon: 'pause', onClick: () => ctl.setFrozen(!st.frozen) });
    freeze.classList.add('ctl-big');
    freeze.setAttribute('aria-pressed', String(st.frozen));
    const third = st.screen === 'visual'
      ? button(st.fullscreen ? 'Leave fullscreen' : 'Fullscreen', { icon: st.fullscreen ? 'collapse' : 'expand', onClick: () => act({ a: 'toggleFullscreen' }) })
      : button('Show the visual', { icon: 'play', variant: 'primary', onClick: () => act({ a: 'goVisual' }) });
    third.classList.add('ctl-big');
    const clock = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const rec = st.rec ? button(st.rec.state === 'recording' ? `Stop · ${clock(st.rec.elapsed)}` : st.rec.state === 'finishing' ? 'Saving…' : 'Record', { onClick: () => act({ a: 'record' }) }) : null;
    if (rec) { rec.classList.add('ctl-big'); rec.setAttribute('aria-pressed', String(st.rec?.state === 'recording')); }
    actions.replaceChildren(black, freeze, third, ...(rec ? [rec] : []));
    badge.textContent = st.blackout ? 'blackout' : st.frozen ? 'frozen' : st.rec?.state === 'recording' ? 'recording' : st.screen !== 'visual' ? 'menu on screen' : '';
    badge.hidden = !badge.textContent;
    desc.textContent = describe(s.mode, ctl.variantFor(s.mode), ctl.depthFor(s.mode), getStyle(s.mode).supportsDepth);
  }

  const mtr = meter(24);
  audioStatus.subscribe((a) => mtr.set(a.level));
  function renderNp(m: MediaInfo | null, st: RemoteState): void {
    const ctlRow = m ? h('div', { class: 'ctl-np-ctl' },
      button('', { icon: 'prev', title: 'Previous', onClick: () => act({ a: 'media', v: 'prev' }) }),
      button('', { icon: m.playing ? 'pause' : 'play', title: m.playing ? 'Pause' : 'Play', onClick: () => act({ a: 'media', v: 'playpause' }) }),
      button('', { icon: 'next', title: 'Next', onClick: () => act({ a: 'media', v: 'next' }) })) : null;
    np.replaceChildren(
      panelHead('now playing', h('span', { class: 's-micro' }, st.audio.device ? `${st.audio.hearing ? 'hearing' : 'quiet'} · ${st.audio.device}` : '')),
      h('div', { class: 'ctl-np-body' },
        m?.art ? h('img', { src: m.art, alt: '', class: 'ctl-np-art' }) : h('span', { class: 'ctl-np-art ctl-np-ph' }),
        h('div', { class: 'ctl-np-t' },
          h('span', { class: 'ctl-np-title' }, m?.title || 'nothing playing'),
          h('span', { class: 's-micro' }, m ? [m.artist, m.album].filter(Boolean).join(' · ') : 'play something on this computer'),
          ctlRow)),
      mtr.el);
  }

  function renderSet(st: RemoteState): void {
    const sm = s.setMode;
    const id = s.mode;
    const label = STYLE_INFO[id].label.toLowerCase();
    const onT = toggle('', sm.on, (v) => act({ a: 'setSetMode', on: v }));
    const next = button('Next now', { icon: 'next', onClick: () => act({ a: 'switchNow' }) });
    if (!sm.on) next.setAttribute('disabled', '');
    const lock = button(sm.lockStyle ? `Locked to ${label}` : `Lock to ${label}`, { onClick: () => { sm.lockStyle = !sm.lockStyle; ctl.commit(); } });
    lock.setAttribute('aria-pressed', String(sm.lockStyle));
    const fmt = (n: number): string => (n < 60 ? `${n}s` : `${Math.round(n / 60)} min`);
    const inc = h('div', { class: 'ctl-inc' });
    for (const p of PIECES) {
      const on0 = sm.include.length === 0 || sm.include.includes(p.id);
      const t = thumb({ media: mediaFor(p.media), title: p.label, selected: on0, hoverPlay: false, onClick: () => {
        const all = PIECES.map((x) => x.id);
        let list = sm.include.length ? [...sm.include] : all;
        list = list.includes(p.id) ? list.filter((x) => x !== p.id) : [...list, p.id];
        sm.include = list.length === all.length ? [] : list;
        ctl.commit();
      } });
      if (sm.lockStyle && p.style !== id) t.el.classList.add('is-off');
      inc.append(t.el);
    }
    pSet.replaceChildren(
      panelHead('set mode', h('span', { class: 's-micro ctl-sm-state' }, sm.on ? (sm.lockStyle ? `on · ${label} only` : 'on · sonora chooses') : 'off'), onT.el),
      h('div', { class: 'ctl-btns' }, next, lock),
      row('at most every', segmented(SET_MODE_INTERVALS.map((n) => ({ value: String(n), label: fmt(n) })), String(sm.minInterval), (v) => { sm.minInterval = Number(v); ctl.commit(); }, 'Interval').el),
      row('mood', slider({ min: -100, max: 100, value: Math.round(sm.bias * 100), tick: 0, ends: ['calm', 'follow the music', 'driving'], ariaLabel: 'Calm or driving',
        onInput: () => undefined, onCommit: (v) => { sm.bias = Math.abs(v) < 6 ? 0 : v / 100; ctl.commit(); }, onReset: () => { sm.bias = 0; ctl.commit(); } }).el),
      row('palettes too', toggle('', sm.palettes, (v) => { sm.palettes = v; ctl.commit(); }).el,
        s.albumColours ? h('span', { class: 's-micro ctl-note' }, 'album colours choose them now') : null),
      row('can choose', h('span', { class: 's-micro ctl-note' }, sm.lockStyle ? `${label} looks and views only` : sm.include.length ? `${sm.include.length} of ${PIECES.length}` : 'everything'),
        (() => { const b = button(showInclude ? 'Hide' : 'Choose', { size: 'sm', iconAfter: 'chevronDown', onClick: () => { showInclude = !showInclude; sessionStorage.setItem('ctl-include', showInclude ? '1' : '0'); render(); } }); b.setAttribute('aria-expanded', String(showInclude)); return b; })()),
      ...(showInclude ? [inc] : []));
    void st;
  }

  function renderStyle(): void {
    const id = s.mode;
    const d = getStyle(id);
    const info = STYLE_INFO[id];
    const look = ctl.variantFor(id);
    const depth = ctl.depthFor(id);
    const styles = h('div', { class: 'ctl-styles' }, ...ART_STYLES.map((sid) => thumb({
      media: mediaFor(mediaNameFor(sid, ctl.variantFor(sid), ctl.depthFor(sid))), title: STYLE_INFO[sid].label, selected: sid === id, hoverPlay: false,
      onClick: () => ctl.show(sid),
    }).el));
    const looks = info.looks.length ? h('div', { class: 'ctl-looks' }, ...info.looks.map((l) => thumb({
      media: mediaFor(l.media), title: l.label, selected: l.id === look && (!l.depthOnly || depth), hoverPlay: false,
      onClick: () => { if (l.depthOnly && !depth) ctl.setDepth(true); ctl.setVariant(l.id); },
    }).el)) : null;
    const views = d.supportsDepth ? segmented([{ value: 'depth', label: 'Depth' }, { value: 'flat', label: 'Flat' }], depth ? 'depth' : 'flat', (v) => ctl.setDepth(v === 'depth'), 'View').el : null;
    pStyle.replaceChildren(...[
      panelHead('style', h('span', { class: 's-micro' }, 'S next · V look')),
      styles,
      looks ? row('look', looks) : null,
      views ? row('view', views) : null].filter((x): x is HTMLElement => x !== null));
  }

  function renderColour(st: RemoteState): void {
    const id = s.mode;
    const pals = h('div', { class: 'ctl-pals' });
    pals.append(albumTile(ctl.album.get(), s.albumColours, st.platform === 'web', () => ctl.setAlbumColours(!s.albumColours), true));
    PALETTES.forEach((p, i) => {
      const t = thumb({ media: mediaFor(`pal-${id}-${i}`, `pal-ink-${i}`), title: `${i + 1} ${p.name}`, selected: !s.albumColours && s.paletteIndex === i, hoverPlay: false, onClick: () => ctl.setPalette(i) });
      t.el.classList.add('pal-thumb');
      t.media.el.append(h('i', { class: 'pal-chip', style: { background: swatchCss(p) } }));
      pals.append(t.el);
    });
    pColour.replaceChildren(
      panelHead('colour', h('span', { class: 's-micro' }, `A album · 1–9 · ${s.matchColours ? 'all styles' : `for ${STYLE_INFO[id].label.toLowerCase()}`}`)),
      pals,
      row('colour drift', toggle('', s.autoDrift, (v) => ctl.setAutoDrift(v)).el, s.albumColours && st.album.status === 'cover' ? h('span', { class: 's-micro ctl-note' }, 'paused while the cover chooses') : null));
  }

  function renderFeel(): void {
    const id = s.mode;
    const depthOn = ctl.depthActive();
    const presets = presetsFor(id);
    const P = 0.03;
    const active = presets.find((p) => Math.abs(p.view.height - s.camera.height) < P && Math.abs(p.view.tilt - s.camera.tilt) < P && Math.abs(p.view.curve - s.camera.curve) < P);
    const ownCamera = id === 'wisp' && depthOn && ctl.variantFor(id) === 'tunnel';
    pFeel.replaceChildren(
      panelHead('feel', h('span', { class: 's-micro' }, `for ${STYLE_INFO[id].label.toLowerCase()}`)),
      row('responsiveness', slider({ min: 0, max: 100, value: Math.round(s.responsiveness * 100), tick: 60, ends: ['smooth', 'punchy'], ariaLabel: 'Responsiveness', onInput: (v) => ctl.setResponsiveness(v / 100) }).el),
      row('glow', slider({ min: Math.round(GLOW_MIN * 100), max: Math.round(GLOW_MAX * 100), value: Math.round(s.glow * 100), tick: 100, ends: ['less', 'more'], ariaLabel: 'Glow', onInput: (v) => ctl.setGlow(Math.abs(v - 100) <= 3 ? 1 : v / 100), onReset: () => ctl.setGlow(1) }).el,
        infoButton({ title: 'glow', scope: `for ${STYLE_INFO[id].label.toLowerCase()}`, body: ['How much light blooms around the brightest parts. The middle is the style as designed; brightness on hits stays within the same safe limits.'] })),
      depthOn && !ownCamera
        ? row('camera', segmented(presets.map((p) => ({ value: p.id, label: p.label, title: p.hint })), active?.id ?? '', (v) => { const p = presets.find((x) => x.id === v); if (p) ctl.setCamera({ ...p.view }); }, 'Camera preset').el)
        : row('camera', h('span', { class: 's-micro ctl-note' }, ownCamera ? 'the tunnel flies its own camera' : 'depth view only')));
  }

  async function renderOutput(st: RemoteState): Promise<void> {
    if (st.platform !== 'desktop' || st.monitors.length < 1) { outputSel.replaceChildren(); return; }
    const opts = st.monitors.map((m) => ({ value: m.name, label: m.label }));
    const sel = select(opts, st.outputMonitor || opts[0]?.value || '', (v) => act({ a: 'moveOutput', monitor: v }), 'Output display');
    outputSel.replaceChildren(h('span', { class: 's-micro' }, 'output on'), sel.el);
  }

  // Rebuild on every state; never under a dragging slider (rebuilt on release).
  let pending = false;
  const render = (): void => {
    const st = state.get();
    if (!st) { main.classList.add('is-waiting'); return; }
    main.classList.remove('is-waiting');
    const a = document.activeElement;
    if (a instanceof HTMLInputElement && a.type === 'range' && main.contains(a)) {
      if (!pending) { pending = true; a.addEventListener('change', () => { pending = false; render(); }, { once: true }); }
      renderActions(st);
      return;
    }
    renderActions(st); renderNp(nowPlaying.get(), st); renderSet(st); renderStyle(); renderColour(st); renderFeel(); void renderOutput(st);
  };
  state.subscribe(render);
  ctl.album.subscribe(render, false);

  // ── Keys act on the output ──
  const typing = (t: EventTarget | null): boolean => (t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox') || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target) || sheet.isOpen()) return;
    if (!FORWARD.test(e.key)) return;
    e.preventDefault();
    act({ a: 'key', key: e.key });
  });

  // ── First time on a second display: ask ──
  if (new URLSearchParams(location.search).has('offer')) {
    const yes = button('Yes, control it here', { variant: 'primary', onClick: () => { s.controllerOffered = true; ctl.commit(); card.remove(); } });
    const no = button('Not now', { onClick: () => { s.controllerOffered = true; ctl.commit(); window.setTimeout(() => (desktop.close ? desktop.close() : window.close()), 50); } });
    const card = h('div', { class: 'ctl-offer' }, h('div', { class: 'ctl-offer-card' }, lockup(),
      h('h1', { class: 's-h2' }, 'control sonora from this screen?'),
      h('p', { class: 's-small' }, 'The visual stays full screen on the other display. This window becomes the remote: a live preview, Set Mode, styles, palettes and every setting. Closing it never stops the visual.'),
      h('div', { class: 'ctl-btns' }, yes, no)));
    document.body.append(card);
    window.setTimeout(() => yes.focus(), 80);
  }
  void icon;
}
