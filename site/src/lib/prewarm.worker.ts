/**
 * Compiles every style the page will show once, in a worker on an
 * OffscreenCanvas, so the GPU process's program cache is warm before the
 * sections ask for them. The first compile of Voyage's raymarcher takes
 * seconds; from the cache a switch takes milliseconds, and the main thread
 * never blocks on it. The real renderer runs here, headless.
 */
import type { StyleId } from '../../../src/styles/visual-style';

interface Job { width: number; height: number; scenes: { style: StyleId; variant: string; depth: boolean }[] }

// The renderer reads window.devicePixelRatio and canvas.clientWidth/Height.
const g = globalThis as unknown as { window?: unknown; devicePixelRatio?: number };
g.window = globalThis;
g.devicePixelRatio = 1;

self.onmessage = async (e: MessageEvent<Job>) => {
  const { width, height, scenes } = e.data;
  try {
    const { initRenderer } = await import('../../../src/engine/renderer');
    const off = new OffscreenCanvas(width, height) as OffscreenCanvas & { clientWidth: number; clientHeight: number };
    off.clientWidth = width;
    off.clientHeight = height;
    const r = initRenderer(off as unknown as HTMLCanvasElement, { autoStart: false, seed: 1234, maxPixelRatio: 1 });
    const gl = off.getContext('webgl2') as WebGL2RenderingContext;
    const px = new Uint8Array(4);
    for (const s of scenes) {
      const t0 = performance.now();
      r.transition({ style: s.style, variant: s.variant, depth: s.depth, cut: true });
      for (let i = 0; i < 3; i++) r.step(1 / 60);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      (self as unknown as Worker).postMessage({ type: 'scene', scene: s, ms: performance.now() - t0 });
    }
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    (self as unknown as Worker).postMessage({ type: 'done' });
  } catch (err) {
    (self as unknown as Worker).postMessage({ type: 'error', message: String(err) });
  }
};
