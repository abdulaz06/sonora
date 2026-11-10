/**
 * App controller — binds the renderer, persisted settings, settings panel,
 * palette picker, keyboard shortcuts and debug overlay. Shared by the desktop
 * entry (`src/main.ts`) and the web dev page (`src/web/main.ts`); each entry
 * supplies its own persistence and (optionally) audio-device hooks.
 */

import { CAMERA_PRESETS, type CameraView } from '../engine/camera';
import type { Renderer } from '../engine/renderer';
import type { PersistedSettings } from '../ipc/settings';
import type { DeviceInfo } from '../ipc/audio-device';
import { getStyle, visibleStyles } from '../styles/registry';
import type { StyleId } from '../styles/visual-style';
import { toggleDebugOverlay, updateDebugOverlay } from '../ui/debug-overlay';
import { initHoverUI } from '../ui/hover-ui';
import { initPalettePicker, syncPalettePicker } from '../ui/palette-picker';
import { initSettingsPanel, syncSettings } from '../ui/settings-panel';
import type { AudioFeatureFrame } from '../types/audio-frame';

export interface ControllerOptions {
  renderer: Renderer;
  settings: PersistedSettings;
  persist: () => void;
  audio?: {
    devices: DeviceInfo[];
    currentName: string;
    onChange: (id: string) => void;
  };
}

export interface Controller {
  /** Feed every analysis frame (renderer + debug overlay). */
  onFrame(frame: AudioFeatureFrame): void;
  setStyle(id: StyleId): void;
  syncAudio(devices: DeviceInfo[] | null, currentName: string | null): void;
}

