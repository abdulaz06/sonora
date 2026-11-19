/**
 * App shell: launch → (first run) → home menu ⇄ style detail → visual.
 * The engine only renders while the visual shows; on the menu the render loop
 * is stopped and audio analysis keeps running so meters stay live.
 * Owns keyboard shortcuts (consolidated here) and arrow-key navigation.
 */

import { ART_STYLES, STYLE_INFO } from './catalog';
import type { Controller } from './controller';
import type { Platform } from './platform';
import { createSetMode, type SetMode } from './set-mode';
import { audioStatus, feedLevel, nowPlaying } from './stores';
import { getStyle, visibleStyles } from '../styles/registry';
import type { StyleId } from '../styles/visual-style';
import { closeInfo, toast } from '../ui/ds/components';
import { createDetail } from '../ui/screens/detail';
import { expandFrom } from '../ui/screens/expand';
import { createFpsReadout } from '../ui/screens/fps-readout';
import { createHud } from '../ui/screens/hud';
import { playLaunch } from '../ui/screens/launch';
import { createMenu } from '../ui/screens/menu';
import { runOnboarding } from '../ui/screens/onboarding';
import { createSettings } from '../ui/screens/settings';
import '../ui/ds/ds.css';
import '../ui/screens/screens.css';

type Screen = 'boot' | 'intro' | 'menu' | 'detail' | 'visual';

export interface Shell {
  screen(): Screen;
  setMode: SetMode;
  goMenu(): void;
  goVisual(): void;
  openStyle(id: StyleId): void;
}

export interface ShellOptions {
  /** Skip the launch moment (web screenshots, tests). */
  noLaunch?: boolean;
  /** Start on this screen (web: ?screen=). */
  start?: 'menu' | 'detail' | 'visual' | 'intro';
  startStyle?: StyleId;
}

