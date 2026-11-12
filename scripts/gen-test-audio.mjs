#!/usr/bin/env node
// Procedural test tracks for the verification harness. No samples, no
// copyrighted material: every sound is synthesised here from a fixed seed, so
// the WAVs are identical on every machine.
//
//   node scripts/gen-test-audio.mjs          # writes test-audio/*.wav + tracks.json
//
// Tracks
//   house-124      124 BPM four-on-the-floor: fade-in intro, 16-bar build, drop, breakdown
//   halftime-140   140 BPM half-time: heavy sub, sparse snares
//   ambient-pad    beatless pads, wind and bells with a slow swell
//   silence-fadein 10 s of silence, then a 20 s fade-in of a groove

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Tuning ──────────────────────────────────────────────────────────
const SR = 44100;
const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-audio');
const PEAK_DBFS = -1;

// ── Utilities ───────────────────────────────────────────────────────
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => { const t = clamp01(x); return t * t * (3 - 2 * t); };

/** Chamberlin state-variable filter. */
class SVF {
  constructor() { this.lp = 0; this.bp = 0; }
  process(x, cutoff, q = 0.7) {
    const f = Math.min(1.2, 2 * Math.sin(Math.PI * Math.min(cutoff, SR * 0.24) / SR));
    const damp = 1 / q;
    const hp = x - this.lp - damp * this.bp;
    this.bp += f * hp;
    this.lp += f * this.bp;
    return { lp: this.lp, bp: this.bp, hp };
  }
}

class Track {
  constructor(seconds, seed) {
    this.buf = new Float32Array(Math.ceil(seconds * SR));
    this.rand = mulberry32(seed);
  }
  noise() { return this.rand() * 2 - 1; }
  idx(t) { return Math.floor(t * SR); }

