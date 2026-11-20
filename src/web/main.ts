/**
 * Web dev page — the renderer in a plain browser, fed by the WASM analyser.
 *
 * Sources: generated test tracks, any audio file (pick or drag & drop), the
 * microphone, or tab/system audio (getDisplayMedia). Settings persist in
 * localStorage. `?harness=1` disables the rAF loop and exposes
 * `window.__sonora` so the Playwright verify script can drive time exactly.
 */

import { initController } from '../app/controller';
import type { Platform } from '../app/platform';
import { initShell } from '../app/shell';
import { gpuReason, showGpuFallback } from '../ui/screens/gpu';
import { audioStatus, nowPlaying } from '../app/stores';
import { decodeWavMono } from '../audio/wav';
import { WasmFrameSource } from '../audio/wasm-source';
import { createSourceUi, type SourceUi } from './source-ui';
import { CAMERA_PRESETS } from '../engine/camera';
import { PALETTES, resolvePalette, shadeOf, type ResolvedPalette } from '../engine/color-engine';
import { presetsFor } from '../styles/registry';
import { initRenderer } from '../engine/renderer';
import { defaultSettings, mergeWithDefaults, type PersistedSettings } from '../ipc/settings';
import type { QualityPreset } from '../engine/quality';
import type { SonoraEvent } from '../engine/events';
import type { LightMode, StyleId } from '../styles/visual-style';
import { setDebugFlags, type DebugFlags } from '../engine/debug-flags';

declare const __APP_VERSION__: string;

// ── Tuning ──────────────────────────────────────────────────────
const STORAGE_KEY = 'sonora.web.settings';
const SAVE_DEBOUNCE_MS = 400;

interface TrackMeta {
  file: string;
  duration: number;
  markers: Record<string, number>;
}

export interface HarnessApi {
  ready: boolean;
  tracks: Record<string, TrackMeta>;
  loadTrack(name: string): Promise<{ duration: number; sampleRate: number }>;
  /** Advance audio + visuals by `seconds` in steps of `dt` (render each step). */
  advance(seconds: number, dt: number): number;
  /** Advance audio only (no rendering) — for fast seeking. */
  analyseOnly(seconds: number): number;
  /** Canvas as a data URL (PNG by default; 'image/jpeg' for videos). */
  snapshot(type?: string, quality?: number): string;
  configure(opts: { style?: StyleId; variant?: string; depth?: boolean; light?: LightMode; quality?: QualityPreset; palette?: number; drift?: boolean; camera?: string; responsiveness?: number; debug?: Partial<DebugFlags> }): void;
  /** Fire a trackChange with a title (as a media session would). */
  seedText(title: string): void;
  time(): number;
  events: SonoraEvent[];
  stats(): ReturnType<ReturnType<typeof initRenderer>['stats']>;
  gpu(): string;
  /** Mean ms per fully finished frame (step + GPU sync), i.e. real GPU+CPU cost. */
  frameCost(frames: number, dt: number): number;
  /** Advance in steps of `dt` and return the mean screen luminance after each step. */
  lumaTrace(seconds: number, dt: number): number[];
  /** Like lumaTrace, plus the fraction of blown-out pixels (any channel ≥ 250) per step. */
  exposureTrace(seconds: number, dt: number): { luma: number[]; clip: number[]; motion: number[]; tiles: number[][] };
  /** Real time: run the renderer's own rAF loop with a frame cap for `seconds`,
   * feeding audio at wall-clock speed; returns every rendered frame's time (ms). */
  pacingRun(seconds: number, cap: number): Promise<{ frames: number[]; displayHz: number }>;
  /** Analysis-frame hit envelopes since the track was loaded (audio time s). */
  hitLog(): { t: number; bass: number; mid: number; high: number }[];
  /** Camera state (debugging frame-rate independence). */
  cam(): Record<string, unknown>;
  /** Palette research: the preset list as ready RGB. */
  palettes(): { name: string; resolved: ResolvedPalette }[];
  /** Palette research: show any palette (RGB), a custom hue, or Auto Drift at a phase. */
  setPalette(p: { resolved?: ResolvedPalette; index?: number; hue?: number; driftDeg?: number }): void;
  /** The palette the styles currently receive. */
  currentPalette(): ResolvedPalette;
}

declare global {
  interface Window { __sonora?: HarnessApi }
}

