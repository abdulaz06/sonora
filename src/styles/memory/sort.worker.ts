/// <reference lib="webworker" />
/**
 * Memory: back-to-front order of the splats for a camera (a 16-bit counting
 * sort on view depth). The main thread sends the positions once, then camera
 * positions and forward vectors; each answer is a transferable index array.
 */
import { sortSplats } from './sort';

let pos: Float32Array | null = null;
self.onmessage = (e: MessageEvent<{ pos?: Float32Array; cam?: [number, number, number]; fwd?: [number, number, number]; id?: number }>) => {
  const d = e.data;
  if (d.pos) { pos = d.pos; return; }
  if (!pos || !d.cam || !d.fwd) return;
  const idx = sortSplats(pos, d.cam, d.fwd);
  (self as unknown as Worker).postMessage({ idx, id: d.id }, [idx.buffer]);
};
