/**
 * Development builds only (`import.meta.env.DEV`): the modules the automated
 * app checks drive (scripts/app/*.mjs over the webview's remote debugging),
 * exposed as the app's own instances (imports from a script would load other
 * instances after hot updates).
 */

import { setDebugFlags } from '../engine/debug-flags';
import { buildPlan } from '../export/plan-lib.mjs';
import { loadSong } from '../export/song';
import { renderExport } from '../export/offline';
import { desktopSink, openAac } from '../export/desktop-io';
import { memorySink } from '../export/mp4';

export interface DevHooks {
  setDebugFlags: typeof setDebugFlags;
  buildPlan: typeof buildPlan;
  loadSong: typeof loadSong;
  renderExport: typeof renderExport;
  desktopSink: typeof desktopSink;
  openAac: typeof openAac;
  [k: string]: unknown;
}

declare global { interface Window { __sonoraHooks?: DevHooks } }

window.__sonoraHooks = { ...(window.__sonoraHooks ?? {}), setDebugFlags, buildPlan, loadSong, renderExport, desktopSink, openAac, memorySink };

/** Engine determinism probe: render `frames` of a style offline from `start` and hash each frame (readPixels). */
async function engineHashes(o: { style: string; variant: string; depth: boolean; start: number; frames: number; warm: number; offline: boolean; w: number; h: number; composite?: boolean; yieldEach?: boolean; camera?: string; encode?: boolean; palette?: boolean }): Promise<string[]> {
  const { initRenderer } = await import('../engine/renderer');
  const { WasmFrameSource } = await import('../audio/wasm-source');
  const { decodeWavMono } = await import('../audio/wav');
  const buf = await fetch('/test-audio/house-124.wav').then((r) => r.arrayBuffer());
  const pcm = decodeWavMono(buf)!;
  const c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
  const r = initRenderer(c, { autoStart: false, preserveDrawingBuffer: true, seed: 1234, fixedSize: true, offline: o.offline, initialStyle: o.style as never });
  r.setQuality('high'); r.setStyle(o.style as never, true); r.setVariant(o.variant); r.setDepth(o.depth);
  if (o.camera) { const { presetsFor } = await import('../styles/registry'); const p = presetsFor(o.style as never).find((x) => x.id === o.camera); if (p) r.camera.setView(p.view); }
  const comp = document.createElement('canvas'); comp.width = o.w; comp.height = o.h;
  const cg = comp.getContext('2d', { alpha: false })!;
  let enc: VideoEncoder | null = null;
  if (o.encode) {
    const { pickVideoConfig } = await import('../export/mp4');
    enc = new VideoEncoder({ output: () => undefined, error: () => undefined });
    enc.configure(await pickVideoConfig(o.w, o.h, 60));
  }
  if (o.palette) { const { applyShot } = await import('../export/offline'); r.setLightMode('auto'); applyShot(r, { style: o.style as never, variant: o.variant, depth: o.depth, palette: 0, camera: o.camera }, null, false); }
  const s = await WasmFrameSource.create();
  s.subscribe((f) => r.pushFrame(f));
  s.loadOffline(pcm.mono, pcm.sampleRate);
  s.stepOffline(o.start - o.warm);
  for (let k = 0; k < o.warm * 60; k++) { s.stepOffline(1 / 60); r.step(1 / 60); }
  const g = c.getContext('webgl2')!;
  const px = new Uint8Array(o.w * o.h * 4);
  const out: string[] = [];
  for (let k = 0; k < o.frames; k++) {
    s.stepOffline(1 / 60); r.step(1 / 60);
    if (o.composite) { cg.drawImage(c, 0, 0); px.set(cg.getImageData(0, 0, o.w, o.h).data); } else g.readPixels(0, 0, o.w, o.h, g.RGBA, g.UNSIGNED_BYTE, px);
    if (enc) { while (enc.encodeQueueSize > 6) await new Promise<void>((res) => enc!.addEventListener('dequeue', () => res(), { once: true })); const vf = new VideoFrame(comp, { timestamp: k * 16667 }); enc.encode(vf); vf.close(); }
    if (o.yieldEach) await new Promise<void>((res) => { const ch = new MessageChannel(); ch.port1.onmessage = () => res(); ch.port2.postMessage(0); });
    let fh = 0x811c9dc5;
    for (let i = 0; i < px.length; i += 7) { fh ^= px[i]; fh = Math.imul(fh, 0x01000193) >>> 0; }
    out.push(fh.toString(16));
  }
  if (enc) { await enc.flush(); enc.close(); }
  g.getExtension('WEBGL_lose_context')?.loseContext();
  return out;
}
window.__sonoraHooks!.engineHashes = engineHashes;
