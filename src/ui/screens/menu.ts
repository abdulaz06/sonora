/**
 * Home menu: five style cards as a film strip (the focused one opens wide and
 * plays its loop), then a dock with Continue, Set Mode and the live audio
 * status. Pre-rendered media only: the engine is paused while this shows.
 */

import { ART_STYLES, CLASSIC_STYLES, describe, mediaFor, mediaNameFor, STYLE_INFO } from '../../app/catalog';
import type { Controller } from '../../app/controller';
import { audioStatus, nowPlaying, type MediaInfo } from '../../app/stores';
import { getStyle } from '../../styles/registry';
import type { StyleId } from '../../styles/visual-style';
import { button, icon, media, meter, type Media } from '../ds/components';
import { h } from '../ds/dom';
import { lockup } from './brand';

/** The first open card's loop starts this long after the menu first shows (ms). */
const FIRST_LOOP_DELAY_MS = 1600;

export interface MenuHandlers {
  openStyle(id: StyleId, from: HTMLElement): void;
  resume(from: HTMLElement): void;
  startSetMode(from: HTMLElement): void;
  openSettings(section?: string): void;
  openKeys(): void;
  openAbout(): void;
  openAudio(): void;
  /** Desktop: the Export screen (absent on the web page). */
  openExport?: () => void;
}

export interface MenuScreen { el: HTMLElement; show(): void; hide(): void; refresh(): void; focusFirst(): void }

