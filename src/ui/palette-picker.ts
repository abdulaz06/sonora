/**
 * Palette picker — collapsible bottom-right widget.
 * Collapsed: small circular toggle button showing current palette color.
 * Expanded: full row of palette swatches with labels.
 * Number keys 1–N always work to jump to preset palettes. The final
 * "Custom" swatch reveals a hue slider for picking any hue (0–360°).
 *
 * The picker is a thin "view" — selection state lives in `ColorEngine`
 * and is mirrored into the settings panel via the supplied `onChange`
 * callback so both UIs stay in sync.
 */

import { PALETTES, type ColorEngine } from '../engine/color-engine';

const DEFAULT_CUSTOM_HUE = 200;

const PICKER_CSS = `
#palette-picker {
  position: fixed;
  bottom: 16px;
  right: 16px;
  z-index: 999;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
#palette-picker .toggle {
  width: 34px;
  height: 34px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid rgba(255, 255, 255, 0.25);
  background: var(--palette-color, #3b82f6);
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  transition: transform 0.2s, border-color 0.2s, box-shadow 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  z-index: 2;
}
#palette-picker .toggle:hover {
  transform: scale(1.08);
  border-color: rgba(255, 255, 255, 0.6);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.5);
}
#palette-picker .tray {
  position: absolute;
  bottom: 44px;
  right: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 14px 6px 14px;
  height: 34px;
  background: rgba(8, 8, 16, 0.75);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(6px);
  pointer-events: none;
  transition: opacity 0.22s ease, transform 0.22s ease;
  white-space: nowrap;
}
#palette-picker.open .tray {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
#palette-picker .swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  cursor: pointer;
  border: 2px solid transparent;
  transition: border-color 0.15s, transform 0.12s;
  flex-shrink: 0;
}
#palette-picker .swatch:hover {
  transform: scale(1.18);
}
#palette-picker .swatch.active {
  border-color: rgba(255, 255, 255, 0.85);
}
#palette-picker .swatch.custom {
  background: conic-gradient(from 0deg, #ff0040, #ffd000, #00ff66, #00ddff, #3355ff, #d946ef, #ff0040);
}
#palette-picker .label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.5px;
  min-width: 50px;
  text-align: left;
  user-select: none;
}
#palette-picker .hue-slider {
  -webkit-appearance: none;
  appearance: none;
  display: none;
  width: 140px;
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
  outline: none;
  cursor: pointer;
  border: 1px solid rgba(255, 255, 255, 0.15);
  flex-shrink: 0;
}
#palette-picker.custom-open .hue-slider {
  display: block;
}
#palette-picker .hue-slider::-webkit-slider-thumb {
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
#palette-picker .hue-slider::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid rgba(0, 0, 0, 0.4);
  box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  cursor: pointer;
}
`;

export interface PalettePickerOptions {
  /** Initial selection: 0..PALETTES.length-1 for preset, -1 for custom. */
  initialPaletteIndex?: number;
  initialCustomHue?: number;
  /** Fires when the user changes selection. paletteIndex=-1 means custom. */
  onPaletteChange?: (paletteIndex: number) => void;
  onCustomHueChange?: (hue: number) => void;
}

let pickerEl: HTMLDivElement | null = null;
let toggleEl: HTMLDivElement | null = null;
let trayEl: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let swatches: HTMLDivElement[] = [];
let customSwatch: HTMLDivElement | null = null;
let hueSlider: HTMLInputElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let autoCollapseTimer: number | null = null;
let currentHue = DEFAULT_CUSTOM_HUE;

let externalPaletteCallback: ((paletteIndex: number) => void) | null = null;
let externalHueCallback: ((hue: number) => void) | null = null;

