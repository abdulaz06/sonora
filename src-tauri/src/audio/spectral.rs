use crate::audio::frame::SpectralFeatures;

pub struct SpectralAnalyzer {
    sample_rate: f32,
    fft_size: usize,
}

impl SpectralAnalyzer {
    pub fn new(sample_rate: f32, fft_size: usize) -> Self {
        Self {
            sample_rate,
            fft_size,
        }
    }

    /// Compute spectral features from the magnitude spectrum (dB scale).
    pub fn process(&self, magnitudes_db: &[f32]) -> SpectralFeatures {
        let num_bins = magnitudes_db.len();
        let freq_resolution = self.sample_rate / self.fft_size as f32;

        // Convert to linear magnitudes for the calculations
        let linear: Vec<f32> = magnitudes_db
            .iter()
            .map(|&db| 10.0_f32.powf(db / 20.0))
            .collect();

        let total_energy: f32 = linear.iter().map(|&m| m * m).sum();

        if total_energy < 1e-12 {
            return SpectralFeatures::default();
        }

        let total_magnitude: f32 = linear.iter().sum();
        let nyquist = self.sample_rate / 2.0;

        // Spectral centroid: weighted average frequency
        let mut weighted_sum = 0.0_f32;
        for (i, &mag) in linear.iter().enumerate() {
            weighted_sum += i as f32 * freq_resolution * mag;
        }
        let centroid = if total_magnitude > 1e-12 {
            weighted_sum / total_magnitude
        } else {
            0.0
        };
        let centroid_norm = (centroid / nyquist).clamp(0.0, 1.0);

        // Spectral spread: standard deviation around centroid
        let mut spread_sum = 0.0_f32;
        for (i, &mag) in linear.iter().enumerate() {
            let freq = i as f32 * freq_resolution;
            let diff = freq - centroid;
            spread_sum += diff * diff * mag;
        }
        let spread = if total_magnitude > 1e-12 {
            (spread_sum / total_magnitude).sqrt()
        } else {
            0.0
        };
        let spread_norm = (spread / nyquist).clamp(0.0, 1.0);

        // Spectral flatness: geometric mean / arithmetic mean
        // Use log domain for numerical stability
        let log_sum: f32 = linear
            .iter()
            .map(|&m| (m.max(1e-10)).ln())
            .sum();
        let log_mean = log_sum / num_bins as f32;
        let geometric_mean = log_mean.exp();
        let arithmetic_mean = total_magnitude / num_bins as f32;
        let flatness = if arithmetic_mean > 1e-12 {
            (geometric_mean / arithmetic_mean).clamp(0.0, 1.0)
        } else {
            0.0
        };

        // Spectral rolloff: frequency below which 85% of energy sits
        let threshold = total_energy * 0.85;
        let mut cumulative = 0.0_f32;
        let mut rolloff_bin = num_bins - 1;
        for (i, &mag) in linear.iter().enumerate() {
            cumulative += mag * mag;
            if cumulative >= threshold {
                rolloff_bin = i;
                break;
            }
        }
        let rolloff = rolloff_bin as f32 * freq_resolution;
        let rolloff_norm = (rolloff / nyquist).clamp(0.0, 1.0);

        SpectralFeatures {
            centroid: centroid_norm,
            spread: spread_norm,
            flatness,
            rolloff: rolloff_norm,
        }
    }
}
