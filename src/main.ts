import {
  LogicalPosition,
  LogicalSize,
  availableMonitors,
  getCurrentWindow,
  primaryMonitor,
  type Monitor,
} from '@tauri-apps/api/window';

import { TauriFrameSource } from './audio/tauri-source';
import { initController } from './app/controller';
import { initRenderer } from './engine/renderer';
import {
  getCurrentDevice,
  listDevices,
  onDeviceChanged,
  setDevice,
} from './ipc/audio-device';
import { createSettingsSaver, loadSettings, type PersistedSettings } from './ipc/settings';
import { initFullscreen } from './ui/fullscreen';

/** Min logical-px overlap between window and a monitor we'll accept. */
const MIN_VISIBLE_PX = 100;
/** Approx title-bar height (logical px) — point we require on a monitor. */
const TITLE_BAR_INSET = 16;
/** Tauri.conf.json minWidth/minHeight — must be respected when clamping. */
const MIN_WIDTH = 640;
const MIN_HEIGHT = 400;
/** Margin left around a fullscreen-ish saved size so the window never fills
 *  every pixel of a smaller monitor than the one it was last sized on. */
const MAX_MARGIN = 100;

interface LogicalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Convert a Monitor's physical bounds to a logical-px rect using its own
 *  scaleFactor (each monitor can have its own DPI on Windows). */
function monitorRect(mon: Monitor): LogicalRect {
  const sf = mon.scaleFactor || 1;
  return {
    x: mon.position.x / sf,
    y: mon.position.y / sf,
    width: mon.size.width / sf,
    height: mon.size.height / sf,
  };
}

/** A position is valid if a usable chunk of the window overlaps some monitor
 *  AND the title-bar centre is on that monitor (so the user can grab it). */
function isPositionVisible(win: LogicalRect, monitors: Monitor[]): boolean {
  const titleX = win.x + win.width / 2;
  const titleY = win.y + TITLE_BAR_INSET;
  for (const mon of monitors) {
    const m = monitorRect(mon);
    const titleOnMonitor =
      titleX >= m.x && titleX < m.x + m.width &&
      titleY >= m.y && titleY < m.y + m.height;
    if (!titleOnMonitor) continue;

    const ix = Math.max(0, Math.min(win.x + win.width, m.x + m.width) - Math.max(win.x, m.x));
    const iy = Math.max(0, Math.min(win.y + win.height, m.y + m.height) - Math.max(win.y, m.y));
    if (ix >= MIN_VISIBLE_PX && iy >= MIN_VISIBLE_PX) return true;
  }
  return false;
}

/** Cap a saved size so a stale 4K size doesn't make the window wider than a
 *  1920 monitor. Respects the tauri.conf.json minWidth/minHeight floor. */
function clampSize(width: number, height: number, monitors: Monitor[]): { width: number; height: number } {
  let maxW = 0;
  let maxH = 0;
  for (const mon of monitors) {
    const r = monitorRect(mon);
    if (r.width > maxW) maxW = r.width;
    if (r.height > maxH) maxH = r.height;
  }
  const wCap = maxW > MAX_MARGIN ? maxW - MAX_MARGIN : Number.POSITIVE_INFINITY;
  const hCap = maxH > MAX_MARGIN ? maxH - MAX_MARGIN : Number.POSITIVE_INFINITY;
  return {
    width: Math.max(MIN_WIDTH, Math.min(wCap, width)),
    height: Math.max(MIN_HEIGHT, Math.min(hCap, height)),
  };
}

async function applyInitialWindowState(settings: PersistedSettings): Promise<void> {
  // Fullscreen is handled by initFullscreen(initial). Position/size we set here
  // before any UI is mounted. If validation rejects the saved position we just
  // skip setPosition — `center: true` in tauri.conf.json has already centred
  // the window at creation, so doing nothing is the right fallback.
  try {
    const win = getCurrentWindow();
    const w = settings.window;

    let monitors: Monitor[] = [];
    try {
      monitors = await availableMonitors();
    } catch (err) {
      console.warn('Could not enumerate monitors; skipping window-position restore:', err);
      return;
    }

    let width = Number.isFinite(w.width) ? w.width : MIN_WIDTH;
    let height = Number.isFinite(w.height) ? w.height : MIN_HEIGHT;
    if (monitors.length > 0) {
      ({ width, height } = clampSize(width, height, monitors));
    }
    if (Number.isFinite(w.width) && Number.isFinite(w.height)) {
      await win.setSize(new LogicalSize(width, height));
    }

    if (typeof w.x === 'number' && typeof w.y === 'number') {
      const candidate: LogicalRect = { x: w.x, y: w.y, width, height };
      if (monitors.length > 0 && isPositionVisible(candidate, monitors)) {
        await win.setPosition(new LogicalPosition(w.x, w.y));
      } else {
        console.warn(
          `Saved window position (${w.x}, ${w.y}) is not visible on any monitor; ` +
            'leaving window centred via tauri.conf.json.',
        );
      }
    }
  } catch (err) {
    console.warn('Could not restore window state:', err);
  }
}

/** 3-second startup safety net — catches off-screen windows from any cause
 *  (stale saved position, an upstream Tauri bug, a buggy multi-monitor
 *  reshuffle). After SAFETY_NET_DELAY_MS, if the user hasn't produced a
 *  mouse/keyboard event AND the window's actual position is off-screen,
 *  recentre on the primary monitor and force-show. Only runs once. */
const SAFETY_NET_DELAY_MS = 3000;

