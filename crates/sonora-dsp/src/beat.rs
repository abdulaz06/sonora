//! Tempo and beat phase.
//!
//! An onset-detection function (ODF) built from normalised low-band flux is
//! autocorrelated every second. A log-Gaussian tempo prior centred on 120 BPM
//! plus a half-tempo harmonic term steer the pick away from octave errors.
//! Beat phase is a free-running oscillator nudged toward ODF peaks (a simple
//! PLL), so it stays steady through fills and dropouts instead of resetting
//! on every loud onset.

use crate::frame::BeatData;

// ── Tuning ──────────────────────────────────────────────────
/// ODF history length (frames, ~8.5 s at 60 fps).
const HISTORY: usize = 512;
const MIN_BPM: f32 = 60.0;
const MAX_BPM: f32 = 200.0;
/// Centre and width (octaves) of the tempo prior.
const PRIOR_CENTER_BPM: f32 = 120.0;
const PRIOR_OCTAVE_SIGMA: f32 = 0.9;
/// Weight of the autocorrelation at twice the lag (rewards the true period).
const HARMONIC_WEIGHT: f32 = 0.5;
/// How often the tempo estimate is refreshed (s).
const TEMPO_UPDATE_S: f32 = 1.0;
/// Normalised autocorrelation at which confidence reaches 1.
const CONFIDENCE_FULL_R: f32 = 0.45;
/// Minimum confidence before a new tempo is adopted.
const ADOPT_CONFIDENCE: f32 = 0.15;
/// Relative tempo change treated as "the same tempo" (smoothed in).
const TEMPO_SAME_TOLERANCE: f32 = 0.06;
/// Consecutive agreeing estimates required to jump to a different tempo.
const TEMPO_JUMP_VOTES: u32 = 2;
/// Fraction of the phase error corrected per ODF peak.
const PLL_GAIN: f32 = 0.2;
/// ODF peak must exceed `activity * PEAK_RATIO + PEAK_MIN`.
const PEAK_RATIO: f32 = 1.6;
const PEAK_MIN: f32 = 0.03;
/// Time constant of the ODF activity follower (s).
const ACTIVITY_TAU: f32 = 1.5;

pub struct BeatTracker {
    history: Vec<f32>,
    write_pos: usize,
    scratch: Vec<f32>,
    acf: Vec<f32>,
    bpm_smooth: f32,
    candidate_bpm: f32,
    candidate_votes: u32,
    beat_interval: f32,
    phase: f32,
    confidence: f32,
    fps: f32,
    since_update: f32,
    odf_prev: f32,
    odf_prev2: f32,
    activity: f32,
}

impl BeatTracker {
    pub fn new(fps: f32) -> Self {
        Self {
            history: vec![0.0; HISTORY],
            write_pos: 0,
            scratch: vec![0.0; HISTORY],
            acf: vec![0.0; HISTORY],
            bpm_smooth: 120.0,
            candidate_bpm: 120.0,
            candidate_votes: 0,
            beat_interval: 0.5,
            phase: 0.0,
            confidence: 0.0,
            fps,
            since_update: 0.0,
            odf_prev: 0.0,
            odf_prev2: 0.0,
            activity: 0.0,
        }
    }

    /// `odf` is the per-frame onset strength (normalised low-band flux).
    pub fn process(&mut self, odf: f32, dt: f32) -> BeatData {
        self.history[self.write_pos] = odf;
        self.write_pos = (self.write_pos + 1) % HISTORY;

        let a = 1.0 - (-dt / ACTIVITY_TAU).exp();
        self.activity += a * (odf - self.activity);

        self.since_update += dt;
        if self.since_update >= TEMPO_UPDATE_S {
            self.since_update = 0.0;
            self.update_tempo();
        }

        // Advance the oscillator.
        let prev_phase = self.phase;
        self.phase += dt / self.beat_interval;
        let wrapped = self.phase >= 1.0;
        self.phase = self.phase.fract();

        // PLL: a local ODF maximum (one frame ago) pulls phase toward 0.
        let is_peak = self.odf_prev > odf
            && self.odf_prev >= self.odf_prev2
            && self.odf_prev > self.activity * PEAK_RATIO + PEAK_MIN;
        if is_peak && self.confidence > 0.05 {
            let mut peak_phase = self.phase - dt / self.beat_interval;
            peak_phase -= peak_phase.round(); // wrap to [-0.5, 0.5)
            self.phase = (self.phase - PLL_GAIN * peak_phase).rem_euclid(1.0);
        }
        self.odf_prev2 = self.odf_prev;
        self.odf_prev = odf;

        let onset = wrapped && prev_phase > 0.5 && self.confidence > 0.1 && self.activity > 0.01;

        BeatData {
            bpm: self.bpm_smooth,
            phase: self.phase,
            onset,
            confidence: self.confidence,
        }
    }