export function initController(opts: ControllerOptions): Controller {
  const { renderer, settings, persist } = opts;

  const variantFor = (id: StyleId): string => {
    const d = getStyle(id);
    const v = settings.variants[id];
    return v && d.variants.some((x) => x.id === v) ? v : d.defaultVariant;
  };
  const depthFor = (id: StyleId): boolean => settings.depth[id] ?? getStyle(id).defaultDepth;
  const depthActive = (): boolean => getStyle(settings.mode).supportsDepth && depthFor(settings.mode);
  const lightFor = (id: StyleId) => settings.lightModes[id] ?? 'auto';

  function applyStyle(id: StyleId, immediate = false): void {
    renderer.setStyle(id, immediate);
    renderer.setVariant(variantFor(id));
    renderer.setDepth(depthFor(id));
    renderer.setLightMode(lightFor(id));
    settings.mode = id;
  }

  // ── Initial engine state ──
  applyStyle(settings.mode, true);
  if (settings.paletteIndex < 0) renderer.colorEngine.setCustomHue(settings.customHue);
  else renderer.colorEngine.setPalette(settings.paletteIndex);
  renderer.colorEngine.setAutoDrift(settings.autoDrift);
  renderer.colorEngine.setDriftPeriod(settings.driftPeriod);
  renderer.setQuality(settings.quality);
  renderer.setResponsiveness(settings.responsiveness);
  renderer.setRingCount(settings.ringCount);
  renderer.camera.setView(settings.camera);

  const panelState = () => ({
    style: settings.mode,
    variant: variantFor(settings.mode),
    depth: depthFor(settings.mode),
    lightMode: lightFor(settings.mode),
    showClassic: settings.showClassic,
  });

  function setStyle(id: StyleId): void {
    applyStyle(id);
    syncSettings(panelState());
    persist();
  }

  initHoverUI();
  initPalettePicker(renderer.colorEngine, {
    initialPaletteIndex: settings.paletteIndex,
    initialCustomHue: settings.customHue,
    onPaletteChange: (idx) => {
      settings.paletteIndex = idx;
      syncSettings({ paletteIndex: idx });
      persist();
    },
    onCustomHueChange: (hue) => {
      settings.paletteIndex = -1;
      settings.customHue = hue;
      syncSettings({ paletteIndex: -1, customHue: hue });
      persist();
    },
  });

  const setCamera = (v: CameraView): void => {
    renderer.camera.setView(v);
    settings.camera = { ...v };
    persist();
  };
  // Mouse changes come from the camera itself; mirror them into settings/UI.
  let cameraSyncTimer = 0;
  renderer.camera.setViewListener((v) => {
    settings.camera = v;
    window.clearTimeout(cameraSyncTimer);
    cameraSyncTimer = window.setTimeout(() => { syncSettings({ camera: v }); persist(); }, 150);
  });

  initSettingsPanel({
    onStyleChange: setStyle,
    onCameraChange: setCamera,
    onVariantChange: (v) => {
      renderer.setVariant(v);
      settings.variants = { ...settings.variants, [settings.mode]: v };
      persist();
    },
    onDepthChange: (on) => {
      renderer.setDepth(on);
      settings.depth = { ...settings.depth, [settings.mode]: on };
      persist();
    },
    onLightModeChange: (m) => {
      renderer.setLightMode(m);
      settings.lightModes = { ...settings.lightModes, [settings.mode]: m };
      persist();
    },
    onShowClassicChange: (on) => {
      settings.showClassic = on;
      if (!on && getStyle(settings.mode).category === 'classic') setStyle('flow-ink');
      persist();
    },
    onRingCountChange: (n) => { renderer.setRingCount(n); settings.ringCount = n; persist(); },
    onPaletteChange: (idx) => {
      if (idx < 0) renderer.colorEngine.setCustomHue(settings.customHue);
      else renderer.colorEngine.setPalette(idx);
      settings.paletteIndex = idx;
      syncPalettePicker(idx, settings.customHue);
      persist();
    },
    onCustomHueChange: (hue) => {
      renderer.colorEngine.setCustomHue(hue);
      settings.paletteIndex = -1;
      settings.customHue = hue;
      syncPalettePicker(-1, hue);
      persist();
    },
    onAutoDriftChange: (on) => { renderer.colorEngine.setAutoDrift(on); settings.autoDrift = on; persist(); },
    onDriftPeriodChange: (s) => { renderer.colorEngine.setDriftPeriod(s); settings.driftPeriod = s; persist(); },
    onResponsivenessChange: (t) => { renderer.setResponsiveness(t); settings.responsiveness = t; persist(); },
    onQualityChange: (q) => { renderer.setQuality(q); settings.quality = q; persist(); },
    onAudioDeviceChange: opts.audio
      ? (id) => {
        if (settings.audioDevice === id) return;
        settings.audioDevice = id;
        opts.audio?.onChange(id);
        persist();
      }
      : undefined,
  }, {
    ...panelState(),
    ringCount: settings.ringCount,
    camera: settings.camera,
    paletteIndex: settings.paletteIndex,
    customHue: settings.customHue,
    autoDrift: settings.autoDrift,
    driftPeriod: settings.driftPeriod,
    responsiveness: settings.responsiveness,
    quality: settings.quality,
    audioDevice: settings.audioDevice,
    audioDevices: opts.audio?.devices ?? [],
    currentAudioDeviceName: opts.audio?.currentName ?? '',
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    const k = e.key.toLowerCase();
    if (k === 'd') {
      toggleDebugOverlay();
    } else if (k === 's') {
      const list = visibleStyles(settings.showClassic);
      const i = list.findIndex((s) => s.id === settings.mode);
      setStyle(list[(i + 1) % list.length].id);
    } else if (k === 'c' && depthActive()) {
      const i = CAMERA_PRESETS.findIndex((p) => Math.abs(p.view.height - settings.camera.height) < 0.03
        && Math.abs(p.view.tilt - settings.camera.tilt) < 0.03 && Math.abs(p.view.curve - settings.camera.curve) < 0.03);
      const next = CAMERA_PRESETS[(i + 1) % CAMERA_PRESETS.length];
      setCamera({ ...next.view });
      syncSettings({ camera: settings.camera });
    } else if (k === 'v' && getStyle(settings.mode).supportsDepth) {
      const on = !depthFor(settings.mode);
      renderer.setDepth(on);
      settings.depth = { ...settings.depth, [settings.mode]: on };
      syncSettings({ depth: on });
      persist();
    }
  });

  // ── Mouse camera control on the canvas ──
  // Depth: drag to turn/tilt, wheel for height. Flat: drag to pan, wheel to zoom.
  // Double-click returns to the nearest preset (or Glide).
  const canvas = renderer.canvas;
  let dragging = false, lastX = 0, lastY = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
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
    e.preventDefault();
    renderer.camera.wheel(Math.sign(e.deltaY), depthActive());
  }, { passive: false });
  canvas.addEventListener('dblclick', () => {
    if (!depthActive()) return;
    let best = CAMERA_PRESETS[0], bestD = Infinity;
    for (const p of CAMERA_PRESETS) {
      const d = Math.abs(p.view.height - settings.camera.height) + Math.abs(p.view.tilt - settings.camera.tilt)
        + Math.abs(p.view.curve - settings.camera.curve);
      if (d < bestD) { bestD = d; best = p; }
    }
    setCamera({ ...best.view });
    syncSettings({ camera: settings.camera });
  });

  return {
    onFrame(frame: AudioFeatureFrame): void {
      renderer.pushFrame(frame);
      updateDebugOverlay(frame, renderer.events.state, renderer.stats());
    },
    setStyle,
    syncAudio(devices: DeviceInfo[] | null, currentName: string | null): void {
      syncSettings({
        ...(devices ? { audioDevices: devices } : {}),
        ...(currentName !== null ? { currentAudioDeviceName: currentName } : {}),
      });
    },
  };
}
