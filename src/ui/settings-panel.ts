/**
 * Settings panel — gear button in bottom-right opens a sliding sidebar with:
 *  - Visual:      Mode (grouped by category) / Variant / Ring count (Aura)
 *  - Color:       Palette swatches + custom hue
 *  - Feel:        Responsiveness slider
 *  - Performance: Quality preset
 *  - System:      Audio source dropdown + currently-active device name
 *  - Shortcuts:   Keyboard reference
 *  - About:       Version + tagline
 */

import { PALETTES } from '../engine/color-engine';
import { STYLE_VARIANTS } from '../styles/visual-style';

import type { StyleId } from '../styles/visual-style';
import type { DeviceInfo } from '../ipc/audio-device';

export type { StyleId };
export type QualityPreset = 'low' | 'medium' | 'high';

const RING_COUNT_MIN = 2;
const RING_COUNT_MAX = 10;
const RING_COUNT_DEFAULT = 3;

/** Mode → category. Pure UI grouping; the engine doesn't care. */
const MODE_CATEGORIES: { label: string; styles: { id: StyleId; label: string }[] }[] = [
  { label: 'Artistic',  styles: [{ id: 'flow-ink', label: 'Flow Ink' }] },
  { label: 'Geometric', styles: [{ id: 'aura', label: 'Aura' }, { id: 'halo', label: 'Halo' }] },
];

export interface SettingsCallbacks {
  onResponsivenessChange: (t: number) => void;
  onQualityChange: (preset: QualityPreset) => void;
  onStyleChange: (style: StyleId) => void;
  onVariantChange: (variant: string) => void;
  onRingCountChange: (n: number) => void;
  /** Called when palette index changes. -1 means custom (use customHue). */
  onPaletteChange: (paletteIndex: number) => void;
  /** Called when the user drags the custom-hue slider. */
  onCustomHueChange: (hue: number) => void;
  /** Called when the user picks a different audio source. `'default'` =
   *  follow system default; any other id pins to that device. */
  onAudioDeviceChange: (id: string) => void;
}

/** Initial values applied to the panel UI on construction. */
export interface SettingsInitial {
  style: StyleId;
  variant?: string;
  responsiveness: number;
  quality: QualityPreset;
  ringCount: number;
  paletteIndex: number;
  customHue: number;
  /** `'default'` (auto-switch) or a pinned device id. */
  audioDevice: string;
  /** Devices available right now — populates the dropdown. */
  audioDevices: DeviceInfo[];
  /** Display name of the currently capturing device. Empty if none. */
  currentAudioDeviceName: string;
}

