use crate::audio::frame::{BandData, Bands};

/// Frequency ranges for the 7 musically meaningful bands.
const BAND_RANGES: [(f32, f32); 7] = [
    (20.0, 60.0),      // sub_bass
    (60.0, 250.0),     // bass
    (250.0, 500.0),    // low_mid
    (500.0, 2000.0),   // mid
    (2000.0, 4000.0),  // upper_mid
    (4000.0, 8000.0),  // high
    (8000.0, 20000.0), // air
];

pub struct BandExtractor {
    sample_rate: f32,
    fft_size: usize,
    prev_energies: [f32; 7],
}

impl BandExtractor {
    pub fn new(sample_rate: f32, fft_size: usize) -> Self {
        Self {
            sample_rate,
            fft_size,
            prev_energies: [0.0; 7],
        }
    }

    /// Extract band energies from the magnitude spectrum (positive frequencies, in dB).
    pub fn process(&mut self, magnitudes_db: &[f32]) -> Bands {
        let num_bins = magnitudes_db.len();
        let freq_resolution = self.sample_rate / self.fft_size as f32;
        let mut band_array = [BandData::default(); 7];

        for (band_idx, &(f_low, f_high)) in BAND_RANGES.iter().enumerate() {
            let bin_low = (f_low / freq_resolution) as usize;
            let bin_high = ((f_high / freq_resolution) as usize).min(num_bins - 1);

            if bin_low >= num_bins || bin_low > bin_high {
                continue;
            }

            let mut sum_sq = 0.0_f32;
            let mut peak = f32::NEG_INFINITY;

            for bin in bin_low..=bin_high {
                // Convert dB back to linear for RMS calculation
                let linear = 10.0_f32.powf(magnitudes_db[bin] / 20.0);
                sum_sq += linear * linear;
                if magnitudes_db[bin] > peak {
                    peak = magnitudes_db[bin];
                }
            }

            let count = (bin_high - bin_low + 1) as f32;
            let rms = (sum_sq / count).sqrt();
            // Normalize to 0–1: rms is in linear scale, roughly 0..1
            let energy = rms.min(1.0);
            // Normalize peak: map -80..0 dB → 0..1
            let peak_norm = ((peak + 80.0) / 80.0).clamp(0.0, 1.0);
            // Spectral flux: change in energy from previous frame
            let flux = (energy - self.prev_energies[band_idx]).max(0.0);
            self.prev_energies[band_idx] = energy;

            band_array[band_idx] = BandData {
                energy,
                peak: peak_norm,
                flux,
            };
        }

        // Destructure into named fields — array index matches BAND_RANGES order
        Bands {
            sub_bass: band_array[0].clone(),
            bass: band_array[1].clone(),
            low_mid: band_array[2].clone(),
            mid: band_array[3].clone(),
            upper_mid: band_array[4].clone(),
            high: band_array[5].clone(),
            air: band_array[6].clone(),
        }
    }
}
