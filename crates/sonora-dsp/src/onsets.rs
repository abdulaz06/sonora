use crate::frame::Bands;

/// Per-band onset detection result.
#[derive(Clone, Default)]
pub struct OnsetFrame {
    pub sub_bass: OnsetBand,
    pub bass: OnsetBand,
    pub low_mid: OnsetBand,
    pub mid: OnsetBand,
    pub upper_mid: OnsetBand,
    pub high: OnsetBand,
    pub air: OnsetBand,
}

#[derive(Clone, Copy, Default)]
pub struct OnsetBand {
    pub detected: bool,
    pub strength: f32,
}

/// Spectral flux onset detector with adaptive thresholding per band.
pub struct OnsetDetector {
    /// Running mean of flux per band (for adaptive threshold).
    flux_mean: [f32; 7],
    /// Running variance of flux per band.
    flux_var: [f32; 7],
    /// Smoothing factor for adaptive threshold.
    alpha: f32,
    /// Multiplier above mean for onset threshold.
    threshold_mult: f32,
}

impl Default for OnsetDetector {
    fn default() -> Self {
        Self::new()
    }
}

impl OnsetDetector {
    pub fn new() -> Self {
        Self {
            flux_mean: [0.0; 7],
            flux_var: [0.0; 7],
            alpha: 0.08,           // faster adaptation (was 0.05)
            threshold_mult: 0.8,   // much more sensitive (was 1.5)
        }
    }

    /// Detect onsets from band flux values.
    pub fn process(&mut self, bands: &Bands) -> OnsetFrame {
        let fluxes = [
            bands.sub_bass.flux,
            bands.bass.flux,
            bands.low_mid.flux,
            bands.mid.flux,
            bands.upper_mid.flux,
            bands.high.flux,
            bands.air.flux,
        ];

        let mut results = [OnsetBand::default(); 7];

        for (i, &flux) in fluxes.iter().enumerate() {
            // Update running statistics
            let diff = flux - self.flux_mean[i];
            self.flux_mean[i] += self.alpha * diff;
            self.flux_var[i] += self.alpha * (diff * diff - self.flux_var[i]);

            let std_dev = self.flux_var[i].sqrt();
            let threshold = self.flux_mean[i] + self.threshold_mult * std_dev;

            // Very low minimum gate so quiet content still triggers
            let detected = flux > threshold && flux > 0.001;
            let strength = if detected {
                ((flux - threshold) / (std_dev + 1e-6)).clamp(0.0, 1.0)
            } else {
                0.0
            };

            results[i] = OnsetBand { detected, strength };
        }

        OnsetFrame {
            sub_bass: results[0],
            bass: results[1],
            low_mid: results[2],
            mid: results[3],
            upper_mid: results[4],
            high: results[5],
            air: results[6],
        }
    }
}