export function initPalettePicker(colorEngine: ColorEngine, options: PalettePickerOptions = {}): void {
  if (pickerEl) return;

  if (typeof options.initialCustomHue === 'number') {
    currentHue = clampHue(options.initialCustomHue);
  }
  externalPaletteCallback = options.onPaletteChange ?? null;
  externalHueCallback = options.onCustomHueChange ?? null;

  styleEl = document.createElement('style');
  styleEl.textContent = PICKER_CSS;
  document.head.appendChild(styleEl);

  pickerEl = document.createElement('div');
  pickerEl.id = 'palette-picker';
  pickerEl.className = 'sonora-fadeable';

  trayEl = document.createElement('div');
  trayEl.className = 'tray';

  for (let i = 0; i < PALETTES.length; i++) {
    const swatch = document.createElement('div');
    swatch.className = 'swatch';
    swatch.style.background = PALETTES[i].preview;
    swatch.title = PALETTES[i].name;
    swatch.addEventListener('click', () => {
      selectPalette(colorEngine, i, true);
      scheduleAutoCollapse();
    });
    trayEl.appendChild(swatch);
    swatches.push(swatch);
  }

  customSwatch = document.createElement('div');
  customSwatch.className = 'swatch custom';
  customSwatch.title = 'Custom';
  customSwatch.addEventListener('click', () => {
    selectCustom(colorEngine, true);
    scheduleAutoCollapse();
  });
  trayEl.appendChild(customSwatch);

  hueSlider = document.createElement('input');
  hueSlider.type = 'range';
  hueSlider.min = '0';
  hueSlider.max = '360';
  hueSlider.step = '1';
  hueSlider.value = String(currentHue);
  hueSlider.className = 'hue-slider';
  hueSlider.title = 'Custom hue';
  hueSlider.addEventListener('input', () => {
    if (!hueSlider) return;
    currentHue = Number(hueSlider.value);
    colorEngine.setCustomHue(currentHue);
    updateTogglePreviewForCustom();
    externalHueCallback?.(currentHue);
    scheduleAutoCollapse();
  });
  trayEl.appendChild(hueSlider);

  labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = PALETTES[0].name;
  trayEl.appendChild(labelEl);

  pickerEl.appendChild(trayEl);

  toggleEl = document.createElement('div');
  toggleEl.className = 'toggle';
  toggleEl.title = 'Palette';
  toggleEl.style.setProperty('--palette-color', PALETTES[0].preview);
  toggleEl.addEventListener('click', () => {
    togglePicker();
  });
  pickerEl.appendChild(toggleEl);

  document.body.appendChild(pickerEl);

  // Apply initial selection
  const initIdx = typeof options.initialPaletteIndex === 'number' ? options.initialPaletteIndex : 0;
  if (initIdx < 0) {
    applyCustomVisual();
  } else {
    applyPaletteVisual(initIdx);
  }

  // Click outside to collapse
  document.addEventListener('click', (e) => {
    if (!pickerEl || !pickerEl.classList.contains('open')) return;
    if (!pickerEl.contains(e.target as Node)) {
      setOpen(false);
    }
  });

  // Number keys 1-N to select (and briefly open for feedback)
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    const num = e.key === '0' ? 10 : parseInt(e.key, 10);
    if (num >= 1 && num <= PALETTES.length) {
      selectPalette(colorEngine, num - 1, true);
      setOpen(true);
      scheduleAutoCollapse();
    } else if (e.key === 'Escape' && pickerEl?.classList.contains('open')) {
      setOpen(false);
    }
  });
}

function togglePicker(): void {
  if (!pickerEl) return;
  const next = !pickerEl.classList.contains('open');
  setOpen(next);
  if (!next && autoCollapseTimer !== null) {
    window.clearTimeout(autoCollapseTimer);
    autoCollapseTimer = null;
  }
}

function setOpen(open: boolean): void {
  if (!pickerEl) return;
  pickerEl.classList.toggle('open', open);
}

function scheduleAutoCollapse(): void {
  if (autoCollapseTimer !== null) {
    window.clearTimeout(autoCollapseTimer);
  }
  autoCollapseTimer = window.setTimeout(() => {
    setOpen(false);
    autoCollapseTimer = null;
  }, 1600);
}

function selectPalette(colorEngine: ColorEngine, index: number, fireExternal: boolean): void {
  colorEngine.setPalette(index);
  applyPaletteVisual(index);
  if (fireExternal) externalPaletteCallback?.(index);
}

function selectCustom(colorEngine: ColorEngine, fireExternal: boolean): void {
  colorEngine.setCustomHue(currentHue);
  applyCustomVisual();
  if (fireExternal) externalPaletteCallback?.(-1);
}

function applyPaletteVisual(index: number): void {
  const safe = ((index % PALETTES.length) + PALETTES.length) % PALETTES.length;
  for (let i = 0; i < swatches.length; i++) {
    swatches[i].classList.toggle('active', i === safe);
  }
  customSwatch?.classList.remove('active');
  pickerEl?.classList.remove('custom-open');
  if (labelEl) labelEl.textContent = PALETTES[safe].name;
  if (toggleEl) toggleEl.style.setProperty('--palette-color', PALETTES[safe].preview);
}

function applyCustomVisual(): void {
  for (const s of swatches) s.classList.remove('active');
  customSwatch?.classList.add('active');
  pickerEl?.classList.add('custom-open');
  if (labelEl) labelEl.textContent = 'Custom';
  if (hueSlider) hueSlider.value = String(currentHue);
  updateTogglePreviewForCustom();
}

function updateTogglePreviewForCustom(): void {
  if (!toggleEl) return;
  toggleEl.style.setProperty('--palette-color', `hsl(${currentHue}, 75%, 55%)`);
}

function clampHue(h: number): number {
  return Math.max(0, Math.min(360, Math.round(h)));
}

/** Update the picker UI when the palette is changed elsewhere (settings panel,
 *  initial settings load). Does NOT fire external callbacks. */
export function syncPalettePicker(paletteIndex: number, customHue?: number): void {
  if (typeof customHue === 'number') currentHue = clampHue(customHue);
  if (!pickerEl) return;
  if (paletteIndex < 0) {
    applyCustomVisual();
  } else {
    applyPaletteVisual(paletteIndex);
  }
}
