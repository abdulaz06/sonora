/**
 * App controller — the single place that changes what's on screen and what
 * gets saved. Screens (menu, settings, quick switcher, Set Mode, keyboard)
 * call its setters; it applies them to the renderer, persists, and notifies
 * subscribers so every view stays in sync. Shared by the desktop entry
 * (`src/main.ts`) and the web page (`src/web/main.ts`).
 */

import type { CameraView } from '../engine/camera';
import type { QualityPreset } from '../engine/quality';
import type { Renderer } from '../engine/renderer';
import { defaultStylePrefs, type PersistedSettings, type StylePrefs } from '../ipc/settings';
import { getStyle, presetsFor } from '../styles/registry';
import type { LightMode, StyleId } from '../styles/visual-style';
import { toggleDebugOverlay, updateDebugOverlay } from '../ui/debug-overlay';
import type { AudioFeatureFrame } from '../types/audio-frame';

/** Live audio level (0–1) from the last analysis frame, for meters. */
export type LevelListener = (level: number, frame: AudioFeatureFrame) => void;
export type ChangeListener = (s: PersistedSettings) => void;

export interface ShowOptions {
  variant?: string;
  depth?: boolean;
  /** Swap instantly (no crossfade); used behind the menu and for Set Mode cuts. */
  cut?: boolean;
}

export interface Controller {
  readonly settings: PersistedSettings;
  readonly renderer: Renderer;
  onFrame(frame: AudioFeatureFrame): void;
  onLevel(cb: LevelListener): () => void;
  subscribe(cb: ChangeListener): () => void;
  /** Save and notify after changing `settings` fields directly (v6 fields). */
  commit(): void;
  variantFor(id: StyleId): string;
  depthFor(id: StyleId): boolean;
  depthActive(): boolean;
  show(id: StyleId, o?: ShowOptions): void;
  setVariant(v: string): void;
  setDepth(on: boolean): void;
  setLightMode(m: LightMode): void;
  setShowClassic(on: boolean): void;
  setRingCount(n: number): void;
  setCamera(v: CameraView): void;
  setFlatZoom(z: number): void;
  setMatchColours(on: boolean): void;
  setPalette(idx: number): void;
  setCustomHue(h: number): void;
  setAutoDrift(on: boolean): void;
  setDriftPeriod(s: number): void;
  setResponsiveness(t: number): void;
  setQuality(q: QualityPreset): void;
  setFpsCap(n: number): void;
  cycleCameraPreset(): void;
  toggleDebug(): void;
  /** Enable mouse camera control on the canvas (only while the visual shows). */
  setCanvasInput(on: boolean): void;
}

export interface ControllerOptions {
  renderer: Renderer;
  settings: PersistedSettings;
  persist: () => void;
}

