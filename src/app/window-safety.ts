/**
 * Window visibility, shared by the output and the controller (desktop):
 * geometry checks, recentring, and a runtime watch that brings a window back
 * to a visible display when its display goes away (unplugging the TV). The
 * output keeps full screen on the display it lands on.
 */

import { availableMonitors, getCurrentWindow, LogicalPosition, primaryMonitor, type Monitor } from '@tauri-apps/api/window';

/** Min logical-px overlap between window and a monitor we'll accept. */
const MIN_VISIBLE_PX = 100;
/** Approx title-bar height (logical px) — point we require on a monitor. */
const TITLE_BAR_INSET = 16;
/** How often the runtime watch checks (ms). */
const WATCH_MS = 2000;

export interface LogicalRect { x: number; y: number; width: number; height: number }

/** A monitor's bounds in logical px (each monitor has its own DPI on Windows). */
export function monitorRect(mon: Monitor): LogicalRect {
  const sf = mon.scaleFactor || 1;
  return { x: mon.position.x / sf, y: mon.position.y / sf, width: mon.size.width / sf, height: mon.size.height / sf };
}

/** Visible when a usable chunk overlaps a monitor AND the title bar's centre is on it. */
export function isPositionVisible(win: LogicalRect, monitors: Monitor[]): boolean {
  const titleX = win.x + win.width / 2;
  const titleY = win.y + TITLE_BAR_INSET;
  for (const mon of monitors) {
    const m = monitorRect(mon);
    if (!(titleX >= m.x && titleX < m.x + m.width && titleY >= m.y && titleY < m.y + m.height)) continue;
    const ix = Math.max(0, Math.min(win.x + win.width, m.x + m.width) - Math.max(win.x, m.x));
    const iy = Math.max(0, Math.min(win.y + win.height, m.y + m.height) - Math.max(win.y, m.y));
    if (ix >= MIN_VISIBLE_PX && iy >= MIN_VISIBLE_PX) return true;
  }
  return false;
}

/** Is the current window off every display? (true when it can't tell) */
export async function isOffScreen(): Promise<boolean> {
  const win = getCurrentWindow();
  try {
    const [pos, size, sf, monitors] = await Promise.all([win.outerPosition(), win.outerSize(), win.scaleFactor(), availableMonitors()]);
    const rect: LogicalRect = { x: pos.x / sf, y: pos.y / sf, width: size.width / sf, height: size.height / sf };
    return monitors.length === 0 || !isPositionVisible(rect, monitors);
  } catch {
    return true;
  }
}

/** Centre the current window on the primary display and show it. */
export async function recentre(): Promise<void> {
  const win = getCurrentWindow();
  try {
    const primary = await primaryMonitor();
    if (primary) {
      const m = monitorRect(primary);
      const inner = await win.innerSize();
      const sf = primary.scaleFactor || 1;
      const w = Math.min(inner.width / sf, m.width - 40), h = Math.min(inner.height / sf, m.height - 60);
      await win.setPosition(new LogicalPosition(Math.round(m.x + (m.width - w) / 2), Math.round(m.y + (m.height - h) / 2)));
    }
    await win.unminimize();
    await win.show();
    await win.setFocus();
  } catch (err) {
    console.warn('Failed to recentre window:', err);
  }
}

/**
 * Runtime watch: every WATCH_MS, a window that ended up off every display is
 * brought back to the primary one. A full-screen window leaves full screen,
 * moves, and goes full screen again there (the show goes on).
 */
export function watchVisibility(): void {
  const win = getCurrentWindow();
  let busy = false;
  window.setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      if (!(await isOffScreen())) return;
      const fs = await win.isFullscreen().catch(() => false);
      if (fs) await win.setFullscreen(false);
      await recentre();
      if (fs) await win.setFullscreen(true);
    } finally { busy = false; }
  }, WATCH_MS);
}
