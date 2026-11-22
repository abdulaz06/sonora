/**
 * /live: the sonora app in the browser. The real shell (menu, style detail,
 * HUD, settings with (i) cards, Set Mode, keyboard), the real renderer, and
 * the DSP crate as WebAssembly analysing a file, the microphone, a shared tab
 * or the demo track. Settings persist in localStorage. Nothing is uploaded.
 */

import { initController } from '../../../src/app/controller';
import type { Platform } from '../../../src/app/platform';
import { initShell, type Shell } from '../../../src/app/shell';
import { audioStatus } from '../../../src/app/stores';
import { announceMedia, fileMedia } from '../../../src/app/file-media';
import { WasmFrameSource, type SourceStatus } from '../../../src/audio/wasm-source';
import { initRenderer } from '../../../src/engine/renderer';
import { defaultSettings, mergeWithDefaults, type PersistedSettings } from '../../../src/ipc/settings';
import { refreshDownloads } from '../lib/download';
import { staticMode } from './static';

declare const __APP_VERSION__: string;

// ── Tuning ──────────────────────────────────────────────────────
const STORAGE_KEY = 'sonora.live.settings';
const SAVE_DEBOUNCE_MS = 400;
/** The live page caps the backing store a little (laptops on battery). */
const MAX_PIXEL_RATIO = 2;
const DEMO = { webm: '/demo/demo.webm', m4a: '/demo/demo.m4a' };
/** The demo starts where the groove comes in (s), so the picture moves at once. */
const DEMO_START_S = 8.4;
/** After load, wait this long (then for idle time) before fetching the first style and warming its shaders (ms). */
const PREFETCH_AFTER_MS = 2500;
const PREWARM_TIMEOUT_MS = 15000;

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

function loadSettings(): PersistedSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const s = raw ? mergeWithDefaults(JSON.parse(raw)) : defaultSettings();
    s.onboarded = true;
    return s;
  } catch {
    return { ...defaultSettings(), onboarded: true };
  }
}

/** Chromium can share a tab's sound; Firefox and Safari can't (yet). */
function canShareTabAudio(): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }).userAgentData?.brands ?? [];
  return !!navigator.mediaDevices?.getDisplayMedia && brands.some((b) => /Chromium|Google Chrome|Microsoft Edge/.test(b.brand));
}

