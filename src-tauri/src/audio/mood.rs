use crate::audio::frame::{EnergyData, MoodData, SpectralFeatures};
use crate::audio::onsets::OnsetFrame;

pub struct MoodAnalyzer {
    warmth: f32,
    brightness: f32,
    aggression: f32,
    smoothness: f32,
    spaciousness: f32,
}

impl MoodAnalyzer {
    pub fn new() -> Self {
        Self {
            warmth: 0.5,
            brightness: 0.5,
            aggression: 0.0,
            smoothness: 0.5,
            spaciousness: 0.5,
        }
    }

    pub fn process(
        &mut self,
        spectral: &SpectralFeatures,
        energy: &EnergyData,
        onsets: &OnsetFrame,
        dt: f32,
    ) -> MoodData {
        let alpha = 1.0 - (-dt / 3.0).exp(); // ~3 second smoothing

        // Warmth: low spectral centroid, bass-heavy
        let warmth_raw = (1.0 - spectral.centroid) * 0.7 + (1.0 - spectral.rolloff) * 0.3;
        self.warmth += alpha * (warmth_raw - self.warmth);

        // Brightness: high spectral centroid, high-frequency energy
        let brightness_raw = spectral.centroid * 0.6 + spectral.rolloff * 0.4;
        self.brightness += alpha * (brightness_raw - self.brightness);

        // Aggression: high onset density, spectral flatness (noise-like)
        let onset_density = [
            onsets.sub_bass.strength,
            onsets.bass.strength,
            onsets.mid.strength,
            onsets.high.strength,
        ]
        .iter()
        .sum::<f32>()
            / 4.0;
        let aggression_raw = onset_density * 0.5 + spectral.flatness * 0.3 + energy.dynamic_range * 0.2;
        self.aggression += alpha * (aggression_raw - self.aggression);

        // Smoothness: low onset density, tonal content
        let smoothness_raw = (1.0 - onset_density) * 0.5 + (1.0 - spectral.flatness) * 0.5;
        self.smoothness += alpha * (smoothness_raw - self.smoothness);

        // Spaciousness: derived from spectral spread and low density
        let spaciousness_raw = spectral.spread * 0.5 + (1.0 - energy.instant.min(0.5) / 0.5) * 0.5;
        self.spaciousness += alpha * (spaciousness_raw - self.spaciousness);

        MoodData {
            warmth: self.warmth,
            brightness: self.brightness,
            aggression: self.aggression,
            smoothness: self.smoothness,
            spaciousness: self.spaciousness,
        }
    }
}

/// Compute motion density from onset/energy/spectral data.
pub fn compute_motion_density(
    onsets: &OnsetFrame,
    energy: &EnergyData,
    spectral: &SpectralFeatures,
) -> f32 {
    let onset_sum = onsets.sub_bass.strength
        + onsets.bass.strength
        + onsets.low_mid.strength
        + onsets.mid.strength
        + onsets.upper_mid.strength
        + onsets.high.strength
        + onsets.air.strength;
    let onset_density = (onset_sum / 7.0).min(1.0);

    let motion = onset_density * 0.4
        + energy.instant * 0.3
        + spectral.flatness * 0.15
        + spectral.centroid * 0.15;

    motion.clamp(0.0, 1.0)
}