  kick(t0, amp = 1, tone = 1) {
    const n = Math.floor(0.5 * SR); const s = this.idx(t0); let ph = 0;
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      const f = 44 * tone + 120 * Math.exp(-t * 32);
      ph += (2 * Math.PI * f) / SR;
      const env = Math.exp(-t * 6.5) * Math.min(1, t * 900);
      const click = i < 90 ? this.noise() * 0.25 * (1 - i / 90) : 0;
      this.buf[s + i] += amp * (Math.sin(ph) * env * 0.95 + click);
    }
  }

  snare(t0, amp = 1, bright = 1) {
    const n = Math.floor(0.3 * SR); const s = this.idx(t0); const f = new SVF(); let ph = 0;
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      const nz = f.process(this.noise(), 2600 * bright, 0.9).bp;
      ph += (2 * Math.PI * 185) / SR;
      this.buf[s + i] += amp * (nz * 1.4 * Math.exp(-t * 16) + Math.sin(ph) * 0.45 * Math.exp(-t * 28));
    }
  }

  clap(t0, amp = 1) {
    const s = this.idx(t0); const f = new SVF(); const n = Math.floor(0.25 * SR);
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      const bursts = Math.exp(-((t % 0.011) * 300)) * (t < 0.035 ? 1 : 0) + Math.exp(-t * 14) * (t >= 0.022 ? 1 : 0);
      this.buf[s + i] += amp * f.process(this.noise(), 1700, 1.6).bp * bursts * 1.6;
    }
  }

  hat(t0, amp = 1, open = false) {
    const s = this.idx(t0); const n = Math.floor((open ? 0.35 : 0.06) * SR); const f = new SVF();
    const decay = open ? 9 : 70;
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      this.buf[s + i] += amp * f.process(this.noise(), 8000, 0.8).hp * Math.exp(-t * decay) * 1.1;
    }
  }

  /** Sub / bass note with optional pitch glide. */
  bass(t0, dur, note, amp = 1, glideFrom = null, drive = 1.2) {
    const s = this.idx(t0); const n = Math.floor(dur * SR); let ph = 0;
    const f1 = midi(note); const f0 = glideFrom === null ? f1 : midi(glideFrom);
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      const f = f1 + (f0 - f1) * Math.exp(-t * 18);
      ph += (2 * Math.PI * f) / SR;
      const env = Math.min(1, t * 200) * Math.min(1, (dur - t) * 40);
      this.buf[s + i] += amp * Math.tanh(Math.sin(ph) * drive) * env * 0.8;
    }
  }

  /** Detuned saw chord through a low-pass. `cutoffAt(t)` shapes brightness. */
  pad(t0, dur, notes, amp, cutoffAt, attack = 1.2, release = 1.5) {
    const s = this.idx(t0); const n = Math.floor((dur + release) * SR); const f = new SVF(); const f2 = new SVF();
    const voices = [];
    for (const nt of notes) for (const d of [-0.11, 0.0, 0.13]) voices.push({ inc: midi(nt + d) / SR, ph: this.rand() });
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      let x = 0;
      for (const v of voices) { v.ph += v.inc; if (v.ph >= 1) v.ph -= 1; x += v.ph * 2 - 1; }
      x /= voices.length;
      const env = Math.min(1, t / attack) * (t > dur ? Math.max(0, 1 - (t - dur) / release) : 1);
      const c = cutoffAt(t0 + t);
      this.buf[s + i] += amp * f2.process(f.process(x, c, 0.8).lp, c, 0.8).lp * env * 1.6;
    }
  }

  stab(t0, notes, amp = 1) {
    this.pad(t0, 0.12, notes, amp, (t) => 1800 + 2500 * Math.exp(-(t - t0) * 12), 0.004, 0.18);
  }

  bell(t0, note, amp = 1) {
    const s = this.idx(t0); const n = Math.floor(3 * SR); const f = midi(note);
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const t = i / SR;
      const x = Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 2.76 * t) * Math.exp(-t * 2)
        + 0.25 * Math.sin(2 * Math.PI * f * 5.4 * t) * Math.exp(-t * 4);
      this.buf[s + i] += amp * x * Math.exp(-t * 1.4) * Math.min(1, t * 400) * 0.3;
    }
  }

  /** Filtered noise sweep; `shape(u)` gives (cutoff, gain) for u in 0..1. */
  sweep(t0, dur, shape, hp = false) {
    const s = this.idx(t0); const n = Math.floor(dur * SR); const f = new SVF();
    for (let i = 0; i < n && s + i < this.buf.length; i++) {
      const u = i / n; const { cutoff, gain } = shape(u);
      const o = f.process(this.noise(), cutoff, 1.4);
      this.buf[s + i] += (hp ? o.hp : o.bp) * gain;
    }
  }

  /** Multiply a region by a gain curve g(t) (absolute track time). */
  gain(t0, t1, g) {
    for (let i = this.idx(t0); i < Math.min(this.idx(t1), this.buf.length); i++) this.buf[i] *= g(i / SR);
  }

  /** Kick-triggered ducking applied to a separate layer before mixing in. */
  static sidechain(layer, kicks, depth = 0.75, release = 0.22) {
    for (const k of kicks) {
      const s = Math.floor(k * SR); const n = Math.floor(release * 1.6 * SR);
      for (let i = 0; i < n && s + i < layer.length; i++) {
        const t = i / SR;
        layer[s + i] *= 1 - depth * Math.exp(-t / (release * 0.45));
      }
    }
  }

  mixIn(layer, amp = 1) { for (let i = 0; i < this.buf.length; i++) this.buf[i] += layer[i] * amp; }

  master(driveTo = 2.6) {
    let pre = 0;
    for (let i = 0; i < this.buf.length; i++) pre = Math.max(pre, Math.abs(this.buf[i]));
    const drive = pre > 0 ? driveTo / pre : 1;
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) { this.buf[i] = Math.tanh(this.buf[i] * drive); peak = Math.max(peak, Math.abs(this.buf[i])); }
    const target = Math.pow(10, PEAK_DBFS / 20);
    const g = peak > 0 ? target / peak : 1;
    for (let i = 0; i < this.buf.length; i++) this.buf[i] *= g;
    return this.buf;
  }
}

function writeWav(path, samples) {
  const data = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([h, data]));
}