const PANEL_CSS = `
#settings-btn {
  position: fixed;
  bottom: 16px;
  right: 104px;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: rgba(8, 8, 16, 0.75);
  border: 2px solid rgba(255, 255, 255, 0.15);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  cursor: pointer;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(8px);
  transition: transform 0.2s, border-color 0.2s, color 0.2s;
}
#settings-btn:hover {
  transform: scale(1.08);
  border-color: rgba(255, 255, 255, 0.5);
  color: rgba(255, 255, 255, 0.95);
}
#settings-btn.active {
  border-color: rgba(255, 255, 255, 0.6);
  color: #fff;
}
#settings-btn svg {
  width: 16px;
  height: 16px;
  stroke: currentColor;
  fill: none;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

#settings-panel {
  position: fixed;
  top: 16px;
  right: 16px;
  bottom: 104px;
  width: 320px;
  background: rgba(10, 10, 20, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.55);
  padding: 18px 18px 16px;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: rgba(255, 255, 255, 0.85);
  z-index: 998;
  opacity: 0;
  transform: translateX(360px);
  pointer-events: none;
  transition: opacity 0.28s cubic-bezier(0.2, 0.8, 0.2, 1),
              transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255,255,255,0.2) transparent;
}
@supports (backdrop-filter: blur(20px)) or (-webkit-backdrop-filter: blur(20px)) {
  #settings-panel {
    background: rgba(10, 10, 20, 0.55);
    backdrop-filter: blur(20px) saturate(140%);
    -webkit-backdrop-filter: blur(20px) saturate(140%);
  }
}
#settings-panel::-webkit-scrollbar { width: 6px; }
#settings-panel::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 3px; }
#settings-panel button:focus,
#settings-panel input:focus,
#settings-btn:focus {
  outline: none;
}
#settings-panel.open {
  opacity: 1;
  transform: translateX(0);
  pointer-events: auto;
}

#settings-panel .section {
  padding: 14px 0 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}
#settings-panel .section:first-child {
  padding-top: 4px;
  border-top: 0;
}
#settings-panel .section:last-child {
  padding-bottom: 0;
}
#settings-panel .section-title {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 1.6px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.42);
  margin-bottom: 12px;
}
#settings-panel .field {
  margin-bottom: 12px;
}
#settings-panel .field:last-child {
  margin-bottom: 0;
}
#settings-panel .field-label {
  font-size: 11px;
  letter-spacing: 0.4px;
  color: rgba(255, 255, 255, 0.55);
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
}
#settings-panel .field-label .value {
  color: rgba(255, 255, 255, 0.85);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
}

#settings-panel .category {
  margin-bottom: 10px;
}
#settings-panel .category:last-child {
  margin-bottom: 0;
}
#settings-panel .category-label {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.4px;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.32);
  margin-bottom: 5px;
  padding-left: 2px;
}

#settings-panel .slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
#settings-panel .slider-labels {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 4px;
}
#settings-panel input[type="range"] {
  flex: 1;
  -webkit-appearance: none;
  appearance: none;
  height: 3px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 2px;
  outline: none;
  cursor: pointer;
}
#settings-panel input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  border: 0;
}
#settings-panel input[type="range"]::-moz-range-thumb {
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  cursor: pointer;
  border: 0;
}
#settings-panel .hue-slider {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 10px;
  border-radius: 5px;
  background: linear-gradient(to right,
    hsl(0,   75%, 55%),
    hsl(60,  75%, 55%),
    hsl(120, 75%, 55%),
    hsl(180, 75%, 55%),
    hsl(240, 75%, 55%),
    hsl(300, 75%, 55%),
    hsl(360, 75%, 55%)
  );
  border: 1px solid rgba(255, 255, 255, 0.15);
  cursor: pointer;
}
#settings-panel .hue-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
#settings-panel .hue-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}

#settings-panel .segmented {
  display: flex;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
}
#settings-panel .segmented button {
  flex: 1;
  background: transparent;
  border: 0;
  padding: 6px 0;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  border-radius: 6px;
  font-family: inherit;
  transition: background 0.15s, color 0.15s;
}
#settings-panel .segmented button:hover {
  color: rgba(255, 255, 255, 0.85);
}
#settings-panel .segmented button.active {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}

#settings-panel .swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
#settings-panel .swatch {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s, transform 0.12s;
  flex-shrink: 0;
}
#settings-panel .swatch:hover {
  transform: scale(1.12);
}
#settings-panel .swatch.active {
  border-color: rgba(255, 255, 255, 0.85);
}
#settings-panel .swatch.custom {
  background: conic-gradient(from 0deg, #ff0040, #ffd000, #00ff66, #00ddff, #3355ff, #d946ef, #ff0040);
}
#settings-panel .hue-row {
  margin-top: 10px;
  display: none;
}
#settings-panel.custom-open .hue-row {
  display: block;
}

#settings-panel .kv {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.55);
  display: flex;
  justify-content: space-between;
  margin-bottom: 4px;
}
#settings-panel .kv span:last-child {
  color: rgba(255, 255, 255, 0.85);
}

#settings-panel select {
  width: 100%;
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 6px;
  padding: 6px 8px;
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path d='M0 0l5 6 5-6z' fill='%23ffffff' opacity='0.55'/></svg>");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 26px;
}
#settings-panel select:hover {
  border-color: rgba(255, 255, 255, 0.25);
}
#settings-panel select option {
  background: #14141c;
  color: #fff;
}
#settings-panel .device-current {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.42);
  margin-top: 6px;
  letter-spacing: 0.2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

#settings-panel .shortcuts {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  line-height: 1.7;
}
#settings-panel .shortcuts kbd {
  display: inline-block;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 4px;
  padding: 1px 5px;
  font-family: 'Consolas', monospace;
  font-size: 10px;
  color: rgba(255, 255, 255, 0.85);
  margin-right: 4px;
}

#settings-panel .about {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  line-height: 1.5;
}
#settings-panel .about-title {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  margin-bottom: 3px;
}
`;

const ICON_GEAR = `
<svg viewBox="0 0 24 24">
  <circle cx="12" cy="12" r="3"/>
  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
</svg>
`;

let btnEl: HTMLButtonElement | null = null;
let panelEl: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;

