/**
 * Settings panel — gear button bottom-right opens a side panel:
 *   Visual       style (classic group hidden behind a toggle), variant,
 *                Depth/Flat view, background (auto/dark/light), rings (Aura)
 *   Colour       palette swatches, custom hue, Auto Drift + cycle length
 *   Feel         responsiveness
 *   Performance  Low / Medium / High / Auto
 *   Audio        source device (desktop only)
 *
 * Shared by the desktop app and the web dev page. Brand rules: Night/Bone
 * only, mono uppercase labels, square corners, 1 px Bone/12% dividers.
 */

import { MAX_DRIFT_PERIOD_S, MIN_DRIFT_PERIOD_S, PALETTES } from '../engine/color-engine';
import type { QualityPreset } from '../engine/quality';
import { getStyle, visibleStyles } from '../styles/registry';
import type { LightMode, StyleId } from '../styles/visual-style';
import type { DeviceInfo } from '../ipc/audio-device';

export type { StyleId, QualityPreset };

const RING_COUNT_MIN = 2;
const RING_COUNT_MAX = 10;

export interface SettingsCallbacks {
  onStyleChange: (style: StyleId) => void;
  onVariantChange: (variant: string) => void;
  onDepthChange: (on: boolean) => void;
  onLightModeChange: (mode: LightMode) => void;
  onShowClassicChange: (on: boolean) => void;
  onRingCountChange: (n: number) => void;
  /** -1 means custom (use the custom hue). */
  onPaletteChange: (paletteIndex: number) => void;
  onCustomHueChange: (hue: number) => void;
  onAutoDriftChange: (on: boolean) => void;
  onDriftPeriodChange: (seconds: number) => void;
  onResponsivenessChange: (t: number) => void;
  onQualityChange: (preset: QualityPreset) => void;
  /** Omit to hide the audio section (web build). */
  onAudioDeviceChange?: (id: string) => void;
}

