//! Mapping layer — art-ready control signals derived from raw analysis.
//!
//! Produces five signal families that sit between the analysis pipeline and the
//! visual system. These are the signals the renderer should consume — they are
//! stable, normalized, and tuned to drive motion graphics directly.
//!
//! See `DOCS/14-MAPPING-LAYER-SPEC.md` for the design intent.

use crate::frame::{BandHits, BandPresence, EnergyData};
use crate::norm::NormBands;

/// Number of bins in the juiced-FFT output.
pub const JUICED_FFT_BINS: usize = 96;

/// Lowest/highest frequencies we remap into the juiced FFT (Hz).
const JFFT_F_LOW: f32 = 20.0;
const JFFT_F_HIGH: f32 = 20_000.0;

// ── Presence tuning ─────────────────────────────────────────
/// Attack time constant for per-band presence (s).
const PRESENCE_ATTACK_TAU: f32 = 0.2;
/// Release time constant for per-band presence (s).
const PRESENCE_RELEASE_TAU: f32 = 1.5;
/// Soft-compression knee for presence on normalised energy:
/// `y = x (1 + k) / (x + k)`, so 1 stays 1 and quiet bands are lifted.
const PRESENCE_KNEE: f32 = 0.35;

// ── Hits tuning ─────────────────────────────────────────────
/// Decay time constant for per-band hits (s).
const HIT_DECAY_TAU: f32 = 0.08;
/// Gain applied to normalised band flux above the adaptive threshold.
const HIT_FLUX_GAIN: f32 = 3.2;
/// Multiplier on hit strength when it re-triggers the envelope.
const HIT_STRENGTH_BOOST: f32 = 1.0;
/// Adaptive hit threshold: running mean + this many standard deviations.
const HIT_THRESHOLD_STD: f32 = 1.2;
/// Absolute minimum normalised flux for a hit.
const HIT_MIN_FLUX: f32 = 0.05;
/// Smoothing factor for the flux mean/variance trackers.
const HIT_STATS_ALPHA: f32 = 0.06;

// ── Fade-in-out tuning ──────────────────────────────────────
/// RMS threshold below which audio is considered silent.
const SILENCE_THRESHOLD: f32 = 0.005;
/// Rise rate per second when audio is present.
const FADE_RISE_RATE: f32 = 0.3;
/// Fall rate per second when audio is silent.
const FADE_FALL_RATE: f32 = 0.15;

// ── Intensity tuning ────────────────────────────────────────
const INTENSITY_ATTACK_TAU: f32 = 4.0;
const INTENSITY_RELEASE_TAU: f32 = 6.0;
/// Energy value above which short-term energy counts as "full" (absolute term).
const INTENSITY_ENERGY_CEIL: f32 = 0.3;
/// Normalised energy above which a band counts as "active".
const INTENSITY_BAND_ACTIVE_THRESHOLD: f32 = 0.25;
/// Half-life of the loudness reference used by the relative term (s).
const INTENSITY_REF_HALF_LIFE_S: f32 = 45.0;
/// Floor for the loudness reference so near-silence is not normalised up.
const INTENSITY_REF_FLOOR: f32 = 0.02;
/// Weight of loudness relative to the track's own recent peak vs absolute.
const INTENSITY_RELATIVE_WEIGHT: f32 = 0.7;

// ── Juiced FFT tuning ───────────────────────────────────────
/// Temporal IIR blend factor: `y = ALPHA * x + (1 - ALPHA) * y_prev`.
/// At 60 Hz with ALPHA=0.3 the effective τ is ~47 ms.
const JFFT_TEMPORAL_ALPHA: f32 = 0.3;
/// Per-frame decay of the running-max normalizer (≈12 s half-life at 60 Hz).
const JFFT_MAX_DECAY: f32 = 0.9995;
/// Amount added to each bin's gain at 15 kHz (high-end boost).
const JFFT_HIGH_BOOST: f32 = 0.6;
/// Low edge of the high-end boost ramp (Hz).
const JFFT_BOOST_F_LOW: f32 = 2000.0;
/// High edge of the high-end boost ramp (Hz).
const JFFT_BOOST_F_HIGH: f32 = 15_000.0;