// ── Track A: house 124 ──────────────────────────────────────────────
function house124() {
  const bpm = 124; const beat = 60 / bpm; const bar = beat * 4; const off = 3;
  const B = (b) => off + b * bar;
  const total = B(52) + 2;
  const tr = new Track(total, 124);
  const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
  const roots = [33, 29, 36, 31];
  const kicks = [];
  const bassLayer = new Track(total, 7);
  const padLayer = new Track(total, 8);

  for (let b = 0; b < 52; b++) {
    const ci = Math.floor(b / 2) % 4;
    const intro = b < 8; const buildA = b >= 8 && b < 16; const buildB = b >= 16 && b < 24;
    const drop = b >= 24 && b < 40; const brk = b >= 40 && b < 48; const outro = b >= 48;
    for (let q = 0; q < 4; q++) {
      const t = B(b) + q * beat;
      const kickOn = intro || buildA || drop || outro;
      if (kickOn) { tr.kick(t, drop ? 1.0 : 0.85); kicks.push(t); }
      if (intro || buildA || drop || outro) tr.hat(t + beat / 2, drop ? 0.55 : 0.4, drop && q % 2 === 1);
      if (drop) { tr.hat(t + beat * 0.25, 0.18); tr.hat(t + beat * 0.75, 0.18); }
      if ((buildA || drop) && (q === 1 || q === 3)) tr.clap(t, drop ? 0.9 : 0.6);
      if (intro || buildA || drop) bassLayer.bass(t + beat / 2, beat * 0.45, roots[ci] + 12, drop ? 1 : 0.6);
      if (drop) bassLayer.bass(t, beat * 0.9, roots[ci], 0.7);
    }
    if (drop && b % 2 === 0) for (const s of [0.75, 1.75, 2.5]) tr.stab(B(b) + s * beat, chords[ci].map((n) => n + 12), 0.5);
    if (b % 2 === 0) {
      const padAmp = intro ? 0.35 : buildA || buildB ? 0.45 : drop ? 0.4 : brk ? 0.7 : 0.3;
      padLayer.pad(B(b), bar * 2, chords[ci], padAmp, (t) => {
        const u = (t - B(8)) / (B(24) - B(8));
        if (u >= 0 && u < 1) return 500 + 4500 * u * u;
        if (t >= B(40) && t < B(48)) return 900 + 600 * Math.sin((t - B(40)) * 0.8);
        return t >= B(24) && t < B(40) ? 3000 : 900;
      });
    }
    if (brk && b % 1 === 0) for (let k = 0; k < 4; k++) tr.bell(B(b) + k * beat * 1.0 + (k % 2) * beat * 0.5, chords[ci][k % 3] + 24, 0.18);
  }
  // Build B: accelerating snare roll + riser (kick/bass out)
  for (let b = 16; b < 24; b++) {
    const div = b < 18 ? 1 : b < 20 ? 2 : b < 22 ? 4 : 8;
    for (let k = 0; k < 4 * div; k++) {
      const t = B(b) + (k * beat) / div;
      if (t >= B(23.5)) break;
      tr.snare(t, 0.35 + 0.5 * ((b - 16) / 8), 0.8 + (b - 16) * 0.1);
    }
  }
  tr.sweep(B(16), B(23.5) - B(16), (u) => ({ cutoff: 400 + 9000 * u * u, gain: 0.05 + 0.5 * u * u }));
  // Downlifter / crash at the drop
  tr.sweep(B(24), bar * 2, (u) => ({ cutoff: 9000 * (1 - u) + 300, gain: 0.5 * (1 - u) }), true);

  Track.sidechain(bassLayer.buf, kicks, 0.85);
  Track.sidechain(padLayer.buf, kicks, 0.6);
  tr.mixIn(bassLayer.buf); tr.mixIn(padLayer.buf);
  // Pre-drop gap: half a bar of near-silence
  tr.gain(B(23.5), B(24), () => 0.02);
  // Intro fade-in over 4 bars, outro fade over 2
  tr.gain(B(0), B(4), (t) => smooth((t - B(0)) / (B(4) - B(0))));
  tr.gain(B(50), total, (t) => 1 - smooth((t - B(50)) / (bar * 2)));
  // Track starts with silence
  tr.gain(0, off, () => 0);

  return {
    samples: tr.master(),
    markers: { silence: 1.5, fadeIn: B(2), build: B(21), drop: B(24), breakdown: B(43) },
    kicks,
    sections: [
      ['silence', 0, off], ['intro', off, B(8)], ['build', B(8), B(24)],
      ['drop', B(24), B(40)], ['breakdown', B(40), B(48)], ['outro', B(48), total],
    ],
  };
}