function armWindowVisibilitySafetyNet(): void {
  let interacted = false;
  const mark = (): void => {
    interacted = true;
  };
  const opts: AddEventListenerOptions = { once: true, capture: true };
  document.addEventListener('mousemove', mark, opts);
  document.addEventListener('mousedown', mark, opts);
  document.addEventListener('keydown', mark, opts);

  window.setTimeout(() => {
    document.removeEventListener('mousemove', mark, true);
    document.removeEventListener('mousedown', mark, true);
    document.removeEventListener('keydown', mark, true);
    if (interacted) return;
    void recentreIfOffScreen();
  }, SAFETY_NET_DELAY_MS);
}

async function recentreIfOffScreen(): Promise<void> {
  const win = getCurrentWindow();
  let offScreen: boolean;
  try {
    const [pos, size, sf, monitors] = await Promise.all([
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
      availableMonitors(),
    ]);
    const rect: LogicalRect = {
      x: pos.x / sf,
      y: pos.y / sf,
      width: size.width / sf,
      height: size.height / sf,
    };
    offScreen = monitors.length === 0 || !isPositionVisible(rect, monitors);
  } catch (err) {
    console.warn('Could not query window position for safety net:', err);
    // Couldn't tell — assume the worst and recentre anyway, since the user
    // hasn't interacted in 3s and that's already a strong "invisible" signal.
    offScreen = true;
  }

  if (!offScreen) return;

  console.warn('Window appears off-screen after 3s with no interaction; recentring.');
  try {
    const primary = await primaryMonitor();
    if (primary) {
      const m = monitorRect(primary);
      const inner = await win.innerSize();
      const sf = primary.scaleFactor || 1;
      const winW = inner.width / sf;
      const winH = inner.height / sf;
      const cx = Math.round(m.x + (m.width - winW) / 2);
      const cy = Math.round(m.y + (m.height - winH) / 2);
      await win.setPosition(new LogicalPosition(cx, cy));
    }
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch (err) {
    console.warn('Failed to recentre window:', err);
  }
}

function watchWindowState(
  onChange: (size: { width: number; height: number }, pos: { x: number; y: number } | null) => void,
): void {
  // Debounced via the settings saver upstream — these fire continuously while
  // the user drags. The saver coalesces, so we forward every event.
  void (async () => {
    try {
      const win = getCurrentWindow();
      await win.onResized(async () => {
        try {
          if (await win.isFullscreen()) return; // don't persist fullscreen size
          const sz = await win.innerSize();
          const sf = await win.scaleFactor();
          let pos: { x: number; y: number } | null = null;
          try {
            const p = await win.outerPosition();
            pos = { x: Math.round(p.x / sf), y: Math.round(p.y / sf) };
          } catch { /* ignore */ }
          onChange(
            { width: Math.round(sz.width / sf), height: Math.round(sz.height / sf) },
            pos,
          );
        } catch { /* ignore */ }
      });
      await win.onMoved(async () => {
        try {
          if (await win.isFullscreen()) return;
          const sf = await win.scaleFactor();
          const p = await win.outerPosition();
          const sz = await win.innerSize();
          onChange(
            { width: Math.round(sz.width / sf), height: Math.round(sz.height / sf) },
            { x: Math.round(p.x / sf), y: Math.round(p.y / sf) },
          );
        } catch { /* ignore */ }
      });
    } catch (err) {
      console.warn('Could not subscribe to window events:', err);
    }
  })();
}

async function main(): Promise<void> {
  // Arm the safety net first so the 3s timer is anchored to app start, not
  // to the end of async setup. If anything below stalls or throws, the net
  // still fires and the user gets a visible window.
  armWindowVisibilitySafetyNet();

  const canvas = document.getElementById('canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Canvas element not found');
  }

  // ── Load persisted settings (defaults if first run) ──
  const settings = await loadSettings();
  const { scheduleSave } = createSettingsSaver(500);
  const persist = (): void => scheduleSave(settings);

  // Apply window position / size before any UI is visible
  await applyInitialWindowState(settings);

  // ── Apply the persisted audio device preference before anything else so
  //    the backend's first capture lands on the right device. The pipeline
  //    polls preference each tick, so this just needs to fire once. ──
  if (settings.audioDevice && settings.audioDevice !== 'default') {
    void setDevice(settings.audioDevice);
  }

  const renderer = initRenderer(canvas, { initialStyle: settings.mode });

  await initFullscreen({
    initialFullscreen: settings.fullscreen,
    onChange: (fs) => {
      settings.fullscreen = fs;
      persist();
    },
  });

  // The backend takes a moment to start its first capture; an empty name is
  // filled in by the device-changed event.
  const [audioDevices, currentDevice] = await Promise.all([listDevices(), getCurrentDevice()]);

  const controller = initController({
    renderer,
    settings,
    persist,
    audio: {
      devices: audioDevices,
      currentName: currentDevice.name,
      onChange: (id) => { void setDevice(id); },
    },
  });

  // Re-fetch the list on every change: plug/unplug is usually the cause.
  void onDeviceChanged(async (name) => {
    controller.syncAudio(null, name);
    controller.syncAudio(await listDevices(), null);
  });

  // ── Window resize / move persistence ──
  watchWindowState((sz, pos) => {
    settings.window = {
      width: sz.width,
      height: sz.height,
      x: pos?.x ?? settings.window.x,
      y: pos?.y ?? settings.window.y,
    };
    persist();
  });

  // ── Audio frames (WASAPI → Rust → IPC) ──
  const source = new TauriFrameSource();
  source.subscribe((frame) => controller.onFrame(frame));
  await source.start();
}

document.addEventListener('DOMContentLoaded', () => {
  void main();
});
