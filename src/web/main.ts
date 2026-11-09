/**
 * Web dev page — the renderer in a plain browser, fed by the WASM analyser.
 *
 * Sources: generated test tracks, any audio file (pick or drag & drop), the
 * microphone, or tab/system audio (getDisplayMedia). Settings persist in
 * localStorage. `?harness=1` disables the rAF loop and exposes
 * `window.__sonora` so the Playwright verify script can drive time exactly.
 */

import { initController } from '../app/controller';
import { decodeWavMono, WasmFrameSource } from '../audio/wasm-source';
import { initRenderer } from '../engine/renderer';
import { DEFAULT_SETTINGS, mergeWithDefaults, type PersistedSettings } from '../ipc/settings';
import type { QualityPreset } from '../engine/quality';
import type { SonoraEvent } from '../engine/events';
import type { LightMode, StyleId } from '../styles/visual-style';

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
  snapshot(): string;
  configure(opts: { style?: StyleId; variant?: string; depth?: boolean; light?: LightMode; quality?: QualityPreset; palette?: number; drift?: boolean }): void;
  time(): number;
  events: SonoraEvent[];
  stats(): ReturnType<ReturnType<typeof initRenderer>['stats']>;
  gpu(): string;
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
#drop-hint { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; z-index: 1001;
  background: rgba(8,8,10,0.7); color: #ECE7DF; font: 600 22px 'Inter', system-ui, sans-serif; letter-spacing: -0.02em; }
body.dragging #drop-hint { display: flex; }
`;

function loadLocalSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? mergeWithDefaults(JSON.parse(raw)) : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

async function main(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const harness = params.has('harness');
  const canvas = document.getElementById('canvas') as HTMLCanvasElement;

  const settings = harness ? { ...DEFAULT_SETTINGS, autoDrift: false } : loadLocalSettings();
  let saveTimer = 0;
  const persist = (): void => {
    if (harness) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)), SAVE_DEBOUNCE_MS);
  };

  const renderer = initRenderer(canvas, {
    initialStyle: settings.mode,
    autoStart: !harness,
    preserveDrawingBuffer: harness,
    seed: harness ? 1234 : undefined,
  });
  const controller = initController({ renderer, settings, persist });
  const source = await WasmFrameSource.create();
  source.subscribe((f) => controller.onFrame(f));

  const tracks: Record<string, TrackMeta> = await fetch('/test-audio/tracks.json')
    .then((r) => (r.ok ? r.json() as Promise<Record<string, TrackMeta>> : {}))
    .catch(() => ({}));

  if (harness) {
    exposeHarness(renderer, source, tracks);
    return;
  }

  buildBar(source, tracks, renderer);
}

function buildBar(source: WasmFrameSource, tracks: Record<string, TrackMeta>, renderer: ReturnType<typeof initRenderer>): void {
  const style = document.createElement('style');
  style.textContent = BAR_CSS;
  document.head.appendChild(style);

  const bar = document.createElement('div');
  bar.id = 'webbar';
  bar.className = 'sonora-fadeable';
  const trackOpts = Object.keys(tracks).map((t) => `<option value="track:${t}">${t}</option>`).join('');
  bar.innerHTML = `
    <span class="brand">sonora</span>
    <select id="src"><option value="" selected disabled>Source…</option>${trackOpts}
      <option value="file">Audio file…</option><option value="mic">Microphone</option><option value="display">Tab / system audio</option></select>
    <button id="play">Play</button>
    <span id="clock" class="dim">--:--</span>
    <span id="fps" class="dim">-- fps</span>
  `;
  document.body.appendChild(bar);
  const hint = document.createElement('div');
  hint.id = 'drop-hint';
  hint.textContent = 'drop audio to play';
  document.body.appendChild(hint);

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*';
  const sel = bar.querySelector<HTMLSelectElement>('#src')!;
  const playBtn = bar.querySelector<HTMLButtonElement>('#play')!;
  const clock = bar.querySelector<HTMLSpanElement>('#clock')!;
  const fpsEl = bar.querySelector<HTMLSpanElement>('#fps')!;

  const playBlob = async (data: Blob | ArrayBuffer): Promise<void> => {
    const buf = await source.loadFile(data);
    await source.playBuffer(buf, 0, () => { playBtn.textContent = 'Play'; });
    playBtn.textContent = 'Pause';
  };

  sel.addEventListener('change', async () => {
    const v = sel.value;
    try {
      if (v.startsWith('track:')) {
        const meta = tracks[v.slice(6)];
        const res = await fetch(`/test-audio/${meta.file}`);
        await playBlob(await res.arrayBuffer());
      } else if (v === 'file') {
        fileInput.click();
      } else if (v === 'mic') {
        await source.useMicrophone();
        playBtn.textContent = 'Live';
      } else if (v === 'display') {
        await source.useDisplayAudio();
        playBtn.textContent = 'Live';
      }
    } catch (err) {
      console.warn('Source failed:', err);
      clock.textContent = err instanceof Error ? err.message.slice(0, 48) : 'source failed';
    }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void playBlob(f);
  });
  playBtn.addEventListener('click', () => {
    if (source.isPlaying) { source.pause(); playBtn.textContent = 'Play'; }
    else { void source.resume(); if (source.duration) playBtn.textContent = 'Pause'; }
  });

  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dragging');
    const f = e.dataTransfer?.files[0];
    if (f) void playBlob(f);
  });

  const fmt = (t: number): string => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  window.setInterval(() => {
    const st = renderer.stats();
    fpsEl.textContent = `${st.fps.toFixed(0)} fps · ${st.quality.level}`;
    if (source.duration) clock.textContent = `${fmt(source.currentTime)} / ${fmt(source.duration)}`;
  }, 250);
}

function exposeHarness(renderer: ReturnType<typeof initRenderer>, source: WasmFrameSource, tracks: Record<string, TrackMeta>): void {
  const events: SonoraEvent[] = [];
  renderer.onEvent((e) => events.push(e));
  const gl = renderer.canvas.getContext('webgl2');
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
    snapshot(): string {
      return renderer.canvas.toDataURL('image/png');
    },
    configure(o) {
      if (o.style) renderer.setStyle(o.style, true);
      if (o.variant) renderer.setVariant(o.variant);
      if (o.depth !== undefined) renderer.setDepth(o.depth);
      if (o.light) renderer.setLightMode(o.light);
      if (o.quality) renderer.setQuality(o.quality);
      if (o.palette !== undefined) renderer.colorEngine.setPalette(o.palette);
      if (o.drift !== undefined) renderer.colorEngine.setAutoDrift(o.drift);
    },
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