// ── Track B: half-time 140 ──────────────────────────────────────────
function halftime140() {
  const bpm = 140; const beat = 60 / bpm; const bar = beat * 4; const off = 2;
  const B = (b) => off + b * bar;
  const total = B(36) + 2;
  const tr = new Track(total, 140);
  const sub = new Track(total, 9); const padL = new Track(total, 10);
  const chords = [[50, 53, 57], [46, 50, 53], [43, 46, 50], [45, 49, 52]]; // Dm Bb Gm A
  const roots = [26, 22, 19, 21];
  const kicks = [];
  for (let b = 0; b < 36; b++) {
    const ci = Math.floor(b / 2) % 4;
    const intro = b < 4; const build = b >= 4 && b < 12; const drop = b >= 12 && b < 28; const brk = b >= 28;
    if (b % 2 === 0) padL.pad(B(b), bar * 2, chords[ci], brk ? 0.6 : drop ? 0.25 : 0.4,
      (t) => (build ? 600 + 3000 * ((t - B(4)) / (B(12) - B(4))) ** 2 : brk ? 800 : 1400));
    if (intro || build || drop) for (let e = 0; e < 8; e++) if (e % 2 === 1 || drop) tr.hat(B(b) + e * beat / 2, drop ? 0.35 : 0.25);
    if (drop) {
      tr.kick(B(b), 1.0, 0.95); kicks.push(B(b));
      if (b % 2 === 1) { tr.kick(B(b) + beat * 1.5, 0.9, 0.95); kicks.push(B(b) + beat * 1.5); }
      tr.snare(B(b) + beat * 2, 1.0, 0.9);
      if (b % 4 === 3) for (let k = 0; k < 3; k++) tr.hat(B(b) + beat * 3 + k * beat / 3, 0.4);
      sub.bass(B(b), bar * 0.9, roots[ci], 1.0, roots[ci] + 7, 2.2);
    }
    if (brk) sub.bass(B(b), bar * 0.95, roots[ci], 0.55, null, 1.2);
  }
  for (let b = 4; b < 12; b++) {
    const div = b < 8 ? 1 : b < 10 ? 2 : 4;
    for (let k = 0; k < 4 * div; k++) { const t = B(b) + (k * beat) / div; if (t < B(11.75)) tr.snare(t, 0.3 + 0.06 * (b - 4)); }
  }
  tr.sweep(B(4), B(11.75) - B(4), (u) => ({ cutoff: 300 + 8000 * u ** 2, gain: 0.05 + 0.45 * u ** 2 }));
  Track.sidechain(sub.buf, kicks, 0.5, 0.15);
  tr.mixIn(sub.buf); tr.mixIn(padL.buf);
  tr.gain(B(11.75), B(12), () => 0.03);
  tr.gain(B(0), B(2), (t) => smooth((t - B(0)) / (bar * 2)));
  tr.gain(B(34), total, (t) => 1 - smooth((t - B(34)) / (bar * 2)));
  tr.gain(0, off, () => 0);
  return {
    samples: tr.master(),
    markers: { silence: 1.0, fadeIn: B(1), build: B(10), drop: B(12), breakdown: B(30) },
    kicks,
    sections: [['silence', 0, off], ['intro', off, B(4)], ['build', B(4), B(12)], ['drop', B(12), B(28)], ['breakdown', B(28), total]],
  };
}

