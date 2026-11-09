use crate::audio::frame::EnergyData;

pub struct EnergyTracker {
    short_term: f32,
    long_term: f32,
    recent_peak: f32,
    peak_decay: f32,
}

impl EnergyTracker {
    pub fn new() -> Self {
        Self {
            short_term: 0.0,
            long_term: 0.0,
            recent_peak: 0.0,
            peak_decay: 0.999,
        }
    }

    /// Update energy tracking from raw audio samples.
    /// `dt` is the time delta in seconds since last frame.
    pub fn process(&mut self, samples: &[f32], dt: f32) -> EnergyData {
        // Instantaneous RMS energy
        let sum_sq: f32 = samples.iter().map(|&s| s * s).sum();
        let instant = (sum_sq / samples.len() as f32).sqrt();

        // Smoothed short-term (~0.5s) and long-term (~5s)
        let short_alpha = 1.0 - (-dt / 0.5_f32).exp();
        let long_alpha = 1.0 - (-dt / 5.0_f32).exp();
        self.short_term += short_alpha * (instant - self.short_term);
        self.long_term += long_alpha * (instant - self.long_term);

        // Track recent peak with slow decay
        if instant > self.recent_peak {
            self.recent_peak = instant;
        } else {
            self.recent_peak *= self.peak_decay;
        }

        // Energy ratio: short/long (>1 = building, <1 = releasing)
        let ratio = if self.long_term > 1e-6 {
            self.short_term / self.long_term
        } else {
            1.0
        };

        // Dynamic range: difference between peak and average
        let dynamic_range = if self.short_term > 1e-6 {
            (self.recent_peak / self.short_term).clamp(1.0, 10.0) / 10.0
        } else {
            0.0
        };

        EnergyData {
            instant: instant.min(1.0),
            short_term: self.short_term.min(1.0),
            long_term: self.long_term.min(1.0),
            ratio: ratio.clamp(0.0, 3.0) / 3.0, // normalize to 0-1
            dynamic_range,
        }
    }
}
