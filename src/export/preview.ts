/**
 * Live preview for the Export screen: the plan played in time with the song,
 * in the chosen aspect, with the same overlays the export burns in (drawn by
 * the same code, at the preview's size) and optional 9:16 safe-zone guides.
 * Each style starts fresh at its cut after a short warm-up; the export itself
 * warms every shot up fully.
 */

import { WasmFrameSource } from '../audio/wasm-source';
import type { Palette } from '../engine/color-engine';
import { initRenderer, type Renderer } from '../engine/renderer';
import { loadStyle } from '../styles/registry';
import type { StyleId } from '../styles/visual-style';
import { applyPalette, applyShot } from './offline';
import { createOverlay, drawSafeGuides, type Overlay, type OverlaySpec } from './overlay';
import type { Plan } from './plan-lib.mjs';
import type { Song } from './song';

/** Warm-up before the preview plays (s of song, rendered as fast as possible). */
const PREVIEW_WARM_S = 4;

export interface Preview {
  /** Size the canvases to the box (CSS px) for an output aspect. */
  layout(boxW: number, boxH: number, outW: number, outH: number): void;
  play(song: Song, plan: Plan, spec: Omit<OverlaySpec, 'size'>, album: Palette | null, portrait: boolean, onTime: (t: number) => void, onEnd: () => void): Promise<void>;
  stop(): void;
  /** Redraw the overlays at a time without playing (edits while stopped). */
  still(spec: Omit<OverlaySpec, 'size'>, t: number): Promise<void>;
  setGuides(on: boolean): void;
  playing(): boolean;
  dispose(): void;
}

export function createPreview(host: HTMLElement): Preview {
  const gl = document.createElement('canvas');
  const ov = document.createElement('canvas');
  gl.className = 'ex-gl'; ov.className = 'ex-ov';
  host.append(gl, ov);
  let renderer: Renderer | null = null;
  let source: WasmFrameSource | null = null;
  let actx: AudioContext | null = null;
  let node: AudioBufferSourceNode | null = null;
  let raf = 0;
  let on = false;
  let guides = true;
  let overlay: Overlay | null = null;
  let stillSeq = 0;

  const ensure = (): Renderer => {
    renderer ??= initRenderer(gl, { autoStart: false, seed: 1234, fixedSize: true });
    return renderer;
  };

  function drawOverlay(t: number): void {
    const g = ov.getContext('2d')!;
    g.clearRect(0, 0, ov.width, ov.height);
    overlay?.draw(g, t);
    if (guides) drawSafeGuides(g, ov.width, ov.height);
  }

  const api: Preview = {
    layout(boxW, boxH, outW, outH) {
      const k = Math.min(boxW / outW, boxH / outH);
      const w = Math.max(2, Math.floor(outW * k)), h = Math.max(2, Math.floor(outH * k));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      for (const c of [gl, ov]) {
        c.style.width = `${w}px`; c.style.height = `${h}px`;
        c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
      }
      host.style.width = `${w}px`; host.style.height = `${h}px`;
    },
    async play(song, plan, spec, album, portrait, onTime, onEnd) {
      api.stop();
      await Promise.all(plan.shots.map((s) => loadStyle(s.style as StyleId)));
      const r = ensure();
      r.camera.portraitFraming = portrait && gl.height > gl.width ? 1 : 0;
      r.setQuality('high');
      overlay = await createOverlay({ ...spec, size: [ov.width, ov.height] });
      source ??= await WasmFrameSource.create();
      const src = source;
      const unsub = src.subscribe((f) => r.pushFrame(f));
      src.loadOffline(song.mono, song.sampleRate);
      const W0 = plan.window.start;
      applyShot(r, plan.shots[0], album, true);
      await r.ready();
      const warm = Math.min(PREVIEW_WARM_S, W0);
      src.stepOffline(W0 - warm);
      for (let i = 0; i < warm * 60; i++) { src.stepOffline(1 / 60); r.step(1 / 60); }
      actx ??= new AudioContext({ sampleRate: song.sampleRate });
      await actx.resume();
      const buf = actx.createBuffer(2, song.left.length, song.sampleRate);
      buf.copyToChannel(song.left, 0); buf.copyToChannel(song.right, 1);
      const gain = actx.createGain();
      node = actx.createBufferSource();
      node.buffer = buf;
      node.connect(gain).connect(actx.destination);
      const ctx = actx;
      const t0 = ctx.currentTime;
      node.start(0, W0);
      on = true;
      let songT = W0, shotI = 0;
      const changes = [...(plan.changes ?? [])];
      const D = plan.window.end - W0;
      const length = overlay.length;
      const tick = (): void => {
        if (!on) { unsub(); return; }
        const target = W0 + (ctx.currentTime - t0) - (ctx.outputLatency || 0);
        const step = Math.max(0, Math.min(0.1, target - songT));
        if (step > 0) { src.stepOffline(step); r.step(step); songT += step; }
        while (shotI + 1 < plan.shots.length && plan.shots[shotI + 1].at <= songT) applyShot(r, plan.shots[++shotI], album, true);
        while (changes.length && changes[0].at <= songT) {
          const c = changes.shift()! as { palette?: number; variant?: string; depth?: boolean };
          if (c.palette !== undefined) applyPalette(r, c.palette, album);
          if (c.variant) r.setVariant(c.variant);
          if (c.depth !== undefined) r.setDepth(c.depth);
        }
        const rel = songT - W0;
        // The outro: the sound fades over it, as in the export.
        gain.gain.value = rel > D && length > D ? Math.max(0, 1 - (rel - D) / (length - D)) : 1;
        drawOverlay(rel);
        onTime(songT);
        if (rel >= length) { api.stop(); unsub(); onEnd(); return; }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      void (r.getStyle() as StyleId);
    },
    stop() {
      on = false;
      cancelAnimationFrame(raf);
      try { node?.stop(); } catch { /* not started */ }
      node = null;
    },
    async still(spec, t) {
      const my = ++stillSeq;
      const o = await createOverlay({ ...spec, size: [ov.width, ov.height] });
      if (my !== stillSeq) return;
      overlay = o;
      if (!on) drawOverlay(t);
    },
    setGuides(v) { guides = v; },
    playing: () => on,
    dispose() {
      api.stop();
      renderer?.stop();
      gl.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext();
      renderer = null;
      void actx?.close();
      actx = null;
    },
  };
  return api;
}
