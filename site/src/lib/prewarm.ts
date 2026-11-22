/** Shader prewarm in a worker (the landing page and /live share it). */
import type { Scene } from './stage';

/**
 * Compile these scenes' shaders in a worker on an OffscreenCanvas before the
 * page's own context exists. The GPU process caches the programs, so the
 * page's renderer later builds every style in milliseconds instead of seconds
 * (Voyage: ~3 s → ~40 ms). Run it while nothing live is on screen: the GPU
 * process is busy while it compiles. Resolves false if workers or
 * OffscreenCanvas are unavailable, or after `timeoutMs`.
 */
export function prewarm(scenes: Required<Scene>[], width: number, height: number, timeoutMs: number, onScene?: (s: Required<Scene>, ms: number) => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof OffscreenCanvas === 'undefined') { resolve(false); return; }
    let worker: Worker;
    try {
      worker = new Worker(new URL('./prewarm.worker.ts', import.meta.url), { type: 'module' });
    } catch { resolve(false); return; }
    const end = (ok: boolean): void => { window.clearTimeout(timer); worker.terminate(); resolve(ok); };
    const timer = window.setTimeout(() => end(false), timeoutMs);
    worker.onmessage = (e: MessageEvent<{ type: string; scene?: Required<Scene>; ms?: number }>) => {
      const m = e.data;
      if (m.type === 'scene' && m.scene) onScene?.(m.scene, m.ms ?? 0);
      if (m.type === 'done') end(true);
      if (m.type === 'error') end(false);
    };
    worker.onerror = () => end(false);
    const w = Math.max(320, Math.round(width / 2));
    worker.postMessage({ width: w, height: Math.max(180, Math.round((w * height) / Math.max(1, width))), scenes });
  });
}