export async function bootLive(): Promise<void> {
  void refreshDownloads();
  const html = document.documentElement;
  if (html.classList.contains('lv-static')) { staticMode(); return; }  // (the page loads ./static for these)

  const canvas = $<HTMLCanvasElement>('#canvas')!;
  const settings = loadSettings();
  let saveTimer = 0;
  const persist = (): void => {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* storage blocked */ } }, SAVE_DEBOUNCE_MS);
  };

  let renderer: ReturnType<typeof initRenderer>;
  try {
    renderer = initRenderer(canvas, { initialStyle: settings.mode, autoStart: true, maxPixelRatio: MAX_PIXEL_RATIO });
  } catch (err) {
    console.warn('sonora: the visuals could not start', err);
    html.classList.add('lv-static');
    html.dataset.why = 'webgl';
    staticMode();
    return;
  }
  const controller = initController({ renderer, settings, persist });
  // The analyser (WebAssembly) loads alongside the shell.
  const sourceReady = WasmFrameSource.create();

  const sheet = $('#lv-sheet')!;
  const note = $('#lv-note')!;
  const openSheet = (): void => { sheet.classList.add('open'); $<HTMLButtonElement>('[data-src="demo"]')?.focus(); };
  const closeSheet = (): void => { sheet.classList.remove('open'); };
  const say = (msg: string): void => { note.textContent = msg; note.classList.toggle('show', !!msg); };

  const platform: Platform = {
    kind: 'web',
    version: __APP_VERSION__,
    listDevices: async () => [],
    setDevice: () => undefined,
    openSourceChooser: () => window.setTimeout(openSheet, 0),
    toggleFullscreen: () => { if (document.fullscreenElement) void document.exitFullscreen(); else void document.documentElement.requestFullscreen().catch(() => undefined); },
    isFullscreen: () => !!document.fullscreenElement,
    onFullscreenChange: (cb) => document.addEventListener('fullscreenchange', () => cb(!!document.fullscreenElement)),
  };
  const shell: Shell = await initShell(controller, platform, { noLaunch: true, start: 'menu' });
  const source = await sourceReady;
  source.subscribe((f) => controller.onFrame(f));
  source.onStatus((st) => audioStatus.patch({ device: st.state === 'idle' ? '' : st.label }));
  // Once the page is idle: fetch the chosen style's code and compile its shaders in a worker
  // (the GPU process caches them), so opening the visual never stalls the page.
  const idle = (f: () => void): void => { const ric = (window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback; if (ric) ric(f, { timeout: PREFETCH_AFTER_MS * 2 }); else window.setTimeout(f, PREFETCH_AFTER_MS); };
  window.setTimeout(() => idle(() => {
    void import('../../../src/styles/registry').then((r) => r.loadStyle(settings.mode));
    if (shell.screen() !== 'visual') {
      void import('../lib/prewarm').then((m) => m.prewarm([{ style: settings.mode, variant: controller.variantFor(settings.mode), depth: controller.depthFor(settings.mode) } as Parameters<typeof m.prewarm>[0][number]], Math.min(innerWidth, 1280), Math.min(innerHeight, 720), PREWARM_TIMEOUT_MS));
    }
  }), PREFETCH_AFTER_MS);
  // The strip hides on the visual (the app's own chrome takes over).
  const watch = (): void => { document.body.classList.toggle('lv-visual', shell.screen() === 'visual'); };
  window.setInterval(watch, 300);

  // ── Sources ──
  const tabOk = canShareTabAudio();
  if (!tabOk) {
    const line = $('[data-tab-line]');
    if (line) line.textContent = 'Sharing a tab’s sound works in Chrome and Edge on desktop. In this browser, play a file or use the microphone instead.';
    $<HTMLButtonElement>('[data-src="tab"]')!.disabled = true;
  }
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'audio/*,.mp3,.wav,.ogg,.oga,.m4a,.flac,.opus,.webm';

  const playData = async (data: Blob | ArrayBuffer, label: string, from = 0, artist = ''): Promise<void> => {
    try {
      // Tags (title, artist, embedded cover) first: decoding detaches an ArrayBuffer.
      const info = await fileMedia(data instanceof Blob ? data : data.slice(0), label);
      if (artist && !info.artist) info.artist = artist;
      const buf = await source.loadFile(data);
      await source.playBuffer(buf, from, () => undefined, label);
      announceMedia(info, renderer);
      closeSheet();
      say('');
      shell.goVisual();
    } catch {
      openSheet();
      say('That file couldn’t be decoded. Try an mp3, wav, ogg, m4a or flac.');
    }
  };
  const playDemo = async (): Promise<void> => {
    say('Loading the demo…');
    const probe = document.createElement('audio');
    const url = probe.canPlayType('audio/webm; codecs="opus"') ? DEMO.webm : DEMO.m4a;
    const data = await fetch(url).then((r) => r.arrayBuffer());
    await playData(data, 'sonora demo', DEMO_START_S, 'made for sonora');
  };

  sheet.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === sheet || t.closest('[data-close]')) { closeSheet(); return; }
    const kind = t.closest<HTMLElement>('[data-src]')?.dataset.src;
    if (!kind) return;
    say('');
    if (kind === 'demo') void playDemo();
    else if (kind === 'file') fileInput.click();
    else if (kind === 'mic') {
      say('Waiting for the browser to ask about the microphone…');
      source.useMicrophone().then(() => { closeSheet(); say(''); shell.goVisual(); }).catch((err: unknown) => {
        const denied = err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
        const none = err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'OverconstrainedError');
        say(denied
          ? 'The microphone was blocked. To allow it, click the icon at the left of the address bar, set Microphone to Allow, and try again. Nothing is recorded or uploaded.'
          : none ? 'No microphone was found. Plug one in, or play a file instead.'
            : 'The microphone couldn’t start. Another app may be using it; close it and try again.');
      });
    } else if (kind === 'tab') {
      say('Choose the tab that’s playing music, and keep “Also share tab audio” switched on.');
      source.useDisplayAudio('tab').then(() => { closeSheet(); say(''); shell.goVisual(); }).catch((err: unknown) => {
        const cancelled = err instanceof DOMException && err.name === 'NotAllowedError';
        const st: SourceStatus = source.currentStatus;
        say(cancelled
          ? 'Sharing was cancelled. When you try again, pick the tab with the music, and keep “Also share tab audio” on. sonora only hears the sound; nothing leaves your computer.'
          : st.message || 'This browser couldn’t share the tab’s sound. Play a file or use the microphone instead.');
      });
    }
  });
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (f) void playData(f, f.name);
    fileInput.value = '';
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sheet.classList.contains('open')) { e.stopPropagation(); closeSheet(); } }, true);

  // Drop a file anywhere.
  window.addEventListener('dragover', (e) => { e.preventDefault(); document.body.classList.add('lv-dragging'); });
  window.addEventListener('dragleave', (e) => { if (e.relatedTarget === null) document.body.classList.remove('lv-dragging'); });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('lv-dragging');
    const f = e.dataTransfer?.files[0];
    if (f) void playData(f, f.name);
  });

  // Capture that stops (tab closed, sharing stopped) brings the chooser back with advice.
  source.onStatus((st) => {
    if (st.state === 'reconnect' || st.state === 'error') { openSheet(); say(st.message); }
  });
  (window as unknown as { __live?: unknown }).__live = { shell, source, renderer, controller };
}
