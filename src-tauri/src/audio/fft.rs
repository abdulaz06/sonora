use rustfft::{num_complex::Complex, FftPlanner};
use std::sync::Arc;

/// FFT processor with pre-allocated buffers and Hann window.
pub struct FftProcessor {
    fft: Arc<dyn rustfft::Fft<f32>>,
    window: Vec<f32>,
    scratch: Vec<Complex<f32>>,
    fft_input: Vec<Complex<f32>>,
    size: usize,
}

impl FftProcessor {
    pub fn new(size: usize) -> Self {
        let mut planner = FftPlanner::new();
        let fft = planner.plan_fft_forward(size);
        let scratch_len = fft.get_inplace_scratch_len();

        // Pre-compute Hann window
        let window: Vec<f32> = (0..size)
            .map(|i| {
                let x = std::f32::consts::PI * 2.0 * i as f32 / size as f32;
                0.5 * (1.0 - x.cos())
            })
            .collect();

        Self {
            fft,
            window,
            scratch: vec![Complex::default(); scratch_len],
            fft_input: vec![Complex::default(); size],
            size,
        }
    }

    /// Run FFT on `samples` (must be exactly `self.size` long).
    /// Returns magnitude spectrum in dB (positive frequencies only, length = size/2).
    pub fn process(&mut self, samples: &[f32], magnitudes_db: &mut [f32]) {
        assert_eq!(samples.len(), self.size);
        let half = self.size / 2;
        assert!(magnitudes_db.len() >= half);

        // Apply Hann window and convert to complex
        for i in 0..self.size {
            self.fft_input[i] = Complex {
                re: samples[i] * self.window[i],
                im: 0.0,
            };
        }

        // In-place FFT
        self.fft
            .process_with_scratch(&mut self.fft_input, &mut self.scratch);

        // Compute magnitude in dB for positive frequencies
        let norm = 1.0 / self.size as f32;
        for i in 0..half {
            let mag = self.fft_input[i].norm() * norm;
            // Convert to dB, clamp to reasonable range
            magnitudes_db[i] = (20.0 * mag.max(1e-10).log10()).max(-100.0);
        }
    }
}

/// Reduce FFT bins to `num_bars` using log-frequency spacing.
/// Returns values normalized to 0.0–1.0 range.
pub fn bins_to_bars(
    magnitudes_db: &[f32],
    num_bars: usize,
    sample_rate: f32,
    bars_out: &mut [f32],
) {
    let num_bins = magnitudes_db.len();
    let freq_resolution = sample_rate / (num_bins as f32 * 2.0);
    let min_freq: f32 = 20.0;
    let max_freq: f32 = 20_000.0_f32.min(sample_rate / 2.0);
    let log_ratio = (max_freq / min_freq).ln();

    for bar_idx in 0..num_bars {
        let f_low = min_freq * ((bar_idx as f32 / num_bars as f32) * log_ratio).exp();
        let f_high = min_freq * (((bar_idx + 1) as f32 / num_bars as f32) * log_ratio).exp();

        let bin_low = (f_low / freq_resolution) as usize;
        let bin_high = ((f_high / freq_resolution) as usize).min(num_bins - 1);

        if bin_low <= bin_high && bin_low < num_bins {
            let end = bin_high.min(num_bins - 1);
            let mut sum = 0.0_f32;
            let mut count = 0;
            for bin in bin_low..=end {
                sum += magnitudes_db[bin];
                count += 1;
            }
            let avg_db = sum / count as f32;
            // Normalize: map -80 dB..0 dB → 0.0..1.0
            bars_out[bar_idx] = ((avg_db + 80.0) / 80.0).clamp(0.0, 1.0);
        } else {
            bars_out[bar_idx] = 0.0;
        }
    }
}