export function createMenu(ctl: Controller, on: MenuHandlers, platform: 'desktop' | 'web'): MenuScreen {
  const s = ctl.settings;

  // ── Top bar ──
  const npSlot = h('div', { class: 'np-inline' });
  const top = h('header', { class: 'topbar' },
    lockup(),
    h('div', { class: 'topbar-right' }, npSlot,
      on.openExport ? button('Export', { variant: 'ghost', title: 'Export a video from a song (E)', onClick: () => on.openExport?.() }) : null,
      button('Settings', { variant: 'ghost', onClick: () => on.openSettings() }),
      button('Keys', { variant: 'ghost', onClick: () => on.openKeys() }),
      button('About', { variant: 'ghost', onClick: () => on.openAbout() })));

  // ── Style strip ──
  const classicRow = h('div', { class: 'classic-row' });
  const head = h('div', { class: 'menu-head' },
    h('h1', { class: 's-display' }, 'choose a style'),
    h('div', { class: 'menu-sub' }, classicRow, h('span', { class: 's-micro' }, `01 — ${String(ART_STYLES.length).padStart(2, '0')} · enter to open`)));
  // Many styles: closed cards get narrow, so their names stand vertically (screens.css).
  const strip = h('div', { class: ART_STYLES.length > 6 ? 'strip many' : 'strip', role: 'list' });
  const cards: { id: StyleId; el: HTMLButtonElement; media: Media }[] = [];
  let openIdx = 0;

  ART_STYLES.forEach((id, i) => {
    const info = STYLE_INFO[id];
    const m = media(mediaFor(id), { large: true, eager: true });
    const looks = h('div', { class: 'looks' });
    for (const l of info.looks) {
      const lm = media(mediaFor(l.media));
      looks.append(h('figure', null, lm.el, h('figcaption', null, l.label)));
    }
    const card = h('button', { class: 'scard', type: 'button', role: 'listitem', 'aria-label': `${info.label}. ${info.line}` },
      m.el,
      h('div', { class: 'cap' },
        h('div', { class: 'cap-top' },
          h('span', { class: 'idx' }, String(i + 1).padStart(2, '0')),
          info.heavy ? h('span', { class: 'heavy' }, 'heavy on graphics') : null),
        h('div', { class: 'cap-bottom' },
          h('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0' } },
            h('span', { class: 'name' }, info.label.toLowerCase()),
            h('div', { class: 'detail' }, h('span', { class: 'line' }, info.line), h('span', { class: 'suits' }, `suits ${info.suits}`))),
          looks),
        h('span', { class: 'open-hint s-label s-bone' }, 'open', icon('arrowRight'))));
    card.addEventListener('pointerenter', () => setOpen(i));
    card.addEventListener('focus', () => setOpen(i));
    card.addEventListener('click', () => on.openStyle(id, m.el));
    strip.append(card);
    cards.push({ id, el: card, media: m });
  });

  // The first time the menu shows, the open card's loop waits a moment: its still paints first
  // (a quick first paint; the page's largest picture is the still, not a video's first frame).
  let firstShow = true;
  let holdUntil = 0;
  let loopTimer = 0;
  function setOpen(i: number): void {
    openIdx = i;
    window.clearTimeout(loopTimer);
    const wait = holdUntil - performance.now();
    cards.forEach((c, k) => {
      const open = k === i;
      c.el.classList.toggle('is-open', open);
      if (open && wait > 0) loopTimer = window.setTimeout(() => { if (openIdx === k && !el.hidden) c.media.play(); }, wait);
      else if (open) c.media.play(); else c.media.stop();
    });
  }
  strip.addEventListener('pointerleave', () => {
    // Keep the focused card open when the pointer leaves.
    const f = cards.findIndex((c) => c.el === document.activeElement);
    if (f >= 0) setOpen(f);
  });

  // ── Dock ──
  const resumeMedia = media(mediaFor('ink'));
  const resumeTitle = h('div', { class: 'd-title' });
  const resume = h('button', { class: 'resume', type: 'button' },
    resumeMedia.el,
    h('div', { style: { minWidth: '0' } }, h('div', { class: 'd-label' }, h('span', { class: 's-label' }, 'continue')), resumeTitle,
      h('div', { class: 'd-sub' }, 'where you left off')),
    icon('arrowRight'));
  resume.lastElementChild?.classList.add('s-arrow');
  resume.addEventListener('click', () => on.resume(resumeMedia.el));
  resume.addEventListener('pointerenter', () => resumeMedia.play());
  resume.addEventListener('pointerleave', () => resumeMedia.stop());
  resume.addEventListener('focus', () => resumeMedia.play());
  resume.addEventListener('blur', () => resumeMedia.stop());

  const smState = h('span', { class: 's-micro' });
  const setmode = h('button', { class: 'setmode', type: 'button' },
    h('div', { style: { minWidth: '0' } },
      h('div', { class: 'd-label' }, h('span', { class: 's-label' }, 'set mode', h('span', { class: 'sm-mark' }, h('i'), h('i'), h('i'))), smState),
      h('div', { class: 'd-title' }, 'let sonora choose'),
      h('div', { class: 'd-sub' }, 'it switches visuals with the music, like a VJ.')),
    icon('arrowRight'));
  setmode.lastElementChild?.classList.add('s-arrow');
  setmode.addEventListener('click', () => on.startSetMode(setmode));

  const dot = h('i', { class: 'status-dot' });
  const dev = h('span', { class: 'l-dev' });
  const msg = h('div', { class: 'l-msg' });
  const mtr = meter(22);
  const change = button(platform === 'web' ? 'Choose source' : 'Change', { onClick: () => on.openAudio() });
  const listen = h('div', { class: 'listen' },
    h('div', { class: 'd-label' }, h('span', { class: 's-label' }, dot, 'listening to'), change),
    h('div', { class: 'l-row' }, dev, mtr.el),
    msg);

  const dock = h('div', { class: 'dock' }, resume, setmode, listen);
  const el = h('section', { class: 'scr scr-menu s-root', hidden: true, 'aria-label': 'Home' }, top, head, strip, dock);

  // ── Live data ──
  audioStatus.subscribe((a) => {
    mtr.set(a.level);
    dot.classList.toggle('on', a.hearing);
    dev.textContent = a.device || (platform === 'web' ? 'no source chosen' : 'looking for your speakers…');
    if (a.hearing) msg.replaceChildren(h('b', null, 'hearing your music.'), ' everything reacts to it.');
    else if (platform === 'web') msg.textContent = 'share a tab with music, play a file, or use the microphone.';
    else if (!a.device) msg.textContent = 'no playback device found. plug in speakers or headphones; sonora picks them up by itself.';
    else msg.textContent = 'play something in Spotify, YouTube, anything. sonora listens to whatever your PC is playing.';
  });
  nowPlaying.subscribe((m: MediaInfo | null) => {
    npSlot.replaceChildren();
    if (!m || !m.title) return;
    if (m.art) npSlot.append(h('img', { src: m.art, alt: '' }));
    npSlot.append(h('span', { class: 's-micro' }, m.playing ? 'now playing' : 'paused'),
      h('span', { class: 'np-text' }, h('span', { class: 'np-title' }, m.title), m.artist ? h('span', { class: 'np-artist' }, m.artist) : null));
  });

  function refresh(): void {
    const id = s.mode;
    const d = getStyle(id);
    const look = ctl.variantFor(id);
    const depth = ctl.depthFor(id);
    resumeMedia.set(mediaFor(mediaNameFor(id, look, depth), id));
    resumeTitle.textContent = describe(id, look, depth, d.supportsDepth);
    smState.textContent = s.setMode.on ? 'on' : 'off';
    setmode.classList.toggle('on', s.setMode.on);
    classicRow.replaceChildren();
    if (s.showClassic) {
      classicRow.append(h('span', { class: 's-micro' }, 'classic'));
      for (const c of CLASSIC_STYLES) {
        const b = button(STYLE_INFO[c].label, { size: 'sm' });
        b.addEventListener('click', () => on.openStyle(c, b));
        classicRow.append(b);
      }
    }
  }

  let settleTimer = 0;
  return {
    el,
    show() {
      refresh();
      el.hidden = false;
      el.classList.remove('is-in', 'is-settled');
      const cur = ART_STYLES.indexOf(s.mode);
      if (firstShow) holdUntil = performance.now() + FIRST_LOOP_DELAY_MS;
      firstShow = false;
      setOpen(cur >= 0 ? cur : openIdx);
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('is-in')));
      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => el.classList.add('is-settled'), 1200);
    },
    hide() {
      el.hidden = true;
      el.classList.remove('is-in', 'is-settled');
      cards.forEach((c) => c.media.stop());
      resumeMedia.stop();
    },
    refresh,
    focusFirst() { cards[openIdx]?.el.focus({ preventScroll: true, focusVisible: false } as FocusOptions); },
  };
}