// ── Track C: ambient pads ───────────────────────────────────────────
function ambient() {
  const total = 92; const off = 2;
  const tr = new Track(total, 77);
  const chords = [[52, 59, 64, 66], [48, 55, 62, 64], [50, 57, 62, 69], [45, 52, 59, 64]];
  const swell = (t) => 0.35 + 0.65 * Math.sin(Math.PI * clamp01((t - off) / (total - off - 6))) ** 2;
  for (let i = 0; i * 8 < total - off; i++) {
    const t0 = off + i * 8;
    tr.pad(t0, 9, chords[i % 4], 0.5, (t) => 500 + 2200 * swell(t), 3.5, 4);
  }
  tr.sweep(off, total - off, (u) => ({ cutoff: 600 + 1800 * Math.sin(u * Math.PI * 5) ** 2, gain: 0.12 * swell(off + u * (total - off)) }));
  const r = mulberry32(5);
  for (let t = off + 6; t < total - 6; t += 1.6 + r() * 3.2) tr.bell(t, [76, 79, 83, 86, 88][Math.floor(r() * 5)], 0.25 * swell(t));
  tr.gain(0, total, (t) => swell(t) * smooth((t - off) / 4));
  tr.gain(0, off, () => 0);
  return {
    samples: tr.master(),
    markers: { silence: 1.0, fadeIn: 5, build: 30, drop: 46, breakdown: 80 },
    sections: [['silence', 0, off], ['swell', off, 46], ['peak', 46, 60], ['fade', 60, total]],
  };
}

// ── Track D: silence then fade-in ───────────────────────────────────
function silenceFadeIn() {
  const bpm = 120; const beat = 0.5; const bar = 2; const off = 10; const total = 44;
  const tr = new Track(total, 99); const padL = new Track(total, 3);
  const chords = [[57, 60, 64, 67], [53, 57, 60, 64]];
  const kicks = [];
  for (let t = off, b = 0; t < total; t += bar, b++) {
    for (let q = 0; q < 4; q++) { tr.kick(t + q * beat, 0.9); kicks.push(t + q * beat); tr.hat(t + q * beat + beat / 2, 0.35); }
    if (b % 2 === 1) tr.clap(t + beat, 0.6), tr.clap(t + 3 * beat, 0.6);
    tr.bass(t, bar * 0.95, 33 + (b % 2 ? -4 : 0), 0.6);
    padL.pad(t, bar, chords[b % 2], 0.4, () => 1600);
  }
  Track.sidechain(padL.buf, kicks, 0.5);
  tr.mixIn(padL.buf);
  void bpm;
  tr.gain(0, total, (t) => (t < off ? 0 : smooth((t - off) / 20)));
  return {
    samples: tr.master(),
    markers: { silence: 5, fadeIn: 16, build: 24, drop: 31, breakdown: 40 },
    kicks,
    sections: [['silence', 0, off], ['fade-in', off, off + 20], ['steady', off + 20, total]],
  };
}


