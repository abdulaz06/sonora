/**
 * Fullscreen toggle — floating button + keyboard shortcuts.
 * F11 to toggle, ESC to exit. Uses Tauri window API.
 */

import { getCurrentWindow } from '@tauri-apps/api/window';

const BTN_CSS = `
#fullscreen-btn {
  position: fixed;
  bottom: 16px;
  right: 60px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(8, 8, 16, 0.75);
  border: 2px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  transition: transform 0.2s, border-color 0.2s, color 0.2s;
}
#fullscreen-btn:hover {
  transform: scale(1.08);
  border-color: rgba(255, 255, 255, 0.5);
  color: rgba(255, 255, 255, 0.95);
}
#fullscreen-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
#fullscreen-btn:focus { outline: none; }
`;

const ICON_EXPAND = `
  <svg viewBox="0 0 24 24"><polyline points="3 9 3 3 9 3"/><polyline points="21 9 21 3 15 3"/><polyline points="3 15 3 21 9 21"/><polyline points="21 15 21 21 15 21"/></svg>
`;
const ICON_COLLAPSE = `
  <svg viewBox="0 0 24 24"><polyline points="9 3 9 9 3 9"/><polyline points="15 3 15 9 21 9"/><polyline points="9 21 9 15 3 15"/><polyline points="15 21 15 15 21 15"/></svg>
`;

let btnEl: HTMLButtonElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let isFullscreen = false;
let onFullscreenChange: ((fs: boolean) => void) | null = null;

export interface FullscreenOptions {
  /** Initial fullscreen state to apply on startup. */
  initialFullscreen?: boolean;
  /** Fired whenever the fullscreen state changes (any source). */
  onChange?: (fs: boolean) => void;
}

async function setFullscreen(next: boolean): Promise<void> {
  try {
    const win = getCurrentWindow();
    await win.setFullscreen(next);
    if (isFullscreen !== next) {
      isFullscreen = next;
      onFullscreenChange?.(isFullscreen);
    }
    updateIcon();
  } catch (err) {
    console.warn('Fullscreen toggle failed:', err);
  }
}

async function toggle(): Promise<void> {
  await setFullscreen(!isFullscreen);
}

function updateIcon(): void {
  if (!btnEl) return;
  btnEl.innerHTML = isFullscreen ? ICON_COLLAPSE : ICON_EXPAND;
  btnEl.title = isFullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen (F11)';
}

export async function initFullscreen(options: FullscreenOptions = {}): Promise<void> {
  if (btnEl) return;
  onFullscreenChange = options.onChange ?? null;

  styleEl = document.createElement('style');
  styleEl.textContent = BTN_CSS;
  document.head.appendChild(styleEl);

  btnEl = document.createElement('button');
  btnEl.id = 'fullscreen-btn';
  btnEl.className = 'sonora-fadeable';
  btnEl.addEventListener('click', () => { void toggle(); });
  document.body.appendChild(btnEl);

  // Apply initial fullscreen state, then sync with external toggles
  try {
    const win = getCurrentWindow();
    if (typeof options.initialFullscreen === 'boolean') {
      const current = await win.isFullscreen();
      if (current !== options.initialFullscreen) {
        await win.setFullscreen(options.initialFullscreen);
      }
      isFullscreen = options.initialFullscreen;
    } else {
      isFullscreen = await win.isFullscreen();
    }
    await win.onResized(async () => {
      try {
        const next = await win.isFullscreen();
        if (next !== isFullscreen) {
          isFullscreen = next;
          onFullscreenChange?.(isFullscreen);
          updateIcon();
        }
      } catch { /* ignore */ }
    });
  } catch {
    isFullscreen = false;
  }
  updateIcon();

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'F11') {
      e.preventDefault();
      void toggle();
    } else if (e.key === 'Escape' && isFullscreen) {
      void setFullscreen(false);
    } else if (e.key === 'f' || e.key === 'F') {
      void toggle();
    }
  });
}