let responsivenessValue = 0.6;
let qualityValue: QualityPreset = 'medium';
let styleValue: StyleId = 'aura';
let ringCountValue = RING_COUNT_DEFAULT;
let paletteIndexValue = 0;
let customHueValue = 200;
let audioDeviceValue = 'default';
let audioDevicesList: DeviceInfo[] = [];
let currentAudioDeviceName = '';

/** Build the variant buttons for the given style and mark `preferredVariant`
 *  active. Does NOT fire `onVariantChange` — variant lifecycle is owned by
 *  the caller, who decides which variant should be active for each style
 *  (e.g. last saved variant per mode). */
function populateVariantUI(
  panel: HTMLDivElement,
  style: StyleId,
  preferredVariant?: string,
): void {
  const field = panel.querySelector<HTMLDivElement>('#variant-field')!;
  const seg = panel.querySelector<HTMLDivElement>('#variant-seg')!;
  const variants = STYLE_VARIANTS[style];

  if (!variants || variants.length === 0) {
    field.style.display = 'none';
    return;
  }

  field.style.display = '';
  const selected = preferredVariant && variants.some((v) => v.id === preferredVariant)
    ? preferredVariant
    : variants[0].id;
  seg.innerHTML = variants
    .map((v) => `<button data-v="${v.id}"${v.id === selected ? ' class="active"' : ''}>${v.label}</button>`)
    .join('');
}

function updateRingCountVisibility(panel: HTMLDivElement, style: StyleId): void {
  const field = panel.querySelector<HTMLDivElement>('#ring-count-field')!;
  field.style.display = style === 'aura' ? '' : 'none';
}

function setOpen(open: boolean): void {
  if (!panelEl || !btnEl) return;
  panelEl.classList.toggle('open', open);
  btnEl.classList.toggle('active', open);
}

function buildModeButtonsHTML(active: StyleId): string {
  return MODE_CATEGORIES
    .map((cat) => `
      <div class="category">
        <div class="category-label">${cat.label}</div>
        <div class="segmented" data-cat="${cat.label.toLowerCase()}">
          ${cat.styles.map((s) =>
            `<button data-s="${s.id}"${s.id === active ? ' class="active"' : ''}>${s.label}</button>`
          ).join('')}
        </div>
      </div>
    `).join('');
}