/// Asymmetric exponential follower (fast attack, slow release, or vice versa).
#[derive(Clone, Copy, Default)]
struct AsymEnv {
    value: f32,
}

impl AsymEnv {
    fn update(&mut self, target: f32, dt: f32, tau_attack: f32, tau_release: f32) -> f32 {
        let tau = if target > self.value {
            tau_attack
        } else {
            tau_release
        };
        let alpha = 1.0 - (-dt / tau.max(1e-4)).exp();
        self.value += alpha * (target - self.value);
        self.value
    }
}

/// Peak-hold + exponential-decay follower for transient "hit" signals.
#[derive(Clone, Copy, Default)]
struct HitEnv {
    value: f32,
}

impl HitEnv {
    fn update(&mut self, raw: f32, dt: f32) -> f32 {
        if raw > self.value {
            self.value = (raw * HIT_STRENGTH_BOOST).min(1.0);
        } else {
            self.value *= (-dt / HIT_DECAY_TAU).exp();
            if self.value < 1e-4 {
                self.value = 0.0;
            }
        }
        self.value
    }
}

/// Output of the mapping layer for a single frame.
pub struct MappingOutput {
    pub fade_in_out: f32,
    pub intensity: f32,
    pub presence: BandPresence,
    pub hits: BandHits,
    pub juiced_fft: Vec<f32>,
}

/// The mapping layer owns envelope / normalizer state across frames.
pub struct MappingLayer {
    // Band state
    presence_env: [AsymEnv; 7],
    hit_env: [HitEnv; 7],
    flux_mean: [f32; 7],
    flux_var: [f32; 7],

    // Globals
    fade_in_out: f32,
    intensity_env: AsymEnv,
    loudness_ref: f32,

    // Juiced FFT
    jfft_bin_ranges: Vec<(usize, usize)>,
    jfft_boost: Vec<f32>,
    jfft_smoothed: Vec<f32>,
    jfft_running_max: f32,

    // Scratch buffers to avoid allocation in the hot path.
    jfft_scratch: Vec<f32>,
    jfft_scratch_blurred: Vec<f32>,
}

impl MappingLayer {
    pub fn new(sample_rate: f32, fft_size: usize) -> Self {
        // Each FFT bin covers `freq_resolution` Hz, over `fft_size/2` positive bins.
        let num_bins = fft_size / 2;
        let freq_resolution = sample_rate / fft_size as f32;
        let max_freq = (sample_rate / 2.0).min(JFFT_F_HIGH);
        let log_ratio = (max_freq / JFFT_F_LOW).ln();

        let mut jfft_bin_ranges = Vec::with_capacity(JUICED_FFT_BINS);
        let mut jfft_boost = Vec::with_capacity(JUICED_FFT_BINS);

        for i in 0..JUICED_FFT_BINS {
            let f_low = JFFT_F_LOW * ((i as f32 / JUICED_FFT_BINS as f32) * log_ratio).exp();
            let f_high =
                JFFT_F_LOW * (((i + 1) as f32 / JUICED_FFT_BINS as f32) * log_ratio).exp();
            let bin_low = ((f_low / freq_resolution) as usize).min(num_bins - 1);
            let mut bin_high = ((f_high / freq_resolution) as usize).min(num_bins - 1);
            if bin_high < bin_low {
                bin_high = bin_low;
            }
            jfft_bin_ranges.push((bin_low, bin_high));

            // High-end boost — smoothstep from 2 kHz → 15 kHz
            let center_freq = 0.5 * (f_low + f_high);
            let t = ((center_freq - JFFT_BOOST_F_LOW)
                / (JFFT_BOOST_F_HIGH - JFFT_BOOST_F_LOW))
                .clamp(0.0, 1.0);
            let smooth = t * t * (3.0 - 2.0 * t);
            jfft_boost.push(1.0 + JFFT_HIGH_BOOST * smooth);
        }

        Self {
            presence_env: [AsymEnv::default(); 7],
            hit_env: [HitEnv::default(); 7],
            flux_mean: [0.0; 7],
            flux_var: [0.0; 7],
            fade_in_out: 0.0,
            intensity_env: AsymEnv::default(),
            loudness_ref: INTENSITY_REF_FLOOR,
            jfft_bin_ranges,
            jfft_boost,
            jfft_smoothed: vec![0.0; JUICED_FFT_BINS],
            jfft_running_max: 1e-6,
            jfft_scratch: vec![0.0; JUICED_FFT_BINS],
            jfft_scratch_blurred: vec![0.0; JUICED_FFT_BINS],
        }
    }

