/**
 * Settings panel — gear button bottom-right opens a side panel:
 *   Style        style, look, Depth/Flat view, background, rings (Aura),
 *                classic-styles toggle
 *   Camera       presets + height / tilt / curve (Depth view only)
 *   Colour       palette, custom hue, colour drift + drift speed
 *   Feel         responsiveness
 *   Performance  quality, frame-rate cap
 *   Audio        source device (desktop only)
 *
 * Every control carries a one-line plain-language hint. Shared by the desktop
 * app and the web dev page. Brand rules: Night/Bone only, mono uppercase
 * labels, square corners, 1 px Bone/12% dividers.
 */

import { CAMERA_PRESETS, type CameraView } from '../engine/camera';
import { MAX_DRIFT_PERIOD_S, MIN_DRIFT_PERIOD_S, PALETTES } from '../engine/color-engine';
import type { QualityPreset } from '../engine/quality';
import { FPS_CAPS } from '../ipc/settings';
import { getStyle, visibleStyles } from '../styles/registry';
import { variantSupportsLight, type LightMode, type StyleId } from '../styles/visual-style';
import type { DeviceInfo } from '../ipc/audio-device';

export type { StyleId, QualityPreset };

const RING_COUNT_MIN = 2;
const RING_COUNT_MAX = 10;
/** Two camera views count as "the same preset" within this distance. */
const PRESET_MATCH = 0.03;

/** Plain-language descriptions shown under controls. */
const STYLE_HINTS: Partial<Record<StyleId, string>> = {
  'flow-ink': 'Liquid ink that splashes on every beat and drifts with the music.',
  strands: 'Millions of light particles drawn into threads, beams and trails.',
  turing: 'A living pattern that grows spots, mazes and stripes with the music. Song titles grow into it.',
  mosh: 'A glitchy tunnel of nested frames that smears, tears and freezes on the drop.',
  fractal: 'A flight through an endless 3D fractal. Heavy on the graphics card; try Low on laptops.',
  aura: 'Classic v0.1 rings, particles and glow.',
  halo: 'Classic v0.1 circular spectrum.',
};
const VARIANT_HINTS: Record<string, string> = {
  ink: 'Glowing coloured ink on a dark background.',
  sumi: 'Black ink on bone paper, like ink dropped in water.',
  marble: 'Two-tone marbling with a fine stippled grain.',
  circle: 'Round rings.', triangle: 'Triangular rings.', square: 'Square rings.',
  soft: 'Soft, glowing bars.', sharp: 'Crisp, thin bars.',
  silk: 'Flowing silk threads that ripple out from the bass.',
  lumen: 'Fine light filaments bursting from a moving source.',
  wisp: 'Three flames trailing smoke rings on the beat.',
  starry: 'Brushstrokes swirling around stars, like a night painting.',
  warp: 'Streaking stars at hyperspace speed. Builds speed up, drops jump.',
  coral: 'Ink-on-paper coral, spots and mazes.',
  bio: 'Glowing deep-sea patterns on black.',
  concrete: 'Worn concrete and asphalt with cracks and paint.',
  signal: 'Squares, rings and spectrum bars from Sonora itself.',
  voyage: 'Fly through fractal halls and canyons. Drops dive.',
  kaleido: 'The flight folded into a mirrored mandala. Drops flip the symmetry.',
};
const QUALITY_HINTS: Record<QualityPreset, string> = {
  low: 'Smaller simulation and render size. Use on laptops or integrated graphics.',
  medium: 'Balanced detail. Smooth on most dedicated graphics cards.',
  high: 'Full resolution and the finest ink detail.',
  auto: 'Starts at Medium and steps up or down to keep motion smooth.',
};
const LIGHT_HINTS: Record<LightMode, string> = {
  auto: 'Uses each look’s natural background (Sumi and Coral are paper, the others are dark).',
  dark: 'Always a dark background.',
  light: 'Always a light, paper-like background.',
};