// ── Track E: dense-128 (loud, busy modern mix) ──────────────────────
// Stands in for real streaming-loudness music: 16th hats, open hats,
// claps, sidechained supersaw chords and bass, heavy mastering. Used for
// flicker and exposure checks, where sparse test tracks under-represent.
function dense128() {
  const bpm = 128; const beat = 60 / bpm; const bar = beat * 4; const off = 2;
  const B = (b) => off + b * bar;
  const total = B(48) + 2;
  const tr = new Track(total, 128);
  const chords = [[60, 64, 67, 71], [57, 60, 64, 67], [53, 57, 60, 64], [55, 59, 62, 65]];
  const roots = [36, 33, 29, 31];
  const kicks = [];
  const bassLayer = new Track(total, 17);
  const synthLayer = new Track(total, 18);
  for (let b = 0; b < 48; b++) {
    const ci = Math.floor(b / 2) % 4;
    const intro = b < 4; const build = b >= 4 && b < 12; const drop1 = b >= 12 && b < 28;
    const brk = b >= 28 && b < 36; const drop2 = b >= 36 && b < 46;
    const drop = drop1 || drop2;
    for (let q = 0; q < 4; q++) {
      const t = B(b) + q * beat;
      if (intro || build || drop) { tr.kick(t, drop ? 1.0 : 0.8); kicks.push(t); }
      for (let s16 = 0; s16 < 4; s16++) if (drop || build || (intro && s16 === 2)) tr.hat(t + s16 * beat / 4, s16 === 2 ? 0.5 : 0.28, drop && s16 === 2);
      if ((build || drop) && (q === 1 || q === 3)) { tr.clap(t, 1.0); tr.snare(t, 0.4); }
      if (drop) { bassLayer.bass(t, beat * 0.95, roots[ci], 1.0, null, 2.2); bassLayer.bass(t + beat / 2, beat * 0.4, roots[ci] + 12, 0.6, null, 2); }
      if (build) bassLayer.bass(t + beat / 2, beat * 0.4, roots[ci] + 12, 0.5);
    }
    if (b % 2 === 0) {
      const amp = intro ? 0.4 : build ? 0.5 : drop ? 0.75 : 0.8;
      synthLayer.pad(B(b), bar * 2, chords[ci].concat(chords[ci].map((n) => n + 12)), amp, (t) => {
        if (t >= B(4) && t < B(12)) return 800 + 6000 * ((t - B(4)) / (B(12) - B(4))) ** 2;
        return (t >= B(12) && t < B(28)) || t >= B(36) ? 6500 : 1600;
      }, drop ? 0.01 : 0.6, 0.6);
    }
    if (drop && b % 1 === 0) for (const s of [0, 0.75, 1.5, 2.5, 3.25]) tr.stab(B(b) + s * beat, chords[ci].map((n) => n + 24), 0.35);
    if (brk) for (let k = 0; k < 8; k++) tr.bell(B(b) + k * beat / 2, chords[ci][k % 4] + 24, 0.22);
  }
  tr.sweep(B(8), B(12) - B(8), (u) => ({ cutoff: 500 + 10000 * u * u, gain: 0.1 + 0.6 * u * u }));
  tr.sweep(B(32), B(36) - B(32), (u) => ({ cutoff: 500 + 10000 * u * u, gain: 0.08 + 0.5 * u * u }));
  Track.sidechain(bassLayer.buf, kicks, 0.9);
  Track.sidechain(synthLayer.buf, kicks, 0.7);
  tr.mixIn(bassLayer.buf); tr.mixIn(synthLayer.buf, 1.1);
  tr.gain(B(0), B(1), (t) => smooth((t - B(0)) / bar));
  tr.gain(B(46), total, (t) => 1 - smooth((t - B(46)) / (bar * 2)));
  tr.gain(0, off, () => 0);
  return {
    samples: tr.master(4.5),
    // The first drop has no gap before it (realistic) and is not flagged as a
    // drop event; markers use the second, which is.
    markers: { silence: 1.0, fadeIn: B(1), build: B(34), drop: B(36), breakdown: B(31) },
    kicks,
    sections: [['silence', 0, off], ['intro', off, B(4)], ['build', B(4), B(12)], ['drop', B(12), B(28)],
      ['breakdown', B(28), B(36)], ['drop', B(36), B(46)], ['outro', B(46), total]],
  };
}

// ── Main ────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const tracks = { 'house-124': house124, 'halftime-140': halftime140, 'ambient-pad': ambient, 'silence-fadein': silenceFadeIn, 'dense-128': dense128 };
const meta = {};
for (const [name, fn] of Object.entries(tracks)) {
  const t0 = Date.now();
  const { samples, markers, sections, kicks = [] } = fn();
  writeWav(join(OUT_DIR, `${name}.wav`), samples);
  meta[name] = { file: `${name}.wav`, duration: +(samples.length / SR).toFixed(3), sampleRate: SR, markers, sections,
    kicks: kicks.map((k) => +k.toFixed(4)).sort((a, b) => a - b) };
  console.log(`${name}.wav  ${(samples.length / SR).toFixed(1)} s  (${Date.now() - t0} ms)`);
}
writeFileSync(join(OUT_DIR, 'tracks.json'), JSON.stringify(meta, null, 2) + '\n');