    /// Run one frame of the mapping layer.
    ///
    /// `motion_density` is passed in from `mod.rs` to avoid duplicating its
    /// computation; it contributes to the intensity signal.
    pub fn process(
        &mut self,
        magnitudes_db: &[f32],
        norm: &NormBands,
        energy: &EnergyData,
        motion_density: f32,
        dt: f32,
    ) -> MappingOutput {
        // ── Presence ────────────────────────────────────────
        let mut presence = [0.0_f32; 7];
        for i in 0..7 {
            let x = norm.energy[i];
            let compressed = x * (1.0 + PRESENCE_KNEE) / (x + PRESENCE_KNEE);
            let smoothed = self.presence_env[i].update(
                compressed,
                dt,
                PRESENCE_ATTACK_TAU,
                PRESENCE_RELEASE_TAU,
            );
            presence[i] = smoothed.clamp(0.0, 1.0);
        }

        // ── Hits ────────────────────────────────────────────
        let mut hits = [0.0_f32; 7];
        let mut active_band_count = 0_u32;
        for i in 0..7 {
            let flux = norm.flux[i];
            let diff = flux - self.flux_mean[i];
            self.flux_mean[i] += HIT_STATS_ALPHA * diff;
            self.flux_var[i] += HIT_STATS_ALPHA * (diff * diff - self.flux_var[i]);
            let threshold = (self.flux_mean[i] + HIT_THRESHOLD_STD * self.flux_var[i].sqrt())
                .max(HIT_MIN_FLUX);
            let event_strength = if flux > threshold {
                (flux * HIT_FLUX_GAIN).clamp(0.0, 1.0)
            } else {
                0.0
            };
            hits[i] = self.hit_env[i].update(event_strength, dt).clamp(0.0, 1.0);

            if norm.energy[i] > INTENSITY_BAND_ACTIVE_THRESHOLD {
                active_band_count += 1;
            }
        }

        // ── FadeInOut ───────────────────────────────────────
        if energy.instant > SILENCE_THRESHOLD {
            self.fade_in_out = (self.fade_in_out + FADE_RISE_RATE * dt).min(1.0);
        } else {
            self.fade_in_out = (self.fade_in_out - FADE_FALL_RATE * dt).max(0.0);
        }
        // Smoothstep for cinematic shaping
        let x = self.fade_in_out.clamp(0.0, 1.0);
        let fade_in_out_out = x * x * (3.0 - 2.0 * x);

        // ── Intensity ───────────────────────────────────────
        let ref_decay = 0.5_f32.powf(dt / INTENSITY_REF_HALF_LIFE_S);
        self.loudness_ref = (self.loudness_ref * ref_decay)
            .max(energy.short_term)
            .max(INTENSITY_REF_FLOOR);
        let relative = (energy.short_term / self.loudness_ref).clamp(0.0, 1.0);
        let absolute = (energy.short_term / INTENSITY_ENERGY_CEIL).clamp(0.0, 1.0);
        let energy_term = INTENSITY_RELATIVE_WEIGHT * relative
            + (1.0 - INTENSITY_RELATIVE_WEIGHT) * absolute;
        let band_term = active_band_count as f32 / 7.0;
        let activity = 0.55 * energy_term + 0.25 * motion_density + 0.20 * band_term;
        let intensity = self
            .intensity_env
            .update(
                activity.clamp(0.0, 1.0),
                dt,
                INTENSITY_ATTACK_TAU,
                INTENSITY_RELEASE_TAU,
            )
            .clamp(0.0, 1.0);

        // ── Juiced FFT ──────────────────────────────────────
        self.process_juiced_fft(magnitudes_db);

        MappingOutput {
            fade_in_out: fade_in_out_out,
            intensity,
            presence: BandPresence {
                sub_bass: presence[0],
                bass: presence[1],
                low_mid: presence[2],
                mid: presence[3],
                upper_mid: presence[4],
                high: presence[5],
                air: presence[6],
            },
            hits: BandHits {
                sub_bass: hits[0],
                bass: hits[1],
                low_mid: hits[2],
                mid: hits[3],
                upper_mid: hits[4],
                high: hits[5],
                air: hits[6],
            },
            juiced_fft: self.jfft_smoothed.clone(),
        }
    }