export interface SettingsCallbacks {
  onStyleChange: (style: StyleId) => void;
  onVariantChange: (variant: string) => void;
  onDepthChange: (on: boolean) => void;
  onLightModeChange: (mode: LightMode) => void;
  onShowClassicChange: (on: boolean) => void;
  onRingCountChange: (n: number) => void;
  onCameraChange: (view: CameraView) => void;
  /** -1 means custom (use the custom hue). */
  onPaletteChange: (paletteIndex: number) => void;
  onCustomHueChange: (hue: number) => void;
  onAutoDriftChange: (on: boolean) => void;
  onDriftPeriodChange: (seconds: number) => void;
  onResponsivenessChange: (t: number) => void;
  onQualityChange: (preset: QualityPreset) => void;
  onFpsCapChange: (fps: number) => void;
  /** Desktop: pick an output device to listen to. */
  onAudioDeviceChange?: (id: string) => void;
  /** Web: open the audio source chooser. */
  onOpenAudioSource?: () => void;
}

export interface SettingsState {
  style: StyleId;
  variant: string;
  depth: boolean;
  lightMode: LightMode;
  showClassic: boolean;
  ringCount: number;
  camera: CameraView;
  paletteIndex: number;
  customHue: number;
  autoDrift: boolean;
  driftPeriod: number;
  responsiveness: number;
  quality: QualityPreset;
  fpsCap: number;
  audioDevice: string;
  audioDevices: DeviceInfo[];
  currentAudioDeviceName: string;
}

const CSS = `
#settings-btn {
  position: fixed; bottom: 16px; right: 60px; width: 32px; height: 32px;
  background: rgba(8, 8, 10, 0.82); border: 1px solid rgba(236, 231, 223, 0.18);
  color: rgba(236, 231, 223, 0.7); cursor: pointer; z-index: 999;
  display: flex; align-items: center; justify-content: center;
  transition: color 0.2s, border-color 0.2s;
}
#settings-btn:hover, #settings-btn.active { color: #ECE7DF; border-color: rgba(236, 231, 223, 0.5); }
#settings-btn svg { width: 15px; height: 15px; stroke: currentColor; fill: none; stroke-width: 1.6; }
#settings-panel {
  position: fixed; top: 0; right: 0; bottom: 0; width: 320px;
  background: rgba(8, 8, 10, 0.92); border-left: 1px solid rgba(236, 231, 223, 0.12);
  color: rgba(236, 231, 223, 0.86); z-index: 998; padding: 20px 20px 72px;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; font-size: 12px;
  transform: translateX(340px); opacity: 0; pointer-events: none;
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s;
  overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(236,231,223,0.2) transparent;
}
#settings-panel.open { transform: none; opacity: 1; pointer-events: auto; }
#settings-panel .sec { padding: 16px 0; border-top: 1px solid rgba(236, 231, 223, 0.12); }
#settings-panel .sec:first-child { border-top: 0; padding-top: 0; }
#settings-panel .title, #settings-panel .label, #settings-panel button, #settings-panel select, #settings-panel .val, #settings-panel .mono {
  font-family: 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 10px;
}
#settings-panel .title { color: rgba(236, 231, 223, 0.38); margin-bottom: 12px; }
#settings-panel .field { margin-bottom: 14px; }
#settings-panel .field:last-child { margin-bottom: 0; }
#settings-panel .label { color: rgba(236, 231, 223, 0.62); margin-bottom: 6px; display: flex; justify-content: space-between; }
#settings-panel .val { color: rgba(236, 231, 223, 0.9); letter-spacing: 0.06em; }
#settings-panel .hint { font-size: 11px; line-height: 1.45; color: rgba(236, 231, 223, 0.45); margin-top: 6px; }
#settings-panel .ends { display: flex; justify-content: space-between; font-family: 'IBM Plex Mono', Consolas, monospace;
  font-size: 9px; letter-spacing: 0.1em; text-transform: uppercase; color: rgba(236, 231, 223, 0.35); margin-top: 3px; }
#settings-panel .seg { display: flex; flex-wrap: wrap; border: 1px solid rgba(236, 231, 223, 0.12); }
#settings-panel .seg button {
  flex: 1 1 auto; min-width: 25%; background: transparent; border: 0;
  border-right: 1px solid rgba(236, 231, 223, 0.12); color: rgba(236, 231, 223, 0.55);
  padding: 7px 6px; cursor: pointer;
}
#settings-panel .seg button:last-child { border-right: 0; }
#settings-panel .seg button:hover { color: #ECE7DF; }
#settings-panel .seg button.on { background: rgba(236, 231, 223, 0.12); color: #ECE7DF; }
#settings-panel input[type=range] { width: 100%; accent-color: #ECE7DF; height: 2px; }
#settings-panel .hue { -webkit-appearance: none; appearance: none; height: 8px;
  background: linear-gradient(to right, hsl(0,70%,50%), hsl(60,70%,50%), hsl(120,70%,50%), hsl(180,70%,50%), hsl(240,70%,50%), hsl(300,70%,50%), hsl(360,70%,50%)); }
#settings-panel .swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; }
#settings-panel .sw { aspect-ratio: 1; cursor: pointer; border: 1px solid transparent; outline: 1px solid rgba(236,231,223,0.12); }
#settings-panel .sw.on { border-color: #08080A; outline: 1px solid #ECE7DF; }
#settings-panel .sw.custom { background: conic-gradient(#d33, #dd3, #3d6, #3cd, #36d, #c3d, #d33); }
#settings-panel .check { display: flex; align-items: center; gap: 8px; cursor: pointer; color: rgba(236,231,223,0.62); }
#settings-panel .check input { accent-color: #ECE7DF; }
#settings-panel select { width: 100%; background: #08080A; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.18); padding: 6px; }
#settings-panel .meter { height: 4px; background: rgba(236,231,223,0.12); margin-top: 8px; }
#settings-panel .meter i { display: block; height: 100%; width: 0; background: #ECE7DF; transition: width 80ms linear; }
#settings-panel .go { width: 100%; background: transparent; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.3); padding: 8px; cursor: pointer; }
#settings-panel kbd { font-family: inherit; border: 1px solid rgba(236,231,223,0.2); padding: 0 4px; margin-right: 6px; }
#settings-panel .keys { line-height: 1.9; color: rgba(236,231,223,0.55); }
`;

const GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>`;

let state: SettingsState;
let cb: SettingsCallbacks;
let panel: HTMLDivElement | null = null;
let btn: HTMLButtonElement | null = null;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const segBtn = (action: string, value: string, label: string, on: boolean, title = ''): string =>
  `<button data-a="${action}" data-v="${esc(value)}" class="${on ? 'on' : ''}"${title ? ` title="${esc(title)}"` : ''}>${esc(label)}</button>`;
const hint = (text: string, id = ''): string => `<div class="hint"${id ? ` id="${id}"` : ''}>${esc(text)}</div>`;
const ends = (a: string, b: string, c = ''): string =>
  `<div class="ends"><span>${esc(a)}</span>${c ? `<span>${esc(c)}</span>` : ''}<span>${esc(b)}</span></div>`;

function activePreset(v: CameraView): string | null {
  for (const p of CAMERA_PRESETS) {
    if (Math.abs(p.view.height - v.height) < PRESET_MATCH && Math.abs(p.view.tilt - v.tilt) < PRESET_MATCH
      && Math.abs(p.view.curve - v.curve) < PRESET_MATCH) return p.id;
  }
  return null;
}

function cycleText(seconds: number): string {
  const m = seconds / 60;
  return `One full colour cycle every ${m < 1.5 ? `${Math.round(seconds)} seconds` : `${m.toFixed(m < 10 ? 1 : 0)} minutes`}.`;
}

function render(): void {
  if (!panel) return;
  const desc = getStyle(state.style);
  const styles = visibleStyles(state.showClassic);
  const palName = state.paletteIndex >= 0 ? PALETTES[state.paletteIndex]?.name ?? '' : 'Custom';
  const preset = activePreset(state.camera);
  const presetHint = CAMERA_PRESETS.find((p) => p.id === preset)?.hint ?? 'Custom view.';
  const depthOn = desc.supportsDepth && state.depth;

  const camera = depthOn ? `
    <div class="sec">
      <div class="title">Camera</div>
      <div class="field"><div class="label">View preset</div>
        <div class="seg">${CAMERA_PRESETS.map((p) => segBtn('preset', p.id, p.label, p.id === preset, p.hint)).join('')}</div>
        ${hint(presetHint)}
      </div>
      <div class="field"><div class="label">Height</div>
        <input type="range" data-a="cam-height" min="0" max="100" value="${Math.round(state.camera.height * 100)}">
        ${ends('Skim the surface', 'High above')}
      </div>
      <div class="field"><div class="label">Tilt</div>
        <input type="range" data-a="cam-tilt" min="0" max="100" value="${Math.round(state.camera.tilt * 100)}">
        ${ends('Toward horizon', 'Straight down')}
      </div>
      <div class="field"><div class="label">Curve</div>
        <input type="range" data-a="cam-curve" min="-100" max="100" value="${Math.round(state.camera.curve * 100)}">
        ${ends('Bowl  U', 'Planet  ∩', 'Flat')}
      </div>
      ${hint('Drag on the picture to look around. Scroll to change height. Double-click to reset the preset.')}
    </div>` : desc.supportsDepth ? `
    <div class="sec">
      <div class="title">Camera</div>
      ${hint('Drag on the picture to move around. Scroll to zoom in and out. Switch View to Depth for camera presets.')}
    </div>` : '';

  const meter = `<div class="meter"><i id="audio-level"></i></div>`;
  const audio = cb.onAudioDeviceChange ? `
    <div class="sec">
      <div class="title">Audio</div>
      <div class="field"><div class="label">Listen to</div>
        <select data-a="device">${deviceOptions()}</select>
        ${meter}
        ${hint(state.currentAudioDeviceName
          ? `Hearing: ${state.currentAudioDeviceName}. ${state.audioDevice === 'default'
            ? 'Follows the speakers or headphones Windows is using and switches by itself when you plug something in.'
            : 'Pinned to this device. Choose "Whatever Windows is playing on" to follow device changes automatically.'}`
          : 'No playback device found. Plug in speakers or headphones; Sonora picks them up automatically.')}
      </div>
    </div>` : cb.onOpenAudioSource ? `
    <div class="sec">
      <div class="title">Audio</div>
      <div class="field">
        <button class="go" data-a="audio-source">Choose audio source</button>
        ${meter}
        ${hint('Share a browser tab (best), your whole computer, a microphone, or play a file.')}
      </div>
    </div>` : '';

  panel.innerHTML = `
    <div class="sec">
      <div class="title">Style</div>
      <div class="field">
        <div class="seg">${styles.map((s) => segBtn('style', s.id, s.label, s.id === state.style)).join('')}</div>
        ${hint(STYLE_HINTS[state.style] ?? '')}
      </div>
      <div class="field"><div class="label">Look</div>
        <div class="seg">${desc.variants.map((v) => segBtn('variant', v.id, v.label, v.id === state.variant)).join('')}</div>
        ${hint(VARIANT_HINTS[state.variant] ?? '')}
      </div>
      ${desc.supportsDepth ? `<div class="field"><div class="label">View</div>
        <div class="seg">${segBtn('depth', '1', 'Depth', state.depth)}${segBtn('depth', '0', 'Flat', !state.depth)}</div>
        ${hint(state.depth ? 'Fly over the ink as a 3D surface.' : 'Look straight down at the ink, like a canvas.')}</div>` : ''}
      ${variantSupportsLight(desc, state.variant) ? `<div class="field"><div class="label">Background</div>
        <div class="seg">${(['auto', 'dark', 'light'] as LightMode[]).map((m) => segBtn('light', m, m, state.lightMode === m)).join('')}</div>
        ${hint(LIGHT_HINTS[state.lightMode])}</div>` : ''}
      ${desc.id === 'aura' ? `<div class="field"><div class="label">Rings <span class="val" id="ring-val">${state.ringCount}</span></div>
        <input type="range" data-a="rings" min="${RING_COUNT_MIN}" max="${RING_COUNT_MAX}" step="1" value="${state.ringCount}"></div>` : ''}
      <label class="check mono"><input type="checkbox" data-a="classic" ${state.showClassic ? 'checked' : ''}> Show classic styles</label>
      ${hint('Adds Aura and Halo from Sonora 0.1 to the style list.')}
    </div>
    ${camera}
    <div class="sec">
      <div class="title">Colour</div>
      <div class="field"><div class="label">Palette <span class="val">${esc(palName)}</span></div>
        <div class="swatches">
          ${PALETTES.map((p, i) => `<div class="sw ${i === state.paletteIndex ? 'on' : ''}" data-a="palette" data-v="${i}" title="${esc(p.name)}" style="background:${p.duotone ? `linear-gradient(135deg, ${p.preview} 50%, #08080A 50%)` : p.preview}"></div>`).join('')}
          <div class="sw custom ${state.paletteIndex < 0 ? 'on' : ''}" data-a="palette" data-v="-1" title="Custom colour"></div>
        </div>
        ${hint('Split swatches are two-tone palettes: one colour plus black.')}
      </div>
      ${state.paletteIndex < 0 ? `<div class="field"><div class="label">Custom colour <span class="val" id="hue-val">${state.customHue}°</span></div>
        <input type="range" class="hue" data-a="hue" min="0" max="360" step="1" value="${state.customHue}">
        ${hint('Builds a matching palette around the colour you pick.')}</div>` : ''}
      <div class="field"><div class="label">Colour drift</div>
        <div class="seg">${segBtn('drift', '0', 'Off', !state.autoDrift)}${segBtn('drift', '1', 'On', state.autoDrift)}</div>
        ${hint(state.autoDrift ? 'Slowly rotates every colour of the palette around the colour wheel.' : 'Colours stay exactly as the palette defines them.')}
      </div>
      ${state.autoDrift ? `<div class="field"><div class="label">Drift speed</div>
        <input type="range" data-a="period" min="${MIN_DRIFT_PERIOD_S}" max="${MAX_DRIFT_PERIOD_S}" step="10" value="${MAX_DRIFT_PERIOD_S + MIN_DRIFT_PERIOD_S - state.driftPeriod}">
        ${ends('Slow', 'Fast')}
        ${hint(cycleText(state.driftPeriod), 'drift-val')}</div>` : ''}
    </div>
    <div class="sec">
      <div class="title">Feel</div>
      <div class="field"><div class="label">Responsiveness</div>
        <input type="range" data-a="resp" min="0" max="100" value="${Math.round(state.responsiveness * 100)}">
        ${ends('Smooth', 'Punchy')}
        ${hint('How hard the visuals move on each beat. Smooth flows gently; punchy snaps and jumps on every hit. Brightness stays steady either way.')}
      </div>
    </div>
    <div class="sec">
      <div class="title">Quality</div>
      <div class="seg">${(['low', 'medium', 'high', 'auto'] as QualityPreset[]).map((q) => segBtn('quality', q, q, state.quality === q)).join('')}</div>
      ${hint(QUALITY_HINTS[state.quality])}
      <div class="field"><div class="label">Frame rate</div>
        <div class="seg">${FPS_CAPS.map((n) => segBtn('fps', String(n), n === 0 ? 'max' : String(n), state.fpsCap === n)).join('')}</div>
        ${hint(state.fpsCap === 0 ? 'Matches your display’s refresh rate. Smoothest on fast screens, but works the graphics card hardest.'
          : state.fpsCap < 60 ? 'Caps at 30 fps to ease the load on slower computers. Motion is less smooth.'
          : state.fpsCap === 60 ? 'Smooth on any screen. Raise it on high-refresh displays if your graphics card keeps up; lower it if it stutters.'
          : `Caps at ${state.fpsCap} fps for high-refresh displays. Needs a capable graphics card; pair with Auto quality if it stutters.`)}
      </div>
    </div>
    ${audio}
    <div class="sec">
      <div class="title">Keys</div>
      <div class="keys mono">
        <div><kbd>F</kbd>Fullscreen</div><div><kbd>H</kbd>Hide all controls</div><div><kbd>D</kbd>Show audio signals</div>
        <div><kbd>S</kbd>Next style</div><div><kbd>V</kbd>Depth / flat</div><div><kbd>C</kbd>Next camera preset</div>
        <div><kbd>1</kbd>–<kbd>0</kbd>Palette</div>
      </div>
    </div>
    <div class="sec hint">sonora 0.2.0 — a visual instrument for whatever's playing.</div>
  `;
}

function deviceOptions(): string {
  const opts = [`<option value="default">Whatever Windows is playing on (recommended)</option>`];
  let seen = state.audioDevice === 'default';
  for (const d of state.audioDevices) {
    if (d.id === state.audioDevice) seen = true;
    opts.push(`<option value="${esc(d.id)}" ${d.id === state.audioDevice ? 'selected' : ''}>${esc(d.name)}</option>`);
  }
  if (!seen) opts.push(`<option value="${esc(state.audioDevice)}" selected>${esc(state.audioDevice)} (unavailable)</option>`);
  return opts.join('');
}

function onClick(e: MouseEvent): void {
  const el = (e.target as HTMLElement).closest<HTMLElement>('[data-a]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const a = el.dataset.a;
  const v = el.dataset.v ?? '';
  switch (a) {
    case 'style': if (v !== state.style) cb.onStyleChange(v as StyleId); return;
    case 'variant': state.variant = v; cb.onVariantChange(v); break;
    case 'depth': state.depth = v === '1'; cb.onDepthChange(state.depth); break;
    case 'light': state.lightMode = v as LightMode; cb.onLightModeChange(state.lightMode); break;
    case 'preset': {
      const p = CAMERA_PRESETS.find((x) => x.id === v);
      if (!p) return;
      state.camera = { ...p.view };
      cb.onCameraChange(state.camera);
      break;
    }
    case 'palette': {
      const idx = Number(v);
      state.paletteIndex = idx;
      if (idx < 0) cb.onCustomHueChange(state.customHue);
      cb.onPaletteChange(idx);
      break;
    }
    case 'drift': state.autoDrift = v === '1'; cb.onAutoDriftChange(state.autoDrift); break;
    case 'quality': state.quality = v as QualityPreset; cb.onQualityChange(state.quality); break;
    case 'fps': state.fpsCap = Number(v); cb.onFpsCapChange(state.fpsCap); break;
    case 'audio-source': setOpen(false); cb.onOpenAudioSource?.(); return;
    default: return;
  }
  render();
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const a = el.dataset.a;
  const setText = (id: string, t: string): void => { const n = panel?.querySelector(`#${id}`); if (n) n.textContent = t; };
  const n = Number(el.value);
  if (a === 'rings') { state.ringCount = n; setText('ring-val', el.value); cb.onRingCountChange(n); }
  else if (a === 'hue') { state.customHue = n; setText('hue-val', `${el.value}°`); cb.onCustomHueChange(n); }
  else if (a === 'period') {
    // Slider runs slow → fast, so invert to a period.
    state.driftPeriod = MAX_DRIFT_PERIOD_S + MIN_DRIFT_PERIOD_S - n;
    setText('drift-val', cycleText(state.driftPeriod));
    cb.onDriftPeriodChange(state.driftPeriod);
  } else if (a === 'resp') { state.responsiveness = n / 100; cb.onResponsivenessChange(state.responsiveness); }
  else if (a === 'cam-height' || a === 'cam-tilt' || a === 'cam-curve') {
    const key = a === 'cam-height' ? 'height' : a === 'cam-tilt' ? 'tilt' : 'curve';
    state.camera = { ...state.camera, [key]: n / 100 };
    cb.onCameraChange(state.camera);
  } else if (a === 'classic' && el instanceof HTMLInputElement) {
    state.showClassic = el.checked;
    cb.onShowClassicChange(el.checked);
    render();
  } else if (a === 'device') { state.audioDevice = el.value || 'default'; cb.onAudioDeviceChange?.(state.audioDevice); }
}

function setOpen(open: boolean): void {
  panel?.classList.toggle('open', open);
  btn?.classList.toggle('active', open);
}

export function initSettingsPanel(callbacks: SettingsCallbacks, initial: SettingsState): void {
  if (panel) return;
  cb = callbacks;
  state = { ...initial };
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  btn = document.createElement('button');
  btn.id = 'settings-btn';
  btn.className = 'sonora-fadeable';
  btn.title = 'Settings';
  btn.innerHTML = GEAR;
  btn.addEventListener('click', () => setOpen(!panel?.classList.contains('open')));
  document.body.appendChild(btn);

  panel = document.createElement('div');
  panel.id = 'settings-panel';
  panel.addEventListener('click', onClick);
  panel.addEventListener('input', onInput);
  panel.addEventListener('change', (e) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'checkbox') onInput(e);
    // Re-render after a camera slider is released so the preset highlight updates.
    if ((el as HTMLInputElement).dataset?.a?.startsWith('cam-')) render();
  });
  document.body.appendChild(panel);
  render();

  document.addEventListener('click', (e) => {
    if (!panel?.classList.contains('open')) return;
    // composedPath() still holds the panel when a click re-rendered (and
    // detached) its own target.
    const path = e.composedPath();
    if ((panel && path.includes(panel)) || (btn && path.includes(btn))) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel?.classList.contains('open')) setOpen(false);
  });
}

/** Push external changes (keyboard shortcuts, mouse, other widgets) into the panel. */
export function syncSettings(patch: Partial<SettingsState>): void {
  if (!panel) return;
  state = { ...state, ...patch };
  // Avoid re-rendering under an active slider drag.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'range' && panel.contains(active)) return;
  render();
}

/** Live input level (0–1) for the Audio section meter. Cheap: no re-render. */
export function setAudioLevel(level: number): void {
  const el = panel?.classList.contains('open') ? panel.querySelector<HTMLElement>('#audio-level') : null;
  if (el) el.style.width = `${Math.round(Math.min(1, level) * 100)}%`;
}
