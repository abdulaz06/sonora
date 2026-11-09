//! Per-band adaptive normalisation.
//!
//! Raw band RMS spans two orders of magnitude between sub-bass and air in a
//! typical mix, so fixed thresholds either never fire on hi-hats or always
//! fire on kicks. Each band is divided by a slowly decaying running peak of
//! itself, floored by an absolute level so silence and hiss stay near zero.
//! The mapping layer and beat tracker consume these normalised values; the
//! raw `bands` in the frame are untouched.

use crate::frame::Bands;

// ── Tuning ──────────────────────────────────────────────────
/// Half-life of the running peak (s). Long enough that a breakdown still
/// reads as quieter than the drop before it.
const REF_HALF_LIFE_S: f32 = 30.0;
/// Absolute floor for each band's reference (raw RMS units). Below this the
/// band is treated as silent rather than amplified.
const REF_FLOOR: [f32; 7] = [0.004, 0.004, 0.002, 0.0012, 0.0006, 0.0003, 0.0002];
/// Gate under which normalised energy is pulled to zero (fraction of floor).
const NOISE_GATE: f32 = 0.15;

/// Normalised band energies (0–1) and their positive frame-to-frame change.
#[derive(Clone, Copy, Default)]
pub struct NormBands {
    pub energy: [f32; 7],
    pub flux: [f32; 7],
}

pub struct BandNormalizer {
    reference: [f32; 7],
    prev: [f32; 7],
}

impl Default for BandNormalizer {
    fn default() -> Self {
        Self::new()
    }
}

impl BandNormalizer {
    pub fn new() -> Self {
        Self {
            reference: REF_FLOOR,
            prev: [0.0; 7],
        }
    }

    pub fn process(&mut self, bands: &Bands, dt: f32) -> NormBands {
        let raw = band_array(bands);
        let decay = 0.5_f32.powf(dt / REF_HALF_LIFE_S);
        let mut out = NormBands::default();
        for i in 0..7 {
            let e = raw[i];
            self.reference[i] = (self.reference[i] * decay).max(e).max(REF_FLOOR[i]);
            let gated = (e - REF_FLOOR[i] * NOISE_GATE).max(0.0);
            let n = (gated / self.reference[i]).min(1.0);
            out.energy[i] = n;
            out.flux[i] = (n - self.prev[i]).max(0.0);
            self.prev[i] = n;
        }
        out
    }
}

pub fn band_array(b: &Bands) -> [f32; 7] {
    [
        b.sub_bass.energy,
        b.bass.energy,
        b.low_mid.energy,
        b.mid.energy,
        b.upper_mid.energy,
        b.high.energy,
        b.air.energy,
    ]
}