const BAR_CSS = `
#webbar {
  position: fixed; top: 16px; left: 16px; z-index: 997; display: flex; gap: 0; align-items: stretch;
  font-family: 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace; font-size: 10px;
  letter-spacing: 0.12em; text-transform: uppercase; color: rgba(236,231,223,0.8);
  background: rgba(8,8,10,0.82); border: 1px solid rgba(236,231,223,0.12);
}
#webbar > * { border-right: 1px solid rgba(236,231,223,0.12); padding: 7px 10px; display: flex; align-items: center; }
#webbar > *:last-child { border-right: 0; }
#webbar select, #webbar button { all: unset; cursor: pointer; color: #ECE7DF; }
#webbar select option { background: #08080A; }
#webbar .brand { color: #ECE7DF; letter-spacing: 0.04em; text-transform: none; font-family: 'Inter', system-ui, sans-serif; font-weight: 600; font-size: 13px; }
#webbar .dim { color: rgba(236,231,223,0.45); }
body.scr-overlay #webbar { display: none; }
#drop-hint { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 1001;
  background: rgba(8,8,10,0.7); color: #ECE7DF; font: 600 22px 'Inter', system-ui, sans-serif; letter-spacing: -0.02em; }
body.dragging #drop-hint { display: flex; }
`;

function loadLocalSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergeWithDefaults(JSON.parse(raw)) : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const harness = params.has('harness');
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  // ?fresh=1 starts from defaults (first run); ?onboarded=1 skips the intro.
  const settings = harness || params.has('fresh') ? { ...defaultSettings(), autoDrift: false } : loadLocalSettings();
  if (params.has('onboarded')) settings.onboarded = true;
  let saveTimer = 0;
  const persist = (): void => {
    if (harness) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), SAVE_DEBOUNCE_MS);
  };

  let renderer: ReturnType<typeof initRenderer>;
  try {
    renderer = initRenderer(canvas, {
      initialStyle: settings.mode,
      autoStart: !harness,
      preserveDrawingBuffer: harness,
      seed: harness ? 1234 : undefined,
    });
  } catch (err) {
    showGpuFallback(gpuReason(err), String(err));
    return;
  }
  let openSource: () => void = () => undefined;
  const controller = initController({ renderer, settings, persist });
  const source = await WasmFrameSource.create();
  source.subscribe((f) => controller.onFrame(f));

  const loadTracks = (url: string): Promise<Record<string, TrackMeta>> => fetch(url)
    .then((r) => (r.ok ? r.json() as Promise<Record<string, TrackMeta>> : {}))
    .catch(() => ({}));
  // Optional private tracks (e.g. a real song for like-for-like comparisons),
  // kept in the git-ignored test-audio/local/ folder; see scripts/add-local-track.py.
  const tracks: Record<string, TrackMeta> = {
    ...await loadTracks('/test-audio/tracks.json'),
    ...await loadTracks('/test-audio/local/tracks.json'),
  };

  if (harness) {
    exposeHarness(renderer, source, tracks);
    return;
  }

  openSource = buildBar(source, tracks, renderer).open;
  source.onStatus((st) => audioStatus.patch({ device: st.state === 'idle' ? '' : st.label }));

  const platform: Platform = {
    kind: 'web',
    version: __APP_VERSION__,
    listDevices: async () => [],
    setDevice: () => undefined,
    openSourceChooser: () => window.setTimeout(() => openSource(), 0),
    toggleFullscreen: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen(); },
    isFullscreen: () => !!document.fullscreenElement,
    onFullscreenChange: (cb) => document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement)),
  };
  const demo = params.has('demo');
  if (demo) startDemo();
  const screen = params.get('screen');
  await initShell(controller, platform, {
    noLaunch: params.has('nolaunch'),
    start: screen === 'menu' || screen === 'detail' || screen === 'visual' || screen === 'intro' ? screen : undefined,
    startStyle: (params.get('style') as StyleId | null) ?? undefined,
  });
  // ?track=<name> plays a test track straight away (UI reviews with live audio).
  const track = params.get('track');
  if (track && tracks[track]) {
    const buf = await fetch(`/test-audio/${tracks[track].file}`).then((r) => r.arrayBuffer());
    const b = await source.loadFile(buf);
    await source.playBuffer(b, Number(params.get('t') ?? 0), () => undefined, track);
  }
}

/** Screenshot reviews: a believable device, level and now-playing without real audio. */
function startDemo(): void {
  audioStatus.patch({ device: 'Speakers (Realtek(R) Audio)' });
  let t = 0;
  window.setInterval(() => {
    t += 0.05;
    const beat = Math.max(0, Math.sin(t * 7.8)) ** 6;
    audioStatus.patch({ level: 0.42 + 0.3 * beat + 0.08 * Math.sin(t * 1.3), hearing: true, silentFor: 0 });
  }, 50);
  nowPlaying.set({ title: 'Night Drive', artist: 'Lumen Field', album: 'Low Light', art: '', playing: true, app: 'Spotify.exe', canPrev: true, canNext: true, canPlayPause: true });
}

