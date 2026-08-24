/**
 * Hover UI / auto-fade behavior and clean mode.
 * - Controls auto-fade after ~2.5s of mouse inactivity
 * - Clean mode (H) hides all UI persistently for pure visuals
 * - ESC exits clean mode
 */

const HOVER_CSS = `
.sonora-fadeable {
  transition: opacity 0.35s ease;
}
body.sonora-idle .sonora-fadeable {
  opacity: 0;
  pointer-events: none;
}
/* Keep controls visible while their panel/tray is open, even when idle */
body.sonora-idle #palette-picker.open,
body.sonora-idle #settings-btn.active {
  opacity: 1;
  pointer-events: auto;
}
body.sonora-clean .sonora-fadeable,
body.sonora-clean #debug-overlay,
body.sonora-clean #settings-panel {
  display: none !important;
}
#clean-hint {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  padding: 10px 18px;
  background: rgba(8, 8, 16, 0.8);
  color: rgba(255, 255, 255, 0.85);
  font-family: 'Segoe UI', system-ui, sans-serif;
  font-size: 12px;
  letter-spacing: 0.5px;
  border-radius: 20px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(8px);
  z-index: 10000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.25s ease;
}
#clean-hint.visible {
  opacity: 1;
}
`;

const IDLE_MS = 2500;

let idleTimer: number | null = null;
let styleEl: HTMLStyleElement | null = null;
let hintEl: HTMLDivElement | null = null;
let hintTimer: number | null = null;
let cleanMode = false;

function resetIdle(): void {
  if (cleanMode) return;
  document.body.classList.remove('sonora-idle');
  if (idleTimer !== null) window.clearTimeout(idleTimer);
  idleTimer = window.setTimeout(() => {
    document.body.classList.add('sonora-idle');
  }, IDLE_MS);
}

function showHint(msg: string): void {
  if (!hintEl) return;
  hintEl.textContent = msg;
  hintEl.classList.add('visible');
  if (hintTimer !== null) window.clearTimeout(hintTimer);
  hintTimer = window.setTimeout(() => {
    hintEl?.classList.remove('visible');
  }, 1800);
}

function setCleanMode(on: boolean): void {
  cleanMode = on;
  document.body.classList.toggle('sonora-clean', on);
  if (on) {
    document.body.classList.remove('sonora-idle');
    showHint('Clean mode — press H or Esc to show UI');
  } else {
    showHint('UI restored');
    resetIdle();
  }
}

export function isCleanMode(): boolean {
  return cleanMode;
}

export function initHoverUI(): void {
  if (styleEl) return;

  styleEl = document.createElement('style');
  styleEl.textContent = HOVER_CSS;
  document.head.appendChild(styleEl);

  hintEl = document.createElement('div');
  hintEl.id = 'clean-hint';
  document.body.appendChild(hintEl);

  // Mouse/touch activity resets the idle timer
  ['mousemove', 'mousedown', 'wheel', 'touchstart', 'touchmove', 'pointermove'].forEach((ev) => {
    document.addEventListener(ev, resetIdle, { passive: true });
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    if (e.key === 'h' || e.key === 'H') {
      setCleanMode(!cleanMode);
    } else if (e.key === 'Escape' && cleanMode) {
      setCleanMode(false);
    } else {
      // Any other key also counts as activity
      resetIdle();
    }
  });

  resetIdle();
}
