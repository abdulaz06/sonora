import type { AudioFeatureFrame } from '../types/audio-frame';
import type { EventState } from '../engine/events';
import type { RendererStats } from '../engine/renderer';

/** Overlay refresh interval (ms); innerHTML rebuilds are not free. */
const REFRESH_MS = 66;
let lastRefresh = 0;

let overlayEl: HTMLDivElement | null = null;
let styleEl: HTMLStyleElement | null = null;
let visible = false;

const OVERLAY_CSS = `
#debug-overlay {
  position: fixed;
  top: 0;
  right: 0;
  width: 280px;
  height: 100%;
  background: rgba(8, 8, 10, 0.9);
  color: rgba(236, 231, 223, 0.8);
  font-family: 'IBM Plex Mono', 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 14px 12px;
  overflow-y: auto;
  z-index: 1000;
  pointer-events: none;
  border-left: 1px solid rgba(255,255,255,0.06);
  scrollbar-width: none;
}
#debug-overlay::-webkit-scrollbar { display: none; }

#debug-overlay .section {
  margin-bottom: 14px;
}
#debug-overlay .section-title {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  color: rgba(255,255,255,0.35);
  margin-bottom: 6px;
  padding-bottom: 3px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
}

#debug-overlay .row {
  display: flex;
  align-items: center;
  height: 18px;
  gap: 6px;
}
#debug-overlay .label {
  width: 70px;
  flex-shrink: 0;
  color: rgba(255,255,255,0.5);
  font-size: 10px;
}
#debug-overlay .bar-track {
  flex: 1;
  height: 6px;
  background: rgba(255,255,255,0.06);
  border-radius: 3px;
  overflow: hidden;
}
#debug-overlay .bar-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 60ms linear;
}
#debug-overlay .value {
  width: 36px;
  flex-shrink: 0;
  text-align: right;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,0.4);
}

/* Beat section */
#debug-overlay .beat-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 4px;
}
#debug-overlay .bpm-display {
  font-size: 22px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}
#debug-overlay .bpm-unit {
  font-size: 9px;
  color: rgba(255,255,255,0.3);
  margin-left: 2px;
}
#debug-overlay .beat-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: rgba(255,255,255,0.1);
  transition: background 50ms;
}
#debug-overlay .beat-dot.active {
  background: #6ee7b7;
  box-shadow: 0 0 8px #6ee7b7;
}
#debug-overlay .confidence-label {
  font-size: 9px;
  color: rgba(255,255,255,0.3);
}

/* Phase bar */
#debug-overlay .phase-track {
  height: 3px;
  background: rgba(255,255,255,0.06);
  border-radius: 2px;
  margin-bottom: 2px;
  overflow: hidden;
}
#debug-overlay .phase-fill {
  height: 100%;
  background: #6ee7b7;
  border-radius: 2px;
}

/* Element dots */
#debug-overlay .element-row {
  display: flex;
  align-items: center;
  height: 20px;
  gap: 6px;
}
#debug-overlay .element-dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  flex-shrink: 0;
}

/* Archetype highlight */
#debug-overlay .archetype-top {
  font-size: 13px;
  font-weight: 600;
  color: #c4b5fd;
  margin-bottom: 6px;
}

#debug-overlay .events { margin-bottom: 14px; }
#debug-overlay .section-name { font-size: 18px; letter-spacing: 0.08em; text-transform: uppercase; color: #ECE7DF; }
#debug-overlay .ev { display: flex; justify-content: space-between; font-size: 10px; color: rgba(236,231,223,0.55); }
#debug-overlay .ev.fresh { color: #ECE7DF; }
#debug-overlay .stats { font-size: 10px; color: rgba(236,231,223,0.45); margin-top: 4px; }
/* Color accents per section */
.color-band .bar-fill { background: #38bdf8; }
.color-spectral .bar-fill { background: #a78bfa; }
.color-energy .bar-fill { background: #fbbf24; }
.color-element .bar-fill { background: #34d399; }
.color-rhythm .bar-fill { background: #c4b5fd; }
.color-mood .bar-fill { background: #f472b6; }
.color-mapping .bar-fill { background: #fb7185; }
.color-presence .bar-fill { background: #fb923c; }
.color-hits .bar-fill { background: #facc15; }

/* Juiced FFT mini-spectrogram */
#debug-overlay .jfft {
  display: flex;
  gap: 1px;
  height: 28px;
  background: rgba(255,255,255,0.04);
  border-radius: 2px;
  padding: 2px;
  align-items: flex-end;
}
#debug-overlay .jfft-bin {
  flex: 1;
  background: #fb7185;
  border-radius: 1px;
  min-height: 1px;
  transition: height 60ms linear;
}
`;