function buildBar(source: WasmFrameSource, tracks: Record<string, TrackMeta>, renderer: ReturnType<typeof initRenderer>): SourceUi {
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'webbar';
  bar.className = 'sonora-fadeable';
  bar.innerHTML = `
    <span class="brand">sonora</span>
    <span id="src-slot"></span>
    <button id="play" style="display:none">Pause</button>
    <span id="clock" class="dim" style="display:none"></span>
    <span id="fps" class="dim">-- fps</span>
  `;
  document.body.appendChild(bar);
  const hint = document.createElement('div');
  hint.id = 'drop-hint';
  hint.textContent = 'drop audio to play';
  document.body.appendChild(hint);

  const playBtn = bar.querySelector<HTMLButtonElement>('#play')!;
  const clock = bar.querySelector<HTMLSpanElement>('#clock')!;
  const fpsEl = bar.querySelector<HTMLSpanElement>('#fps')!;

  const playData = async (data: Blob | ArrayBuffer, label: string): Promise<void> => {
    const buf = await source.loadFile(data);
    await source.playBuffer(buf, 0, () => { playBtn.textContent = 'Play'; }, label);
    playBtn.textContent = 'Pause';
    renderer.events.notifyTrackChange({ title: label.replace(/\.[a-z0-9]+$/i, '') });
  };
  const ui = createSourceUi(source, Object.entries(tracks).map(([id, m]) => ({ id, file: m.file })), playData);
  bar.querySelector('#src-slot')!.replaceWith(ui.chip);

  // Play/pause and the clock only make sense for files.
  source.onStatus((s) => {
    const file = s.kind === 'file' && s.state !== 'idle';
    playBtn.style.display = file ? '' : 'none';
    clock.style.display = file ? '' : 'none';
  });
  playBtn.addEventListener('click', () => {
    if (source.isPlaying) { source.pause(); playBtn.textContent = 'Play'; }
    else { void source.resume(); playBtn.textContent = 'Pause'; }
  });

  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) void playData(f, f.name);
  });

  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  window.setInterval(() => {
    const st = renderer.stats();
    fpsEl.textContent = `${st.fps.toFixed(0)} fps · ${st.quality.level}`;
    if (source.duration) clock.textContent = `${fmt(source.currentTime)} / ${fmt(source.duration)}`;
  }, 250);
  return ui;
}