    fn process_juiced_fft(&mut self, magnitudes_db: &[f32]) {
        // Step 1: log-frequency resample into linear magnitude.
        let num_bins = magnitudes_db.len();
        for i in 0..JUICED_FFT_BINS {
            let (bin_low, bin_high) = self.jfft_bin_ranges[i];
            if bin_low >= num_bins {
                self.jfft_scratch[i] = 0.0;
                continue;
            }
            let end = bin_high.min(num_bins - 1);
            let mut sum_lin = 0.0_f32;
            let mut count = 0_u32;
            for &db in &magnitudes_db[bin_low..=end] {
                // dB → linear
                sum_lin += 10.0_f32.powf(db / 20.0);
                count += 1;
            }
            let avg = if count > 0 {
                sum_lin / count as f32
            } else {
                0.0
            };
            // Apply high-end boost in linear domain
            self.jfft_scratch[i] = avg * self.jfft_boost[i];
        }

        // Step 2: temporal IIR smoothing per bin.
        for i in 0..JUICED_FFT_BINS {
            self.jfft_smoothed[i] = JFFT_TEMPORAL_ALPHA * self.jfft_scratch[i]
                + (1.0 - JFFT_TEMPORAL_ALPHA) * self.jfft_smoothed[i];
        }

        // Step 3: 3-bin moving average (copy-at-edges).
        let n = JUICED_FFT_BINS;
        self.jfft_scratch_blurred[0] =
            (self.jfft_smoothed[0] + self.jfft_smoothed[0] + self.jfft_smoothed[1]) / 3.0;
        self.jfft_scratch_blurred[n - 1] = (self.jfft_smoothed[n - 2]
            + self.jfft_smoothed[n - 1]
            + self.jfft_smoothed[n - 1])
            / 3.0;
        for i in 1..n - 1 {
            self.jfft_scratch_blurred[i] = (self.jfft_smoothed[i - 1]
                + self.jfft_smoothed[i]
                + self.jfft_smoothed[i + 1])
                / 3.0;
        }
        // Commit the blurred values back into jfft_smoothed so state persists.
        self.jfft_smoothed
            .copy_from_slice(&self.jfft_scratch_blurred);

        // Step 4: running-max normalization.
        let mut frame_max = self.jfft_running_max * JFFT_MAX_DECAY;
        for &v in self.jfft_smoothed.iter() {
            if v > frame_max {
                frame_max = v;
            }
        }
        self.jfft_running_max = frame_max.max(1e-6);
        let inv = 1.0 / self.jfft_running_max;
        for v in self.jfft_smoothed.iter_mut() {
            *v = (*v * inv).clamp(0.0, 1.0);
        }
    }
}