export function initController(opts: ControllerOptions): Controller {
  const { renderer, settings, persist } = opts;
  const listeners: ChangeListener[] = [];
  const levelListeners: LevelListener[] = [];
  let notifyQueued = false;
  const changed = (): void => {
    persist();
    if (notifyQueued) return;
    notifyQueued = true;
    queueMicrotask(() => { notifyQueued = false; for (const l of listeners) l(settings); });
  };

  const variantFor = (id: StyleId): string => {
    const d = getStyle(id);
    const v = settings.variants[id];
    return v && d.variants.some((x) => x.id === v) ? v : d.defaultVariant;
  };
  const depthFor = (id: StyleId): boolean => settings.depth[id] ?? getStyle(id).defaultDepth;
  const depthActive = (): boolean => getStyle(settings.mode).supportsDepth && depthFor(settings.mode);
  const lightFor = (id: StyleId): LightMode => settings.lightModes[id] ?? 'auto';

  // ── Per-style preferences ──
  const prefsOf = (id: StyleId): StylePrefs => (settings.styles[id] ??= defaultStylePrefs());
  type Colours = Pick<StylePrefs, 'paletteIndex' | 'customHue' | 'autoDrift' | 'driftPeriod'>;
  /** Colour changes go to the active style, or to the shared set when colours are matched. */
  function setColours(c: Partial<Colours>): void {
    Object.assign(settings, c);
    if (!settings.matchColours) Object.assign(prefsOf(settings.mode), c);
  }
  function applyColours(): void {
    if (settings.paletteIndex < 0) renderer.colorEngine.setCustomHue(settings.customHue);
    else renderer.colorEngine.setPalette(settings.paletteIndex);
    renderer.colorEngine.setAutoDrift(settings.autoDrift);
    renderer.colorEngine.setDriftPeriod(settings.driftPeriod);
  }
  /** Load a style's own settings into the engine and the mirrored fields. */
  function applyPrefs(id: StyleId): void {
    const p = prefsOf(id);
    if (!settings.matchColours) {
      settings.paletteIndex = p.paletteIndex; settings.customHue = p.customHue;
      settings.autoDrift = p.autoDrift; settings.driftPeriod = p.driftPeriod;
    }
    settings.responsiveness = p.responsiveness;
    settings.camera = { ...p.camera };
    settings.flatZoom = p.flatZoom;
    applyColours();
    renderer.setResponsiveness(settings.responsiveness);
    renderer.camera.setView(settings.camera);
    renderer.camera.setFlatZoom(settings.flatZoom);
  }

  // ── Initial engine state ──
  {
    const id = settings.mode;
    renderer.transition({ style: id, variant: variantFor(id), depth: depthFor(id), cut: true });
    renderer.setLightMode(lightFor(id));
    applyPrefs(id);
    renderer.setQuality(settings.quality);
    renderer.setFpsCap(settings.fpsCap);
    renderer.setRingCount(settings.ringCount);
  }

  // Mouse changes come from the camera itself; mirror them into settings.
  let cameraSyncTimer = 0;
  renderer.camera.setViewListener((v) => {
    settings.camera = v;
    prefsOf(settings.mode).camera = { ...v };
    window.clearTimeout(cameraSyncTimer);
    cameraSyncTimer = window.setTimeout(changed, 150);
  });
  let zoomSyncTimer = 0;
  renderer.camera.setFlatZoomListener((z) => {
    settings.flatZoom = z;
    prefsOf(settings.mode).flatZoom = z;
    window.clearTimeout(zoomSyncTimer);
    zoomSyncTimer = window.setTimeout(changed, 150);
  });

  const api: Controller = {
    settings, renderer,
    onFrame(frame: AudioFeatureFrame): void {
      renderer.pushFrame(frame);
      const level = Math.min(1, Math.sqrt(frame.energy.instant) * 2.2);
      for (const l of levelListeners) l(level, frame);
      updateDebugOverlay(frame, renderer.events.state, renderer.stats());
    },
    onLevel(cb) { levelListeners.push(cb); return () => { const i = levelListeners.indexOf(cb); if (i >= 0) levelListeners.splice(i, 1); }; },
    subscribe(cb) { listeners.push(cb); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    commit: changed,
    variantFor, depthFor, depthActive,

    show(id: StyleId, o: ShowOptions = {}): void {
      const d = getStyle(id);
      if (o.variant && d.variants.some((v) => v.id === o.variant)) settings.variants = { ...settings.variants, [id]: o.variant };
      if (o.depth !== undefined && d.supportsDepth) settings.depth = { ...settings.depth, [id]: o.depth };
      settings.mode = id;
      renderer.transition({ style: id, variant: variantFor(id), depth: depthFor(id), cut: o.cut ?? false });
      renderer.setLightMode(lightFor(id));
      applyPrefs(id);
      changed();
    },
    setVariant(v: string): void {
      renderer.setVariant(v);
      settings.variants = { ...settings.variants, [settings.mode]: v };
      changed();
    },
    setDepth(on: boolean): void {
      renderer.setDepth(on);
      settings.depth = { ...settings.depth, [settings.mode]: on };
      changed();
    },
    setLightMode(m: LightMode): void {
      renderer.setLightMode(m);
      settings.lightModes = { ...settings.lightModes, [settings.mode]: m };
      changed();
    },
    setShowClassic(on: boolean): void {
      settings.showClassic = on;
      if (!on && getStyle(settings.mode).category === 'classic') api.show('ink');
      changed();
    },
    setRingCount(n: number): void { renderer.setRingCount(n); settings.ringCount = n; changed(); },
    setCamera(v: CameraView): void {
      renderer.camera.setView(v);
      settings.camera = { ...v };
      prefsOf(settings.mode).camera = { ...v };
      changed();
    },
    setFlatZoom(z: number): void {
      renderer.camera.setFlatZoom(z);
      settings.flatZoom = renderer.camera.getFlatZoom();
      prefsOf(settings.mode).flatZoom = settings.flatZoom;
      changed();
    },
    setMatchColours(on: boolean): void {
      settings.matchColours = on;
      // Turning it off: this style keeps the colours on screen now.
      if (!on) Object.assign(prefsOf(settings.mode), { paletteIndex: settings.paletteIndex, customHue: settings.customHue, autoDrift: settings.autoDrift, driftPeriod: settings.driftPeriod });
      changed();
    },
    setPalette(idx: number): void {
      if (idx < 0) renderer.colorEngine.setCustomHue(settings.customHue);
      else renderer.colorEngine.setPalette(idx);
      setColours({ paletteIndex: idx });
      changed();
    },
    setCustomHue(hue: number): void {
      renderer.colorEngine.setCustomHue(hue);
      setColours({ paletteIndex: -1, customHue: hue });
      changed();
    },
    setAutoDrift(on: boolean): void { renderer.colorEngine.setAutoDrift(on); setColours({ autoDrift: on }); changed(); },
    setDriftPeriod(s: number): void { renderer.colorEngine.setDriftPeriod(s); setColours({ driftPeriod: s }); changed(); },
    setResponsiveness(t: number): void {
      renderer.setResponsiveness(t);
      settings.responsiveness = t;
      prefsOf(settings.mode).responsiveness = t;
      changed();
    },
    setQuality(q: QualityPreset): void { renderer.setQuality(q); settings.quality = q; changed(); },
    setFpsCap(n: number): void { renderer.setFpsCap(n); settings.fpsCap = n; changed(); },
    cycleCameraPreset(): void {
      if (!depthActive()) return;
      const list = presetsFor(settings.mode);
      const i = list.findIndex((p) => Math.abs(p.view.height - settings.camera.height) < 0.03
        && Math.abs(p.view.tilt - settings.camera.tilt) < 0.03 && Math.abs(p.view.curve - settings.camera.curve) < 0.03);
      api.setCamera({ ...list[(i + 1) % list.length].view });
    },
    toggleDebug: toggleDebugOverlay,
    setCanvasInput(on: boolean): void { canvasInput = on; },
  };

  // ── Mouse camera control on the canvas ──
  // Depth: drag to turn/tilt, wheel for height. Flat: drag to pan, wheel to zoom.
  // Double-click returns to the nearest preset.
  let canvasInput = false;
  const canvas = renderer.canvas;
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !canvasInput) return;
    dragging = true;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    renderer.camera.drag(e.clientX - lastX, e.clientY - lastY, depthActive());
    lastX = e.clientX; lastY = e.clientY;
  });
  const endDrag = (): void => { dragging = false; canvas.style.cursor = ''; };
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', (e) => {
    if (!canvasInput) return;
    e.preventDefault();
    renderer.camera.wheel(Math.sign(e.deltaY), depthActive());
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    if (!canvasInput || !depthActive()) return;
    const list = presetsFor(settings.mode);
    let best = list[0], bestD = Infinity;
    for (const p of list) {
      const d = Math.abs(p.view.height - settings.camera.height) + Math.abs(p.view.tilt - settings.camera.tilt)
        + Math.abs(p.view.curve - settings.camera.curve);
      if (d < bestD) { bestD = d; best = p; }
    }
    api.setCamera({ ...best.view });
  });

  return api;
}