function exposeHarness(renderer: ReturnType<typeof initRenderer>, source: WasmFrameSource, tracks: Record<string, TrackMeta>): void {
  const events: SonoraEvent[] = [];
  renderer.onEvent((e) => events.push(e));
  const gl = renderer.canvas.getContext('webgl2');
  const hits: { t: number; bass: number; mid: number; high: number }[] = [];
  source.subscribe((f) => hits.push({
    t: source.offlineTime, bass: Math.max(f.hits.sub_bass, f.hits.bass),
    mid: Math.max(f.hits.low_mid, f.hits.mid, f.hits.upper_mid), high: Math.max(f.hits.high, f.hits.air),
  }));
  const api: HarnessApi = {
    ready: true,
    tracks,
    async loadTrack(name: string) {
      const meta = tracks[name];
      if (!meta) throw new Error(`unknown track ${name}`);
      const buf = await fetch(`/test-audio/${meta.file}`).then((r) => r.arrayBuffer());
      const pcm = decodeWavMono(buf);
      if (!pcm) throw new Error('could not decode wav');
      source.loadOffline(pcm.mono, pcm.sampleRate);
      hits.length = 0;
      return { duration: pcm.mono.length / pcm.sampleRate, sampleRate: pcm.sampleRate };
    },
    advance(seconds: number, dt: number): number {
      let t = 0, steps = 0;
      while (t < seconds - 1e-9) {
        const d = Math.min(dt, seconds - t);
        source.stepOffline(d);
        renderer.step(d);
        t += d;
        steps++;
      }
      return steps;
    },
    analyseOnly(seconds: number): number {
      return source.stepOffline(seconds);
    },
    snapshot(type = 'image/png', quality?: number): string {
      return renderer.canvas.toDataURL(type, quality);
    },
    configure(o) {
      if (o.debug) setDebugFlags(o.debug);
      if (o.style) renderer.setStyle(o.style, true);
      if (o.variant) renderer.setVariant(o.variant);
      if (o.depth !== undefined) renderer.setDepth(o.depth);
      if (o.light) renderer.setLightMode(o.light);
      if (o.quality) renderer.setQuality(o.quality);
      if (o.palette !== undefined) renderer.colorEngine.setPalette(o.palette, true);
      if (o.drift !== undefined) renderer.colorEngine.setAutoDrift(o.drift);
      if (o.responsiveness !== undefined) renderer.setResponsiveness(o.responsiveness);
      const preset = (o.style ? presetsFor(o.style) : CAMERA_PRESETS).find((p) => p.id === o.camera);
      if (preset) renderer.camera.setView(preset.view);
    },
    lumaTrace(seconds: number, dt: number): number[] {
      return this.exposureTrace(seconds, dt).luma;
    },
    exposureTrace(seconds: number, dt: number): { luma: number[]; clip: number[]; motion: number[]; tiles: number[][] } {
      if (!gl) return { luma: [], clip: [], motion: [], tiles: [] };
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array(w * h * 4);
      const luma: number[] = [];
      const clip: number[] = [];
      // Motion: mean absolute per-pixel luminance change from the last frame.
      const motion: number[] = [];
      // Mean luminance per region (8 x 5 grid), so a hit that changes one part
      // of the picture (an ink drop on paper) is measured too.
      const tiles: number[][] = [];
      const GX = 8, GY = 5;
      const tSum = new Float64Array(GX * GY), tN = new Uint32Array(GX * GY);
      let prev: Float32Array | null = null;
      const cur = new Float32Array(Math.ceil(buf.length / (4 * 7)));
      for (let t = 0; t < seconds - 1e-9; t += dt) {
        source.stepOffline(dt);
        renderer.step(dt);
        gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf);
        let sum = 0, n = 0, hot = 0, diff = 0;
        tSum.fill(0); tN.fill(0);
        for (let i = 0; i < buf.length; i += 4 * 7) {
          const l = 0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2];
          const px = i >> 2, cx = Math.min(GX - 1, Math.floor(((px % w) * GX) / w)), cy = Math.min(GY - 1, Math.floor((Math.floor(px / w) * GY) / h));
          tSum[cy * GX + cx] += l; tN[cy * GX + cx]++;
          if (prev) diff += Math.abs(l - prev[n]);
          cur[n] = l;
          sum += l;
          if (buf[i] >= 250 || buf[i + 1] >= 250 || buf[i + 2] >= 250) hot++;
          n++;
        }
        luma.push(sum / n / 255);
        tiles.push(Array.from(tSum, (v, k) => v / Math.max(1, tN[k]) / 255));
        clip.push(hot / n);
        motion.push(prev ? diff / n / 255 : 0);
        prev = prev ?? new Float32Array(cur.length);
        prev.set(cur);
      }
      return { luma, clip, motion, tiles };
    },
    frameCost(frames: number, dt: number): number {
      if (!gl) return 0;
      // readPixels forces the GPU to finish (gl.finish is a no-op in Chromium).
      const px = new Uint8Array(4);
      const sync = (): void => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      for (let i = 0; i < 10; i++) { source.stepOffline(dt); renderer.step(dt); }
      sync();
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) { source.stepOffline(dt); renderer.step(dt); sync(); }
      return (performance.now() - t0) / frames;
    },
    pacingRun(seconds: number, cap: number): Promise<{ frames: number[]; displayHz: number }> {
      return new Promise((resolve) => {
        renderer.setFpsCap(cap);
        renderer.recordFrames(true);
        let last = 0;
        const t0 = performance.now();
        // Registered before the renderer's loop, so audio for a frame arrives first.
        const feed = (now: number): void => {
          source.stepOffline(Math.min(last ? (now - last) / 1000 : 1 / 60, 0.05));
          last = now;
          if (now - t0 < seconds * 1000) { requestAnimationFrame(feed); return; }
          const frames = renderer.recordFrames(false);
          renderer.stop();
          resolve({ frames, displayHz: renderer.displayHz() });
        };
        requestAnimationFrame(feed);
        renderer.start();
      });
    },
    hitLog: () => hits,
    cam: () => {
      const c = renderer.camera as unknown as Record<string, unknown>;
      const pick = (k: string): unknown => c[k];
      return { position: pick('position'), yaw: pick('yaw'), pitch: pick('pitch'), roll: pick('roll'), center: pick('center'), viewHeight: pick('viewHeight'), t: pick('t'), time: source.offlineTime, hits: hits.length };
    },
    seedText(title: string): void { renderer.events.notifyTrackChange({ title }); },
    palettes: () => PALETTES.map((p) => ({ name: p.name, resolved: resolvePalette(p) })),
    setPalette(p) {
      const ce = renderer.colorEngine;
      ce.setOverride(p.resolved ? { ...p.resolved, shade: p.resolved.shade ?? shadeOf(p.resolved.primary) } : null);
      if (p.index !== undefined) ce.setPalette(p.index, true);
      if (p.hue !== undefined) { ce.setCustomHue(p.hue); ce.update(10); }
      ce.setAutoDrift(p.driftDeg !== undefined);
      if (p.driftDeg !== undefined) ce.setDriftPhase(p.driftDeg);
      ce.update(0);
    },
    currentPalette: () => renderer.colorEngine.getResolved(),
    time: () => source.offlineTime,
    events,
    stats: () => renderer.stats(),
    gpu(): string {
      if (!gl) return 'unknown';
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    },
  };
  window.__sonora = api;
}

document.addEventListener('DOMContentLoaded', () => { void main(); });