export async function initShell(ctl: Controller, platform: Platform, opts: ShellOptions = {}): Promise<Shell> {
  const s = ctl.settings;
  const renderer = ctl.renderer;
  document.body.classList.add('s-root');
  let screen: Screen = 'boot';

  // ── Set Mode ──
  const setMode = createSetMode(ctl, (on) => {
    platform.setTraySetMode?.(on);
    toast(on ? 'set mode on · sonora chooses' : 'set mode off', { ms: 1800 });
  });
  const setSetMode = (on: boolean): void => {
    if (on === s.setMode.on) return;
    setMode.setOn(on);
    if (on) {
      if (screen === 'visual') setMode.switchNow(false);
      else { setMode.switchNow(true); goVisual(); }
    }
  };
  platform.setTraySetMode?.(s.setMode.on);
  renderer.onEvent((e) => setMode.onEvent(e));
  ctl.onLevel((level, frame) => { feedLevel(level); setMode.onFrame(frame); });

  // Real track changes from the media session tell the event layer (the
  // silence-gap detector stays as the fallback).
  let lastTrack = '';
  nowPlaying.subscribe((m) => {
    if (!m || !m.title) return;
    const key = `${m.title}\u0000${m.artist}`;
    if (key === lastTrack) return;
    const first = lastTrack === '';
    lastTrack = key;
    if (!first) renderer.events.notifyTrackChange({ title: m.title, artist: m.artist });
  });

  // ── Screens ──
  const settings = createSettings(ctl, platform, {
    replayIntro: () => startIntro(),
    setSetMode,
  });
  const openAudio = (): void => {
    if (platform.kind === 'web' && platform.openSourceChooser) platform.openSourceChooser();
    else settings.open('audio');
  };
  const menu = createMenu(ctl, {
    openStyle: (id) => openStyle(id),
    resume: (from) => goVisual(from),
    startSetMode: (from) => {
      if (!s.setMode.on) { setMode.setOn(true); setMode.switchNow(true); }
      goVisual(from);
    },
    openSettings: (sec) => settings.open(sec),
    openKeys: () => settings.open('keys'),
    openAbout: () => settings.open('about'),
    openAudio,
  }, platform.kind);
  const detail = createDetail(ctl, {
    back: () => goMenu(),
    start: (id, look, depth, from) => {
      ctl.show(id, { variant: look, depth, cut: true });
      goVisual(from);
    },
  });
  const hud = createHud(ctl, platform, {
    menu: () => goMenu(),
    settings: (sec) => settings.open(sec),
    setMode: (on) => setSetMode(on),
  });
  document.body.append(menu.el, detail.el);
  const fps = createFpsReadout(renderer);
  const syncFps = (): void => fps.set(s.showFps && screen === 'visual', s.fpsCorner);
  ctl.subscribe(() => { if (screen === 'menu') menu.refresh(); syncFps(); });

  function overlay(on: boolean): void { document.body.classList.toggle('scr-overlay', on); }

  function goMenu(): void {
    if (screen === 'menu') return;
    closeInfo();
    renderer.stop();
    ctl.setCanvasInput(false);
    hud.hide();
    detail.hide();
    overlay(true);
    screen = 'menu';
    syncFps();
    menu.show();
    window.setTimeout(() => menu.focusFirst(), 50);
  }

  function openStyle(id: StyleId): void {
    closeInfo();
    menu.hide();
    screen = 'detail';
    detail.open(id);
  }

  let entering = false;
  async function goVisual(from?: HTMLElement): Promise<void> {
    if (screen === 'visual' || entering) return;
    entering = true;
    closeInfo();
    const exp = from ? await expandFrom(from) : null;
    menu.hide();
    detail.hide();
    overlay(false);
    renderer.start();
    ctl.setCanvasInput(true);
    screen = 'visual';
    syncFps();
    hud.show();
    entering = false;
    if (exp) await exp.dissolve();
  }

  function startIntro(): void {
    renderer.stop();
    hud.hide(); menu.hide(); detail.hide();
    overlay(true);
    screen = 'intro';
    syncFps();
    const el = runOnboarding(platform.kind, {
      done: () => {
        s.onboarded = true;
        ctl.commit();
        el.classList.add('s-fade');
        el.style.transition = 'opacity 400ms var(--ease-io)';
        el.style.opacity = '0';
        window.setTimeout(() => el.remove(), 420);
        screen = 'boot';
        goMenu();
      },
      openAudio,
    });
  }

  // ── Keyboard ──
  const nextLook = (): void => {
    const id = s.mode;
    const info = STYLE_INFO[id];
    const d = getStyle(id);
    if (id === 'wisp') {
      // Flat → Ground → Tunnel → Flat
      const depth = ctl.depthFor(id), look = ctl.variantFor(id);
      if (!depth) { ctl.setVariant('ground'); ctl.setDepth(true); } else if (look === 'ground') ctl.setVariant('tunnel'); else ctl.setDepth(false);
    } else if (info.looks.length > 1) {
      const i = info.looks.findIndex((l) => l.id === ctl.variantFor(id));
      ctl.setVariant(info.looks[(i + 1) % info.looks.length].id);
    } else if (d.supportsDepth) ctl.setDepth(!ctl.depthFor(id));
    else return;
    const look = STYLE_INFO[id].looks.find((l) => l.id === ctl.variantFor(id));
    toast([look && (!look.depthOnly || ctl.depthFor(id)) ? look.label : '', d.supportsDepth ? (ctl.depthFor(id) ? 'depth' : 'flat') : ''].filter(Boolean).join(' · ').toLowerCase(), { ms: 1200 });
  };

  const typing = (t: EventTarget | null): boolean => t instanceof HTMLInputElement && t.type !== 'range' && t.type !== 'checkbox'
    || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement;

  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.altKey || e.metaKey || typing(e.target)) return;
    const k = e.key;
    const lower = k.toLowerCase();
    if (k === 'F11' || lower === 'f') { e.preventDefault(); platform.toggleFullscreen(); return; }
    if (settings.isOpen() || screen === 'intro' || screen === 'boot') return;
    if (k === 'Escape') {
      if (screen === 'visual') { if (hud.isClean()) hud.setClean(false); else if (platform.isFullscreen() && !s.fullscreen) platform.toggleFullscreen(); else goMenu(); }
      else if (screen === 'detail') goMenu();
      return;
    }
    if (lower === 'm') { setSetMode(!s.setMode.on); return; }
    if (screen === 'visual') {
      if (lower === 'h') hud.setClean(!hud.isClean());
      else if (lower === 'd') ctl.toggleDebug();
      else if (lower === 's') {
        const list = visibleStyles(s.showClassic);
        const i = list.findIndex((x) => x.id === s.mode);
        const nx = list[(i + 1) % list.length].id;
        ctl.show(nx);
        toast(STYLE_INFO[nx].label.toLowerCase(), { ms: 1200 });
      } else if (lower === 'v') nextLook();
      else if (lower === 'c') ctl.cycleCameraPreset();
      else if (lower === 'p') { ctl.setShowFps(!s.showFps); toast(s.showFps ? 'fps on' : 'fps off', { ms: 900 }); }
      else if (/^[1-9]$/.test(k)) ctl.setPalette(Number(k) - 1);
      else if (k === '0') ctl.setPalette(9);
      return;
    }
    if (k.startsWith('Arrow')) { e.preventDefault(); spatialMove(k); }
  });

  // Arrow keys move focus to the nearest control in that direction (gamepad style).
  function spatialMove(key: string): void {
    const root = screen === 'menu' ? menu.el : screen === 'detail' ? detail.el : document.body;
    const items = [...root.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"], select, input')].filter((x) => x.offsetParent !== null);
    const cur = document.activeElement instanceof HTMLElement && items.includes(document.activeElement) ? document.activeElement : null;
    if (!cur) { items[0]?.focus(); return; }
    const a = cur.getBoundingClientRect();
    const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best: HTMLElement | null = null, bestD = Infinity;
    for (const it of items) {
      if (it === cur) continue;
      const b = it.getBoundingClientRect();
      const bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const ok = key === 'ArrowRight' ? dx > 4 : key === 'ArrowLeft' ? dx < -4 : key === 'ArrowDown' ? dy > 4 : dy < -4;
      if (!ok) continue;
      const along = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dx) : Math.abs(dy);
      const across = key === 'ArrowRight' || key === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      const d = along + across * 2.2;
      if (d < bestD) { bestD = d; best = it; }
    }
    best?.focus();
  }

  // ── Tray ──
  platform.onTray?.((a) => {
    if (a === 'menu') goMenu();
    else if (a === 'setmode') setSetMode(!s.setMode.on);
  });

  // ── Start ──
  s.launches += 1;
  ctl.commit();
  renderer.stop();
  overlay(true);
  const start = opts.start ?? (!s.onboarded ? 'intro' : s.openLastVisual ? 'visual' : 'menu');
  if (!opts.noLaunch) await playLaunch(s.launches > 3);
  if (start === 'intro') startIntro();
  else if (start === 'visual') { screen = 'boot'; void goVisual(); }
  else if (start === 'detail') { screen = 'boot'; openStyle(opts.startStyle ?? ART_STYLES[0]); }
  else goMenu();
  if (s.setMode.on && start === 'visual') setMode.switchNow(false);

  // Audio status line for the debug / device name is filled by the entry.
  void audioStatus;

  return {
    screen: () => screen,
    setMode,
    goMenu,
    goVisual: () => { void goVisual(); },
    openStyle,
  };
}