function createOverlay(): HTMLDivElement {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    document.head.appendChild(styleEl);
  }
  const el = document.createElement('div');
  el.id = 'debug-overlay';
  document.body.appendChild(el);
  return el;
}

function barHTML(label: string, value: number): string {
  const pct = Math.round(Math.min(value, 1) * 100);
  return `<div class="row">
    <span class="label">${label}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
    <span class="value">${value.toFixed(2)}</span>
  </div>`;
}

function elementRow(label: string, energy: number, present: boolean, hue: string): string {
  const pct = Math.round(Math.min(energy, 1) * 100);
  const dotColor = present ? hue : 'rgba(255,255,255,0.1)';
  return `<div class="element-row">
    <div class="element-dot" style="background:${dotColor}${present ? ';box-shadow:0 0 4px ' + hue : ''}"></div>
    <span class="label">${label}</span>
    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${hue}"></div></div>
    <span class="value">${energy.toFixed(2)}</span>
  </div>`;
}

function topArchetype(r: AudioFeatureFrame['rhythm']): string {
  const entries: [string, number][] = [
    ['Four on the Floor', r.four_on_floor],
    ['Half-Time Heavy', r.half_time_heavy],
    ['Backbeat Groove', r.backbeat_groove],
    ['Broken Beat', r.broken_beat],
    ['Syncopated Dance', r.syncopated_dance],
    ['Ambient / Free', r.ambient_free],
  ];
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

export function toggleDebugOverlay(): void {
  if (!overlayEl) {
    overlayEl = createOverlay();
  }
  visible = !visible;
  overlayEl.style.display = visible ? 'block' : 'none';
}

function jfftHTML(bins: number[]): string {
  if (!bins.length) return '';
  const cells = bins
    .map((v) => `<div class="jfft-bin" style="height:${Math.round(Math.max(0, Math.min(1, v)) * 100)}%"></div>`)
    .join('');
  return `<div class="jfft">${cells}</div>`;
}

function eventsHTML(st: EventState | undefined, stats: RendererStats | undefined): string {
  if (!st) return '';
  const now = st.recent.length ? st.recent[st.recent.length - 1].time : 0;
  const rows = [...st.recent].reverse().map((e) => {
    const fresh = now - e.time < 2 && e === st.recent[st.recent.length - 1];
    return `<div class="ev ${fresh ? 'fresh' : ''}"><span>${e.type}</span><span>${e.strength.toFixed(2)} @ ${e.time.toFixed(1)}s</span></div>`;
  }).join('');
  const s = stats ? `<div class="stats">${stats.fps.toFixed(0)} fps · ${stats.frameMs.toFixed(1)} ms cpu · ${stats.quality.level} · ${stats.sceneWidth}×${stats.sceneHeight}</div>` : '';
  return `<div class="section events">
    <div class="section-title">Events</div>
    <div class="section-name">${st.section}</div>
    ${barHTML('Build', st.buildProgress)}
    ${barHTML('Drop env', st.dropEnvelope)}
    ${barHTML('Level', Math.min(1, st.level))}
    ${rows || '<div class="ev"><span>no events yet</span></div>'}
    ${s}
  </div>`;
}

export function updateDebugOverlay(frame: AudioFeatureFrame, events?: EventState, stats?: RendererStats): void {
  if (!overlayEl || !visible) return;
  const nowMs = performance.now();
  if (nowMs - lastRefresh < REFRESH_MS) return;
  lastRefresh = nowMs;

  const b = frame.bands;
  const s = frame.spectral;
  const e = frame.energy;
  const bt = frame.beat;
  const el = frame.elements;
  const r = frame.rhythm;
  const m = frame.mood;
  const p = frame.presence;
  const h = frame.hits;

  overlayEl.innerHTML = `
    ${eventsHTML(events, stats)}
    <div class="section">
      <div class="beat-row">
        <div class="bpm-display">${bt.bpm.toFixed(0)}<span class="bpm-unit">BPM</span></div>
        <div class="beat-dot ${bt.onset ? 'active' : ''}"></div>
        <span class="confidence-label">${(bt.confidence * 100).toFixed(0)}% conf</span>
      </div>
      <div class="phase-track"><div class="phase-fill" style="width:${Math.round(bt.phase * 100)}%"></div></div>
    </div>

    <div class="section">
      <div class="section-title">Mapping Layer</div>
      <div class="color-mapping">
        ${barHTML('Fade In/Out', frame.fade_in_out)}
        ${barHTML('Intensity', frame.intensity)}
      </div>
      <div style="height:6px"></div>
      <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:3px;">Presence (sustained)</div>
      <div class="color-presence">
        ${barHTML('Sub Bass', p.sub_bass)}
        ${barHTML('Bass', p.bass)}
        ${barHTML('Low Mid', p.low_mid)}
        ${barHTML('Mid', p.mid)}
        ${barHTML('Upper Mid', p.upper_mid)}
        ${barHTML('High', p.high)}
        ${barHTML('Air', p.air)}
      </div>
      <div style="height:6px"></div>
      <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:3px;">Hits (transient)</div>
      <div class="color-hits">
        ${barHTML('Sub Bass', h.sub_bass)}
        ${barHTML('Bass', h.bass)}
        ${barHTML('Low Mid', h.low_mid)}
        ${barHTML('Mid', h.mid)}
        ${barHTML('Upper Mid', h.upper_mid)}
        ${barHTML('High', h.high)}
        ${barHTML('Air', h.air)}
      </div>
      <div style="height:6px"></div>
      <div style="font-size:9px;color:rgba(255,255,255,0.35);margin-bottom:3px;">Juiced FFT (${frame.juiced_fft.length} bins)</div>
      ${jfftHTML(frame.juiced_fft)}
    </div>

    <div class="section">
      <div class="section-title">Frequency Bands</div>
      <div class="color-band">
        ${barHTML('Sub Bass', b.sub_bass.energy)}
        ${barHTML('Bass', b.bass.energy)}
        ${barHTML('Low Mid', b.low_mid.energy)}
        ${barHTML('Mid', b.mid.energy)}
        ${barHTML('Upper Mid', b.upper_mid.energy)}
        ${barHTML('High', b.high.energy)}
        ${barHTML('Air', b.air.energy)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Elements</div>
      ${elementRow('Kick', el.kick.energy, !!el.kick.presence, '#f97316')}
      ${elementRow('Snare', el.snare.energy, !!el.snare.presence, '#eab308')}
      ${elementRow('Hi-Hat', el.hihat.energy, !!el.hihat.presence, '#22d3ee')}
      ${elementRow('Bass', el.bass.energy, !!el.bass.presence, '#8b5cf6')}
      ${elementRow('Vocal', el.vocal.energy, !!el.vocal.presence, '#ec4899')}
      ${elementRow('Pad', el.pad.energy, !!el.pad.presence, '#6366f1')}
      ${elementRow('Lead', el.lead.energy, !!el.lead.presence, '#14b8a6')}
    </div>

    <div class="section">
      <div class="section-title">Rhythm</div>
      <div class="archetype-top">${topArchetype(r)}</div>
      <div class="color-rhythm">
        ${barHTML('4 on Floor', r.four_on_floor)}
        ${barHTML('Half-Time', r.half_time_heavy)}
        ${barHTML('Backbeat', r.backbeat_groove)}
        ${barHTML('Broken Beat', r.broken_beat)}
        ${barHTML('Syncopated', r.syncopated_dance)}
        ${barHTML('Ambient', r.ambient_free)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Energy</div>
      <div class="color-energy">
        ${barHTML('Instant', e.instant)}
        ${barHTML('Short Term', e.short_term)}
        ${barHTML('Long Term', e.long_term)}
        ${barHTML('Ratio', e.ratio)}
        ${barHTML('Dynamic', e.dynamic_range)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Spectral</div>
      <div class="color-spectral">
        ${barHTML('Centroid', s.centroid)}
        ${barHTML('Spread', s.spread)}
        ${barHTML('Flatness', s.flatness)}
        ${barHTML('Rolloff', s.rolloff)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Mood</div>
      <div class="color-mood">
        ${barHTML('Warmth', m.warmth)}
        ${barHTML('Brightness', m.brightness)}
        ${barHTML('Aggression', m.aggression)}
        ${barHTML('Smoothness', m.smoothness)}
        ${barHTML('Spacious', m.spaciousness)}
      </div>
    </div>

    <div class="section">
      <div class="section-title">Motion</div>
      <div class="color-energy">
        ${barHTML('Density', frame.motion_density)}
      </div>
    </div>
  `;
}
