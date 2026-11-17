/**
 * In-visual controls: a minimal bar that hides itself (Menu, what's on screen
 * + quick switcher, Set Mode, palette, fullscreen, settings), the now-playing
 * overlay and the Set Mode corner label. H hides everything (clean mode).
 */

import { describe, mediaFor, STYLE_INFO } from '../../app/catalog';
import type { Controller } from '../../app/controller';
import type { Platform } from '../../app/platform';
import { nowPlaying, type MediaInfo } from '../../app/stores';
import { PALETTES } from '../../engine/color-engine';
import { getStyle } from '../../styles/registry';
import { button, icon, thumb, toast } from '../ds/components';
import { append, h } from '../ds/dom';
import { glint } from './brand';

/** Idle time before the bar hides (ms); how long the song shows on a change (ms). */
const IDLE_MS = 2600;
const NP_SHOW_MS = 5000;

export interface HudHandlers {
  menu(): void;
  settings(section?: string): void;
  setMode(on: boolean): void;
}

export interface Hud {
  show(): void;
  hide(): void;
  setClean(on: boolean): void;
  isClean(): boolean;
  toggleQuick(): void;
  flashNowPlaying(): void;
}

export function createHud(ctl: Controller, platform: Platform, on: HudHandlers): Hud {
  const s = ctl.settings;
  const nStyle = h('span', { class: 'n-style' });
  const nDesc = h('span', { class: 'n-desc s-micro' });
  const now = h('button', { class: 'now', type: 'button', title: 'Switch look, view or palette' }, nStyle, nDesc, icon('chevronDown'));
  const smBtn = button('Set mode', { title: 'Set Mode (M)', onClick: () => on.setMode(!s.setMode.on) });
  const swatch = h('i', { class: 'swatch' });
  const palBtn = button('', { title: 'Palette', onClick: () => toggleQuick() });
  palBtn.append(swatch);
  const fsBtn = button('', { icon: 'expand', title: 'Fullscreen (F)', onClick: () => platform.toggleFullscreen() });
  const bar = h('div', { class: 'hud-bar' },
    h('div', null, button('Menu', { icon: 'grid', title: 'Menu (Esc)', onClick: () => on.menu() }), now),
    h('div', null, smBtn, palBtn, fsBtn, button('', { icon: 'settings', title: 'Settings', onClick: () => on.settings() })));
  const qs = h('div', { class: 'qs', role: 'dialog', 'aria-label': 'Quick switcher' });
  const hud = h('div', { class: 'hud s-root', hidden: true }, qs, bar);
  const smLabel = h('div', { class: 'sm-label s-root', hidden: true }, glint(), h('span', { class: 's-label s-bone' }, 'set mode'));
  smLabel.querySelector('svg')!.setAttribute('style', 'width:18px;height:18px;color:var(--bone)');
  const np = h('div', { class: 'np-overlay s-root' });
  document.body.append(hud, smLabel, np);
  now.addEventListener('click', () => toggleQuick());

  platform.onFullscreenChange((fs) => fsBtn.replaceChildren(icon(fs ? 'collapse' : 'expand')));

  // ── Quick switcher ──
  function buildQuick(): void {
    const id = s.mode;
    const d = getStyle(id);
    const info = STYLE_INFO[id];
    const look = ctl.variantFor(id);
    const depth = ctl.depthFor(id);
    qs.replaceChildren();
    if (info.looks.length) {
      const r = h('div', { class: 'qs-row' });
      for (const l of info.looks) {
        r.append(thumb({ media: mediaFor(l.media), title: l.label, selected: l.id === look && (!l.depthOnly || depth),
          onClick: () => { if (l.depthOnly && !depth) ctl.setDepth(true); ctl.setVariant(l.id); } }).el);
      }
      qs.append(h('div', { class: 'qs-grp' }, h('span', { class: 's-label' }, 'look'), r));
    }
    if (d.supportsDepth) {
      const r = h('div', { class: 'qs-row' });
      for (const dp of [true, false]) {
        r.append(thumb({ media: mediaFor(`${id}-view-${dp ? 'depth' : 'flat'}`), title: dp ? 'Depth' : 'Flat', selected: depth === dp, onClick: () => ctl.setDepth(dp) }).el);
      }
      qs.append(h('div', { class: 'qs-grp' }, h('span', { class: 's-label' }, 'view'), r));
    }
    const r = h('div', { class: 'qs-row pal' });
    PALETTES.slice(0, 9).forEach((p, i) => {
      const t = thumb({ media: mediaFor(`pal-${id}-${i}`, `pal-ink-${i}`), title: `${i + 1} ${p.name.replace(' / Black', ' duo')}`, selected: s.paletteIndex === i, hoverPlay: false, onClick: () => ctl.setPalette(i) });
      t.el.classList.add('pal-thumb');
      t.media.el.append(h('i', { class: 'pal-chip', style: { background: p.preview } }));
      r.append(t.el);
    });
    qs.append(h('div', { class: 'qs-grp' }, h('div', { style: { display: 'flex', justifyContent: 'space-between' } }, h('span', { class: 's-label' }, 'palette'), h('span', { class: 's-micro' }, `keys 1–9 · ${s.matchColours ? 'all styles' : `for ${info.label.toLowerCase()}`}`)), r));
  }
  function toggleQuick(): void {
    const open = !qs.classList.contains('open');
    if (open) buildQuick();
    qs.classList.toggle('open', open);
    bar.classList.toggle('pinned', open);
  }
  document.addEventListener('pointerdown', (e) => {
    if (!qs.classList.contains('open')) return;
    const p = e.composedPath();
    if (p.includes(qs) || p.includes(now) || p.includes(palBtn)) return;
    qs.classList.remove('open'); bar.classList.remove('pinned');
  });

  function sync(): void {
    const id = s.mode;
    const d = getStyle(id);
    nStyle.textContent = STYLE_INFO[id].label.toLowerCase();
    nDesc.textContent = describe(id, ctl.variantFor(id), ctl.depthFor(id), d.supportsDepth).split(' · ').slice(1).join(' · ');
    smBtn.setAttribute('aria-pressed', String(s.setMode.on));
    smLabel.hidden = !s.setMode.on || hud.hidden;
    const p = s.paletteIndex >= 0 ? PALETTES[s.paletteIndex] : null;
    swatch.style.background = p ? p.preview : `hsl(${s.customHue} 70% 52%)`;
    np.className = `np-overlay s-root ${s.nowPlaying.position}${np.classList.contains('show') ? ' show' : ''}`;
    if (qs.classList.contains('open')) buildQuick();
  }
  ctl.subscribe(sync);

  // ── Idle / clean mode ──
  let idleTimer = 0;
  let clean = false;
  const active = (): boolean => !hud.hidden;
  function wake(): void {
    if (!active()) return;
    document.body.classList.remove('sonora-idle');
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => { if (active()) document.body.classList.add('sonora-idle'); }, IDLE_MS);
    if (lastMedia) peekNowPlaying(IDLE_MS + 400);
  }
  ['pointermove', 'pointerdown', 'wheel'].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));

  // ── Now playing overlay ──
  let lastMedia: MediaInfo | null = null;
  let npTimer = 0;
  function renderNp(m: MediaInfo): void {
    const ctlRow = s.nowPlaying.controls && platform.mediaControl ? h('div', { class: 'np-ctl' },
      m.canPrev ? h('button', { type: 'button', title: 'Previous', onclick: () => platform.mediaControl?.('prev') }, icon('prev')) : null,
      m.canPlayPause ? h('button', { type: 'button', title: m.playing ? 'Pause' : 'Play', onclick: () => platform.mediaControl?.('playpause') }, icon(m.playing ? 'pause' : 'play')) : null,
      m.canNext ? h('button', { type: 'button', title: 'Next', onclick: () => platform.mediaControl?.('next') }, icon('next')) : null) : null;
    np.replaceChildren();
    append(np, [
      m.art ? h('img', { src: m.art, alt: '' }) : null,
      h('div', { class: 'np-t' }, h('span', { class: 'np-title' }, m.title), h('span', { class: 'np-meta s-micro' }, [m.artist, m.album].filter(Boolean).join(' · ')), ctlRow),
    ]);
  }
  function peekNowPlaying(ms: number): void {
    if (!lastMedia || !s.nowPlaying.show || !active() || clean) return;
    np.classList.add('show');
    window.clearTimeout(npTimer);
    npTimer = window.setTimeout(() => np.classList.remove('show'), ms);
  }
  let lastKey = '';
  nowPlaying.subscribe((m) => {
    lastMedia = m && m.title ? m : null;
    if (!lastMedia) { np.classList.remove('show'); np.replaceChildren(); lastKey = ''; return; }
    renderNp(lastMedia);
    const key = `${lastMedia.title}\u0000${lastMedia.artist}`;
    if (key !== lastKey) { lastKey = key; peekNowPlaying(NP_SHOW_MS); }
  });

  return {
    show() {
      hud.hidden = false;
      sync();
      wake();
    },
    hide() {
      hud.hidden = true;
      smLabel.hidden = true;
      np.classList.remove('show');
      qs.classList.remove('open');
      document.body.classList.remove('sonora-idle');
    },
    setClean(v: boolean) {
      clean = v;
      document.body.classList.toggle('sonora-clean', v);
      if (v) { qs.classList.remove('open'); np.classList.remove('show'); }
      toast(v ? 'clean mode · h to show controls' : 'controls back', { ms: 1600 });
      if (!v) wake();
    },
    isClean: () => clean,
    toggleQuick,
    flashNowPlaying: () => peekNowPlaying(NP_SHOW_MS),
  };
}
