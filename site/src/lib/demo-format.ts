/**
 * Recorded analysis frames for the website's demo: the real DSP output for the
 * demo track, quantised to 8 or 16 bits per signal, planar (one channel after
 * another, which compresses well).
 *
 *   u32 LE  header length
 *   bytes   header JSON (DemoHeader)
 *   bytes   channel data, in header order (u16 channels little-endian, 2-aligned)
 *
 * Only the signals the engine reads are kept (mapping layer, beat, energy,
 * rhythm for Set Mode); the rest of AudioFeatureFrame is filled with zeros.
 */

import { emptyFrame } from '../../../src/types/audio-frame';
import type { AudioFeatureFrame, BandHits } from '../../../src/types/audio-frame';

/** Parts of a frame the demo doesn't record: one shared, read-only instance (decoding allocates far less). */
const STATIC_PARTS = (() => {
  const e = emptyFrame();
  return { bands: e.bands, spectral: e.spectral, elements: e.elements, mood: e.mood, spectrum_bars: e.spectrum_bars, juiced_fft: e.juiced_fft };
})();
const zeroBands = (): BandHits => ({ sub_bass: 0, bass: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0, air: 0 });
function leanFrame(): AudioFeatureFrame {
  return {
    ...STATIC_PARTS,
    energy: { instant: 0, short_term: 0, long_term: 0, ratio: 0, dynamic_range: 0 },
    beat: { bpm: 120, phase: 0, onset: false, confidence: 0 },
    rhythm: { four_on_floor: 0, half_time_heavy: 0, backbeat_groove: 0, broken_beat: 0, syncopated_dance: 0, ambient_free: 0 },
    motion_density: 0, fade_in_out: 0, intensity: 0, presence: zeroBands(), hits: zeroBands(),
  };
}

export const BANDS = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'high', 'air'] as const;

type Get = (f: AudioFeatureFrame) => number;
type Setter = (f: AudioFeatureFrame, v: number) => void;
interface Field { name: string; bits: 8 | 16; get: Get; set: Setter }

const band = (kind: 'presence' | 'hits', b: keyof BandHits, bits: 8 | 16 = 8): Field => ({
  name: `${kind}.${b}`, bits, get: (f) => f[kind][b], set: (f, v) => { f[kind][b] = v; },
});

export const FIELDS: Field[] = [
  { name: 'fade_in_out', bits: 16, get: (f) => f.fade_in_out, set: (f, v) => { f.fade_in_out = v; } },
  { name: 'intensity', bits: 16, get: (f) => f.intensity, set: (f, v) => { f.intensity = v; } },
  ...BANDS.map((b) => band('presence', b, 16)),
  ...BANDS.map((b) => band('hits', b)),
  { name: 'beat.bpm', bits: 16, get: (f) => f.beat.bpm, set: (f, v) => { f.beat.bpm = v; } },
  { name: 'beat.phase', bits: 16, get: (f) => f.beat.phase, set: (f, v) => { f.beat.phase = v; } },
  { name: 'beat.onset', bits: 8, get: (f) => (f.beat.onset ? 1 : 0), set: (f, v) => { f.beat.onset = v > 0.5; } },
  { name: 'beat.confidence', bits: 8, get: (f) => f.beat.confidence, set: (f, v) => { f.beat.confidence = v; } },
  { name: 'energy.instant', bits: 16, get: (f) => f.energy.instant, set: (f, v) => { f.energy.instant = v; } },
  { name: 'rhythm.four_on_floor', bits: 8, get: (f) => f.rhythm.four_on_floor, set: (f, v) => { f.rhythm.four_on_floor = v; } },
  { name: 'rhythm.ambient_free', bits: 8, get: (f) => f.rhythm.ambient_free, set: (f, v) => { f.rhythm.ambient_free = v; } },
];

export interface DemoEvent { type: string; t: number; strength: number }

export interface DemoHeader {
  version: 1;
  fps: number;
  frames: number;
  sampleRate: number;
  /** Loop length in samples (frames × hop). */
  samples: number;
  channels: { name: string; bits: 8 | 16; min: number; max: number }[];
  /** Events the event layer found in steady looping playback (audio time, s). */
  events: DemoEvent[];
  /** Kick times from the generator (s), for checks. */
  kicks: number[];
  sections: [string, number, number][];
}

export interface DemoData { header: DemoHeader; frames: AudioFeatureFrame[] }

export function encodeDemo(frames: AudioFeatureFrame[], meta: Omit<DemoHeader, 'version' | 'frames' | 'channels'>): Uint8Array {
  const n = frames.length;
  const channels = FIELDS.map((fd) => {
    let min = Infinity, max = -Infinity;
    for (const f of frames) { const v = fd.get(f); if (v < min) min = v; if (v > max) max = v; }
    if (!Number.isFinite(min)) { min = 0; max = 1; }
    if (max - min < 1e-9) max = min + 1;
    return { name: fd.name, bits: fd.bits, min, max };
  });
  const header: DemoHeader = { version: 1, frames: n, channels, ...meta };
  const json = new TextEncoder().encode(JSON.stringify(header));
  let off = 4 + json.length;
  off += off % 2;
  const size = off + channels.reduce((s, c) => s + n * (c.bits / 8), 0);
  const out = new Uint8Array(size + (size % 2));
  const dv = new DataView(out.buffer);
  dv.setUint32(0, json.length, true);
  out.set(json, 4);
  FIELDS.forEach((fd, k) => {
    const c = channels[k];
    const top = c.bits === 8 ? 255 : 65535;
    for (let i = 0; i < n; i++) {
      const q = Math.round(((fd.get(frames[i]) - c.min) / (c.max - c.min)) * top);
      const v = Math.max(0, Math.min(top, q));
      if (c.bits === 8) out[off + i] = v; else dv.setUint16(off + i * 2, v, true);
    }
    off += n * (c.bits / 8);
  });
  return out;
}

export function decodeDemo(buf: ArrayBuffer): DemoData {
  const dv = new DataView(buf);
  const len = dv.getUint32(0, true);
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len))) as DemoHeader;
  const n = header.frames;
  const frames: AudioFeatureFrame[] = [];
  for (let i = 0; i < n; i++) frames.push(leanFrame());
  let off = 4 + len;
  off += off % 2;
  header.channels.forEach((c, k) => {
    const fd = FIELDS.find((x) => x.name === c.name) ?? FIELDS[k];
    const top = c.bits === 8 ? 255 : 65535;
    const span = c.max - c.min;
    for (let i = 0; i < n; i++) {
      const q = c.bits === 8 ? dv.getUint8(off + i) : dv.getUint16(off + i * 2, true);
      fd.set(frames[i], c.min + (q / top) * span);
    }
    off += n * (c.bits / 8);
  });
  return { header, frames };
}