export interface SettingsState {
  style: StyleId;
  variant: string;
  depth: boolean;
  lightMode: LightMode;
  showClassic: boolean;
  ringCount: number;
  paletteIndex: number;
  customHue: number;
  autoDrift: boolean;
  driftPeriod: number;
  responsiveness: number;
  quality: QualityPreset;
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
  position: fixed; top: 0; right: 0; bottom: 0; width: 304px;
  background: rgba(8, 8, 10, 0.9); border-left: 1px solid rgba(236, 231, 223, 0.12);
  color: rgba(236, 231, 223, 0.86); z-index: 998; padding: 20px 20px 72px;
  font-family: 'Inter', 'Segoe UI', system-ui, sans-serif; font-size: 12px;
  transform: translateX(320px); opacity: 0; pointer-events: none;
  transition: transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1), opacity 0.25s;
  overflow-y: auto; scrollbar-width: thin; scrollbar-color: rgba(236,231,223,0.2) transparent;
}
#settings-panel.open { transform: none; opacity: 1; pointer-events: auto; }
#settings-panel .sec { padding: 16px 0; border-top: 1px solid rgba(236, 231, 223, 0.12); }
#settings-panel .sec:first-child { border-top: 0; padding-top: 0; }
#settings-panel .mono, #settings-panel .title, #settings-panel .label, #settings-panel button,
#settings-panel select, #settings-panel .val {
  font-family: 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace;
  text-transform: uppercase; letter-spacing: 0.12em; font-size: 10px;
}
#settings-panel .title { color: rgba(236, 231, 223, 0.38); margin-bottom: 12px; }
#settings-panel .field { margin-bottom: 12px; }
#settings-panel .field:last-child { margin-bottom: 0; }
#settings-panel .label { color: rgba(236, 231, 223, 0.6); margin-bottom: 6px; display: flex; justify-content: space-between; }
#settings-panel .val { color: rgba(236, 231, 223, 0.9); }
#settings-panel .seg { display: flex; flex-wrap: wrap; gap: 0; border: 1px solid rgba(236, 231, 223, 0.12); }
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
#settings-panel .check { display: flex; align-items: center; gap: 8px; cursor: pointer; color: rgba(236,231,223,0.6); }
#settings-panel .check input { accent-color: #ECE7DF; }
#settings-panel select { width: 100%; background: #08080A; color: #ECE7DF; border: 1px solid rgba(236,231,223,0.18); padding: 6px; }
#settings-panel .small { font-size: 11px; color: rgba(236, 231, 223, 0.42); margin-top: 6px; text-transform: none; letter-spacing: 0; }
#settings-panel kbd { font-family: inherit; border: 1px solid rgba(236,231,223,0.2); padding: 0 4px; margin-right: 6px; }
#settings-panel .keys { line-height: 1.9; color: rgba(236,231,223,0.55); }
`;

const GEAR = `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>`;

let state: SettingsState;
let cb: SettingsCallbacks;
let panel: HTMLDivElement | null = null;
let btn: HTMLButtonElement | null = null;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const segBtn = (action: string, value: string, label: string, on: boolean): string =>
  `<button data-a="${action}" data-v="${esc(value)}" class="${on ? 'on' : ''}">${esc(label)}</button>`;

function render(): void {
  if (!panel) return;
  const desc = getStyle(state.style);
  const styles = visibleStyles(state.showClassic);
  const palName = state.paletteIndex >= 0 ? PALETTES[state.paletteIndex]?.name ?? '' : 'Custom';
  const audio = cb.onAudioDeviceChange ? `
    <div class="sec">
      <div class="title">Audio</div>
      <div class="field"><div class="label">Source</div>
        <select data-a="device">${deviceOptions()}</select>
        <div class="small">${state.currentAudioDeviceName ? `Capturing: ${esc(state.currentAudioDeviceName)}` : 'No audio device'}</div>
      </div>
    </div>` : '';

  panel.innerHTML = `
    <div class="sec">
      <div class="title">Visual</div>
      <div class="field"><div class="label">Style</div>
        <div class="seg">${styles.map((s) => segBtn('style', s.id, s.label, s.id === state.style)).join('')}</div>
      </div>
      <div class="field"><div class="label">Look</div>
        <div class="seg">${desc.variants.map((v) => segBtn('variant', v.id, v.label, v.id === state.variant)).join('')}</div>
      </div>
      ${desc.supportsDepth ? `<div class="field"><div class="label">View</div>
        <div class="seg">${segBtn('depth', '1', 'Depth', state.depth)}${segBtn('depth', '0', 'Flat', !state.depth)}</div></div>` : ''}
      ${desc.supportsLight ? `<div class="field"><div class="label">Background</div>
        <div class="seg">${(['auto', 'dark', 'light'] as LightMode[]).map((m) => segBtn('light', m, m, state.lightMode === m)).join('')}</div></div>` : ''}
      ${desc.id === 'aura' ? `<div class="field"><div class="label">Rings <span class="val" id="ring-val">${state.ringCount}</span></div>
        <input type="range" data-a="rings" min="${RING_COUNT_MIN}" max="${RING_COUNT_MAX}" step="1" value="${state.ringCount}"></div>` : ''}
      <label class="check mono"><input type="checkbox" data-a="classic" ${state.showClassic ? 'checked' : ''}> Show classic styles</label>
    </div>
    <div class="sec">
      <div class="title">Colour</div>
      <div class="field"><div class="label">Palette <span class="val">${esc(palName)}</span></div>
        <div class="swatches">
          ${PALETTES.map((p, i) => `<div class="sw ${i === state.paletteIndex ? 'on' : ''}" data-a="palette" data-v="${i}" title="${esc(p.name)}" style="background:${p.duotone ? `linear-gradient(135deg, ${p.preview} 50%, #08080A 50%)` : p.preview}"></div>`).join('')}
          <div class="sw custom ${state.paletteIndex < 0 ? 'on' : ''}" data-a="palette" data-v="-1" title="Custom"></div>
        </div>
      </div>
      ${state.paletteIndex < 0 ? `<div class="field"><div class="label">Hue <span class="val" id="hue-val">${state.customHue}°</span></div>
        <input type="range" class="hue" data-a="hue" min="0" max="360" step="1" value="${state.customHue}"></div>` : ''}
      <div class="field"><div class="label">Auto drift</div>
        <div class="seg">${segBtn('drift', '1', 'On', state.autoDrift)}${segBtn('drift', '0', 'Off', !state.autoDrift)}</div>
      </div>
      ${state.autoDrift ? `<div class="field"><div class="label">Cycle <span class="val" id="drift-val">${(state.driftPeriod / 60).toFixed(1)} min</span></div>
        <input type="range" data-a="period" min="${MIN_DRIFT_PERIOD_S}" max="${MAX_DRIFT_PERIOD_S}" step="10" value="${state.driftPeriod}"></div>` : ''}
    </div>
    <div class="sec">
      <div class="title">Feel</div>
      <div class="field"><div class="label">Responsiveness <span class="val">smooth — punchy</span></div>
        <input type="range" data-a="resp" min="0" max="100" value="${Math.round(state.responsiveness * 100)}"></div>
    </div>
    <div class="sec">
      <div class="title">Performance</div>
      <div class="seg">${(['low', 'medium', 'high', 'auto'] as QualityPreset[]).map((q) => segBtn('quality', q, q, state.quality === q)).join('')}</div>
    </div>
    ${audio}
    <div class="sec">
      <div class="title">Keys</div>
      <div class="keys mono">
        <div><kbd>F</kbd>Fullscreen</div><div><kbd>H</kbd>Clean mode</div><div><kbd>D</kbd>Debug overlay</div>
        <div><kbd>S</kbd>Next style</div><div><kbd>V</kbd>Depth / flat</div><div><kbd>1</kbd>–<kbd>0</kbd>Palette</div>
      </div>
    </div>
    <div class="sec small">sonora 0.2.0 — a visual instrument for whatever's playing.</div>
  `;
}

function deviceOptions(): string {
  const opts = [`<option value="default">Default (auto-switch)</option>`];
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
    case 'palette': {
      const idx = Number(v);
      state.paletteIndex = idx;
      if (idx < 0) cb.onCustomHueChange(state.customHue);
      cb.onPaletteChange(idx);
      break;
    }
    case 'drift': state.autoDrift = v === '1'; cb.onAutoDriftChange(state.autoDrift); break;
    case 'quality': state.quality = v as QualityPreset; cb.onQualityChange(state.quality); break;
    default: return;
  }
  render();
}

function onInput(e: Event): void {
  const el = e.target as HTMLInputElement | HTMLSelectElement;
  const a = el.dataset.a;
  const setText = (id: string, t: string): void => { const n = panel?.querySelector(`#${id}`); if (n) n.textContent = t; };
  if (a === 'rings') { state.ringCount = Number(el.value); setText('ring-val', el.value); cb.onRingCountChange(state.ringCount); }
  else if (a === 'hue') { state.customHue = Number(el.value); setText('hue-val', `${el.value}°`); cb.onCustomHueChange(state.customHue); }
  else if (a === 'period') { state.driftPeriod = Number(el.value); setText('drift-val', `${(state.driftPeriod / 60).toFixed(1)} min`); cb.onDriftPeriodChange(state.driftPeriod); }
  else if (a === 'resp') { state.responsiveness = Number(el.value) / 100; cb.onResponsivenessChange(state.responsiveness); }
  else if (a === 'classic' && el instanceof HTMLInputElement) {
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
  });
  document.body.appendChild(panel);
  render();

  document.addEventListener('click', (e) => {
    if (!panel?.classList.contains('open')) return;
    const t = e.target as Node;
    if (panel.contains(t) || btn?.contains(t)) return;
    setOpen(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && panel?.classList.contains('open')) setOpen(false);
  });
}

/** Push external changes (keyboard shortcuts, other widgets) into the panel. */
export function syncSettings(patch: Partial<SettingsState>): void {
  if (!panel) return;
  state = { ...state, ...patch };
  // Avoid re-rendering under an active slider drag.
  const active = document.activeElement;
  if (active instanceof HTMLInputElement && active.type === 'range' && panel.contains(active)) return;
  render();
}