function buildPanel(callbacks: SettingsCallbacks, initialVariant?: string): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'settings-panel';

  panel.innerHTML = `
    <div class="section">
      <div class="section-title">Visual</div>
      <div class="field">
        <div class="field-label"><span>Mode</span></div>
        <div id="mode-groups">${buildModeButtonsHTML(styleValue)}</div>
      </div>
      <div class="field" id="variant-field" style="display:none">
        <div class="field-label"><span>Look</span></div>
        <div class="segmented" id="variant-seg"></div>
      </div>
      <div class="field" id="ring-count-field">
        <div class="field-label"><span>Rings</span><span class="value" id="ring-count-value">${ringCountValue}</span></div>
        <div class="slider-row">
          <input type="range" id="ring-count-slider"
            min="${RING_COUNT_MIN}" max="${RING_COUNT_MAX}" step="1"
            value="${ringCountValue}"/>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Color</div>
      <div class="field">
        <div class="field-label"><span>Palette</span><span class="value" id="palette-name">${paletteIndexValue >= 0 ? PALETTES[paletteIndexValue]?.name ?? '' : 'Custom'}</span></div>
        <div class="swatch-row" id="palette-swatches"></div>
      </div>
      <div class="field hue-row" id="hue-row">
        <div class="field-label"><span>Hue</span><span class="value" id="hue-value">${customHueValue}°</span></div>
        <input type="range" id="hue-slider" class="hue-slider" min="0" max="360" step="1" value="${customHueValue}"/>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Feel</div>
      <div class="field">
        <div class="field-label"><span>Responsiveness</span></div>
        <div class="slider-row">
          <input type="range" id="resp-slider" min="0" max="100" value="${Math.round(responsivenessValue * 100)}"/>
        </div>
        <div class="slider-labels"><span>Smooth</span><span>Punchy</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Performance</div>
      <div class="segmented" id="quality-seg">
        <button data-q="low"${qualityValue === 'low' ? ' class="active"' : ''}>Low</button>
        <button data-q="medium"${qualityValue === 'medium' ? ' class="active"' : ''}>Medium</button>
        <button data-q="high"${qualityValue === 'high' ? ' class="active"' : ''}>High</button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">System</div>
      <div class="field">
        <div class="field-label"><span>Audio source</span></div>
        <select id="audio-device-select"></select>
        <div class="device-current" id="audio-device-current"></div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Shortcuts</div>
      <div class="shortcuts">
        <div><kbd>F11</kbd>/<kbd>F</kbd> Fullscreen</div>
        <div><kbd>H</kbd> Clean mode (hide UI)</div>
        <div><kbd>D</kbd> Debug overlay</div>
        <div><kbd>S</kbd> Cycle visual mode</div>
        <div><kbd>1</kbd>–<kbd>${PALETTES.length}</kbd> Palette</div>
        <div><kbd>Esc</kbd> Exit fullscreen / clean mode</div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">About</div>
      <div class="about">
        <div class="about-title">Sonora 0.1.0</div>
        Real-time generative music visualizer.<br/>Renders what your system is playing.
      </div>
    </div>
  `;

  // ── Responsiveness slider ──
  const respSlider = panel.querySelector<HTMLInputElement>('#resp-slider')!;
  respSlider.addEventListener('input', () => {
    responsivenessValue = parseInt(respSlider.value, 10) / 100;
    callbacks.onResponsivenessChange(responsivenessValue);
  });

  // ── Quality preset ──
  const qualitySeg = panel.querySelector<HTMLDivElement>('#quality-seg')!;
  qualitySeg.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') return;
    const q = target.dataset.q as QualityPreset | undefined;
    if (!q) return;
    qualityValue = q;
    qualitySeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === target));
    callbacks.onQualityChange(q);
  });

  // ── Mode category buttons (delegated to all .segmented under #mode-groups) ──
  const modeGroups = panel.querySelector<HTMLDivElement>('#mode-groups')!;
  modeGroups.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') return;
    const s = target.dataset.s as StyleId | undefined;
    if (!s || s === styleValue) return;
    styleValue = s;
    modeGroups.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.s === s));
    callbacks.onStyleChange(s);
    populateVariantUI(panel, s);
    updateRingCountVisibility(panel, s);
  });

  // ── Variant segmented ──
  const variantSeg = panel.querySelector<HTMLDivElement>('#variant-seg')!;
  variantSeg.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'BUTTON') return;
    const v = target.dataset.v;
    if (!v) return;
    variantSeg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === target));
    callbacks.onVariantChange(v);
  });

  // ── Ring count slider ──
  const ringSlider = panel.querySelector<HTMLInputElement>('#ring-count-slider')!;
  const ringValueEl = panel.querySelector<HTMLSpanElement>('#ring-count-value')!;
  ringSlider.addEventListener('input', () => {
    ringCountValue = parseInt(ringSlider.value, 10);
    ringValueEl.textContent = String(ringCountValue);
    callbacks.onRingCountChange(ringCountValue);
  });

  // ── Palette swatches + custom hue ──
  const swatchRow = panel.querySelector<HTMLDivElement>('#palette-swatches')!;
  const paletteNameEl = panel.querySelector<HTMLSpanElement>('#palette-name')!;
  const hueSlider = panel.querySelector<HTMLInputElement>('#hue-slider')!;
  const hueValueEl = panel.querySelector<HTMLSpanElement>('#hue-value')!;

  for (let i = 0; i < PALETTES.length; i++) {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i === paletteIndexValue ? ' active' : '');
    sw.style.background = PALETTES[i].preview;
    sw.title = PALETTES[i].name;
    sw.dataset.idx = String(i);
    sw.addEventListener('click', () => {
      paletteIndexValue = i;
      panel.classList.remove('custom-open');
      paletteNameEl.textContent = PALETTES[i].name;
      swatchRow.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === sw));
      callbacks.onPaletteChange(i);
    });
    swatchRow.appendChild(sw);
  }
  const customSw = document.createElement('div');
  customSw.className = 'swatch custom' + (paletteIndexValue < 0 ? ' active' : '');
  customSw.title = 'Custom';
  customSw.dataset.idx = '-1';
  customSw.addEventListener('click', () => {
    paletteIndexValue = -1;
    panel.classList.add('custom-open');
    paletteNameEl.textContent = 'Custom';
    swatchRow.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('active', s === customSw));
    callbacks.onPaletteChange(-1);
  });
  swatchRow.appendChild(customSw);

  if (paletteIndexValue < 0) panel.classList.add('custom-open');

  hueSlider.addEventListener('input', () => {
    customHueValue = parseInt(hueSlider.value, 10);
    hueValueEl.textContent = `${customHueValue}°`;
    callbacks.onCustomHueChange(customHueValue);
  });

  // ── Audio device select ──
  const deviceSelect = panel.querySelector<HTMLSelectElement>('#audio-device-select')!;
  populateDeviceSelectIn(panel);
  updateCurrentDeviceLabelIn(panel);
  deviceSelect.addEventListener('change', () => {
    audioDeviceValue = deviceSelect.value || 'default';
    callbacks.onAudioDeviceChange(audioDeviceValue);
  });

  // Initialize variant UI for the starting style with the saved variant
  populateVariantUI(panel, styleValue, initialVariant);
  updateRingCountVisibility(panel, styleValue);

  return panel;
}

