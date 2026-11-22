/**
 * Reel studio overlays (local tool, never in the app or the site): renders one
 * transparent layer at a time — the song title, the style line, the mark, a
 * style label, the now-playing toast, the lockup card, a text card, a slide —
 * for scripts/reel/render.mjs to screenshot and composite, and several at once
 * for the studio's preview. Drawn by the shared overlay module
 * (src/export/overlay.ts), the same code the app's exports use.
 */

import { drawStudioLayer, type StudioLayer } from '../export/overlay';

export type Layer = StudioLayer;

const canvas = document.createElement('canvas');
Object.assign(document.documentElement.style, { background: 'transparent' });
Object.assign(document.body.style, { margin: '0', background: 'transparent', overflow: 'hidden' });
Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100vw', height: '100vh' });
document.body.append(canvas);

function clear(): CanvasRenderingContext2D {
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const g = canvas.getContext('2d')!;
  g.clearRect(0, 0, canvas.width, canvas.height);
  return g;
}

let seq = 0;
declare global { interface Window { __overlay?: { render(l: Layer): Promise<void>; renderMany(ls: { layer: Layer; opacity: number }[]): void } } }
window.__overlay = {
  /** Studio preview: several layers at once, each at an opacity (its fade). */
  renderMany(ls) {
    const my = ++seq;
    void (async () => {
      const off = document.createElement('canvas');
      off.width = window.innerWidth; off.height = window.innerHeight;
      const og = off.getContext('2d')!;
      for (const { layer, opacity } of ls) await drawStudioLayer(og, off.width, off.height, layer, opacity);
      if (my !== seq) return;
      clear().drawImage(off, 0, 0);
    })();
  },
  async render(l) {
    ++seq;
    const g = clear();
    await drawStudioLayer(g, canvas.width, canvas.height, l);
  },
};
