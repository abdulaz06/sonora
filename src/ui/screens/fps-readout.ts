/**
 * FPS readout: tiny mono text in a corner, low-opacity Bone, no box, updated
 * twice a second: frames per second, what the frame rate is set to, and the
 * slowest frame of the last second. A DOM overlay (never drawn into the
 * canvas), so it can't end up in renders, media captures or screenshots of
 * the visual unless it is switched on. Shown only over the live visual.
 */

import type { Corner } from '../../ipc/settings';
import { fpsLabel } from '../../ipc/settings';
import type { Renderer } from '../../engine/renderer';

// ── Tuning ──────────────────────────────────────────────────────
const UPDATE_MS = 500;
const INSET_PX = 14;
const OPACITY = 0.42;

export interface FpsReadout {
  /** Show / hide (the setting and whether the visual is on screen). */
  set(visible: boolean, corner: Corner): void;
}

export function createFpsReadout(renderer: Renderer): FpsReadout {
  const el = document.createElement('div');
  el.className = 'fps-readout';
  Object.assign(el.style, {
    position: 'fixed', zIndex: '860', pointerEvents: 'none', display: 'none',
    font: "500 10px/1 'IBM Plex Mono', Consolas, monospace", letterSpacing: '0.12em', textTransform: 'uppercase',
    color: `rgba(236, 231, 223, ${OPACITY})`, whiteSpace: 'pre', fontVariantNumeric: 'tabular-nums',
  } satisfies Partial<CSSStyleDeclaration>);
  el.setAttribute('aria-hidden', 'true');
  document.body.appendChild(el);
  let timer = 0;

  const update = (): void => {
    const p = renderer.pacing();
    const target = p.targetFps ? fpsLabel(p.targetFps) : '--';
    el.textContent = `${p.fps.toFixed(0).padStart(3, ' ')} fps · cap ${target} · worst ${p.worstMs.toFixed(1)} ms`;
  };

  return {
    set(visible: boolean, corner: Corner): void {
      const [v, hz] = corner.split('-');
      el.style.top = v === 'top' ? `${INSET_PX}px` : '';
      el.style.bottom = v === 'bottom' ? `${INSET_PX}px` : '';
      el.style.left = hz === 'left' ? `${INSET_PX}px` : '';
      el.style.right = hz === 'right' ? `${INSET_PX}px` : '';
      el.style.textAlign = hz === 'right' ? 'right' : 'left';
      if (visible && !timer) {
        update();
        timer = window.setInterval(update, UPDATE_MS);
      } else if (!visible && timer) {
        window.clearInterval(timer);
        timer = 0;
      }
      el.style.display = visible ? 'block' : 'none';
    },
  };
}