/** Build the <option> list. "Default (auto-switch)" is always first; the
 *  pinned id is shown even if it's not currently in the device list (e.g.
 *  because the device is unplugged) so the user sees what they pinned. */
function populateDeviceSelectIn(panel: HTMLDivElement): void {
  const sel = panel.querySelector<HTMLSelectElement>('#audio-device-select');
  if (!sel) return;
  const opts: string[] = [`<option value="default">Default (auto-switch)</option>`];
  let pinnedSeen = audioDeviceValue === 'default';
  for (const d of audioDevicesList) {
    const selected = d.id === audioDeviceValue ? ' selected' : '';
    if (d.id === audioDeviceValue) pinnedSeen = true;
    opts.push(`<option value="${escapeHtml(d.id)}"${selected}>${escapeHtml(d.name)}</option>`);
  }
  if (!pinnedSeen) {
    opts.push(
      `<option value="${escapeHtml(audioDeviceValue)}" selected>${escapeHtml(audioDeviceValue)} (unavailable)</option>`,
    );
  }
  sel.innerHTML = opts.join('');
}

function updateCurrentDeviceLabelIn(panel: HTMLDivElement): void {
  const el = panel.querySelector<HTMLDivElement>('#audio-device-current');
  if (!el) return;
  el.textContent = currentAudioDeviceName
    ? `Capturing: ${currentAudioDeviceName}`
    : 'No audio device';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function initSettingsPanel(callbacks: SettingsCallbacks, initial?: SettingsInitial): void {
  if (btnEl) return;

  if (initial) {
    styleValue = initial.style;
    responsivenessValue = initial.responsiveness;
    qualityValue = initial.quality;
    ringCountValue = clampRingCount(initial.ringCount);
    paletteIndexValue = initial.paletteIndex;
    customHueValue = clampHue(initial.customHue);
    audioDeviceValue = initial.audioDevice || 'default';
    audioDevicesList = initial.audioDevices ?? [];
    currentAudioDeviceName = initial.currentAudioDeviceName ?? '';
  }

  styleEl = document.createElement('style');
  styleEl.textContent = PANEL_CSS;
  document.head.appendChild(styleEl);

  btnEl = document.createElement('button');
  btnEl.id = 'settings-btn';
  btnEl.className = 'sonora-fadeable';
  btnEl.title = 'Settings';
  btnEl.innerHTML = ICON_GEAR;
  btnEl.addEventListener('click', () => {
    setOpen(!panelEl?.classList.contains('open'));
  });
  document.body.appendChild(btnEl);

  panelEl = buildPanel(callbacks, initial?.variant);
  document.body.appendChild(panelEl);

  // Apply initial defaults so engine state matches the UI. Variant is left to
  // the caller, who knows the per-mode preference.
  callbacks.onResponsivenessChange(responsivenessValue);
  callbacks.onQualityChange(qualityValue);
  callbacks.onRingCountChange(ringCountValue);

  // Click outside to close
  document.addEventListener('click', (e) => {
    if (!panelEl?.classList.contains('open')) return;
    const target = e.target as Node;
    if (panelEl.contains(target) || btnEl?.contains(target)) return;
    setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'Escape' && panelEl?.classList.contains('open')) {
      setOpen(false);
    }
  });
}

function clampRingCount(n: number): number {
  return Math.max(RING_COUNT_MIN, Math.min(RING_COUNT_MAX, Math.round(n)));
}
function clampHue(h: number): number {
  return Math.max(0, Math.min(360, Math.round(h)));
}