    fn update_tempo(&mut self) {
        let n = HISTORY;
        // Unroll the ring (oldest first), smooth with a 3-tap kernel, remove mean.
        for i in 0..n {
            self.scratch[i] = self.history[(self.write_pos + i) % n];
        }
        let mut prev = self.scratch[0];
        for i in 1..n - 1 {
            let cur = self.scratch[i];
            self.scratch[i] = 0.25 * prev + 0.5 * cur + 0.25 * self.scratch[i + 1];
            prev = cur;
        }
        let mean = self.scratch.iter().sum::<f32>() / n as f32;
        for v in self.scratch.iter_mut() {
            *v -= mean;
        }
        let r0 = self.scratch.iter().map(|v| v * v).sum::<f32>() / n as f32;
        if r0 < 1e-7 {
            self.confidence *= 0.5;
            return;
        }

        let min_lag = (self.fps * 60.0 / MAX_BPM).floor() as usize;
        let max_lag = ((self.fps * 60.0 / MIN_BPM).ceil() as usize).min(n / 2 - 1);
        let top = (2 * max_lag + 1).min(n - 1);
        for lag in min_lag..=top {
            let mut acc = 0.0;
            for i in 0..n - lag {
                acc += self.scratch[i] * self.scratch[i + lag];
            }
            self.acf[lag] = acc / ((n - lag) as f32 * r0);
        }

        let score = |s: &Self, lag: usize| -> f32 {
            let bpm = s.fps * 60.0 / lag as f32;
            let oct = (bpm / PRIOR_CENTER_BPM).log2() / PRIOR_OCTAVE_SIGMA;
            let prior = (-0.5 * oct * oct).exp();
            let harmonic = if 2 * lag <= top { s.acf[2 * lag] } else { 0.0 };
            (s.acf[lag] + HARMONIC_WEIGHT * harmonic) * prior
        };

        let mut best_lag = min_lag;
        let mut best = f32::NEG_INFINITY;
        for lag in min_lag..=max_lag {
            let sc = score(self, lag);
            if sc > best {
                best = sc;
                best_lag = lag;
            }
        }

        // Parabolic interpolation for a fractional lag.
        let mut lag_f = best_lag as f32;
        if best_lag > min_lag && best_lag < max_lag {
            let (y0, y1, y2) = (score(self, best_lag - 1), best, score(self, best_lag + 1));
            let denom = y0 - 2.0 * y1 + y2;
            if denom.abs() > 1e-6 {
                lag_f += (0.5 * (y0 - y2) / denom).clamp(-0.5, 0.5);
            }
        }

        self.confidence = (self.acf[best_lag] / CONFIDENCE_FULL_R).clamp(0.0, 1.0);
        if self.confidence < ADOPT_CONFIDENCE {
            return;
        }

        let new_bpm = self.fps * 60.0 / lag_f;
        let rel = (new_bpm - self.bpm_smooth).abs() / self.bpm_smooth;
        if rel < TEMPO_SAME_TOLERANCE {
            self.bpm_smooth += 0.35 * (new_bpm - self.bpm_smooth);
            self.candidate_votes = 0;
        } else if (new_bpm - self.candidate_bpm).abs() / self.candidate_bpm < TEMPO_SAME_TOLERANCE {
            self.candidate_votes += 1;
            if self.candidate_votes >= TEMPO_JUMP_VOTES {
                self.bpm_smooth = new_bpm;
                self.candidate_votes = 0;
            }
        } else {
            self.candidate_bpm = new_bpm;
            self.candidate_votes = 1;
        }
        self.beat_interval = 60.0 / self.bpm_smooth;
    }
}