/** Initial defaults — reflect last applied UI value. */
export function getDefaultResponsiveness(): number { return responsivenessValue; }
export function getDefaultQuality(): QualityPreset { return qualityValue; }
export function getDefaultStyle(): StyleId { return styleValue; }

/** Programmatic style change (e.g. from a keyboard shortcut). */
export function syncStyleSelection(style: StyleId): void {
  styleValue = style;
  if (!panelEl) return;
  panelEl.querySelectorAll<HTMLButtonElement>('#mode-groups button').forEach((b) => {
    b.classList.toggle('active', b.dataset.s === style);
  });
  updateRingCountVisibility(panelEl, style);
}

/** Show/hide the variant row and select a variant. Pass `null` / undefined
 *  to refresh the variant UI for the current style without firing a
 *  change. */
export function syncVariantUI(style: StyleId, variantId?: string): void {
  if (!panelEl) return;
  const field = panelEl.querySelector<HTMLDivElement>('#variant-field')!;
  const seg = panelEl.querySelector<HTMLDivElement>('#variant-seg')!;
  const variants = STYLE_VARIANTS[style];

  if (!variants || variants.length === 0) {
    field.style.display = 'none';
    return;
  }

  field.style.display = '';
  if (seg.children.length === 0 || (seg.firstChild as HTMLElement)?.dataset?.v !== variants[0].id) {
    seg.innerHTML = variants
      .map((v) => `<button data-v="${v.id}">${v.label}</button>`)
      .join('');
  }
  const active = variantId ?? variants[0].id;
  seg.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.v === active);
  });
}

/** Update the palette UI when the palette is changed externally
 *  (e.g. via the floating palette picker or a number key). */
export function syncPaletteSelection(paletteIndex: number, customHue?: number): void {
  paletteIndexValue = paletteIndex;
  if (typeof customHue === 'number') customHueValue = clampHue(customHue);
  if (!panelEl) return;

  const swatchRow = panelEl.querySelector<HTMLDivElement>('#palette-swatches');
  const paletteNameEl = panelEl.querySelector<HTMLSpanElement>('#palette-name');
  const hueSlider = panelEl.querySelector<HTMLInputElement>('#hue-slider');
  const hueValueEl = panelEl.querySelector<HTMLSpanElement>('#hue-value');

  if (paletteIndex < 0) {
    panelEl.classList.add('custom-open');
    if (paletteNameEl) paletteNameEl.textContent = 'Custom';
    if (typeof customHue === 'number' && hueSlider) hueSlider.value = String(customHueValue);
    if (typeof customHue === 'number' && hueValueEl) hueValueEl.textContent = `${customHueValue}°`;
  } else {
    panelEl.classList.remove('custom-open');
    if (paletteNameEl) paletteNameEl.textContent = PALETTES[paletteIndex]?.name ?? '';
  }
  swatchRow?.querySelectorAll<HTMLDivElement>('.swatch').forEach((sw) => {
    sw.classList.toggle('active', Number(sw.dataset.idx) === paletteIndex);
  });
}

/** Update the ring count UI when changed externally (e.g. on settings load). */
export function syncRingCount(n: number): void {
  ringCountValue = clampRingCount(n);
  if (!panelEl) return;
  const slider = panelEl.querySelector<HTMLInputElement>('#ring-count-slider');
  const value = panelEl.querySelector<HTMLSpanElement>('#ring-count-value');
  if (slider) slider.value = String(ringCountValue);
  if (value) value.textContent = String(ringCountValue);
}

/** Refresh the device dropdown's option list. Re-applies the currently
 *  selected pinned id, even if it isn't in the list (shown as unavailable). */
export function syncAudioDevices(devices: DeviceInfo[]): void {
  audioDevicesList = devices;
  if (panelEl) populateDeviceSelectIn(panelEl);
}

/** Update the "Capturing: X" label and the dropdown's selected pinned id.
 *  Pass `selectedId` when the user's preference changes externally. */
export function syncCurrentAudioDevice(currentName: string, selectedId?: string): void {
  currentAudioDeviceName = currentName;
  if (typeof selectedId === 'string') audioDeviceValue = selectedId || 'default';
  if (!panelEl) return;
  updateCurrentDeviceLabelIn(panelEl);
  if (typeof selectedId === 'string') {
    const sel = panelEl.querySelector<HTMLSelectElement>('#audio-device-select');
    if (sel) sel.value = audioDeviceValue;
    populateDeviceSelectIn(panelEl);
  }
}
