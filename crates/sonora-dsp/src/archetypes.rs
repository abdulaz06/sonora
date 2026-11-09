use crate::frame::{BeatData, Elements, RhythmData};

const HISTORY_SIZE: usize = 256;

pub struct ArchetypeClassifier {
    /// Rolling history of element presence for pattern analysis.
    kick_history: Vec<f32>,
    snare_history: Vec<f32>,
    hihat_history: Vec<f32>,
    write_pos: usize,
    /// Smoothed archetype weights.
    weights: [f32; 6],
}

impl Default for ArchetypeClassifier {
    fn default() -> Self {
        Self::new()
    }
}

impl ArchetypeClassifier {
    pub fn new() -> Self {
        Self {
            kick_history: vec![0.0; HISTORY_SIZE],
            snare_history: vec![0.0; HISTORY_SIZE],
            hihat_history: vec![0.0; HISTORY_SIZE],
            write_pos: 0,
            weights: [0.0; 6],
        }
    }

    pub fn process(
        &mut self,
        elements: &Elements,
        beat: &BeatData,
        dt: f32,
    ) -> RhythmData {
        // Record element history
        self.kick_history[self.write_pos] = elements.kick.energy;
        self.snare_history[self.write_pos] = elements.snare.energy;
        self.hihat_history[self.write_pos] = elements.hihat.energy;
        self.write_pos = (self.write_pos + 1) % HISTORY_SIZE;

        // Compute statistics over recent history
        let kick_density = density(&self.kick_history, 0.05);
        let kick_regularity = regularity(&self.kick_history, 0.05);
        let snare_density = density(&self.snare_history, 0.05);
        let hihat_density = density(&self.hihat_history, 0.05);
        let hihat_energy_avg = avg(&self.hihat_history);

        let has_beat = beat.confidence > 0.2;

        // Score each archetype
        let mut raw = [0.0_f32; 6];

        // Four-on-the-floor: high kick regularity, moderate hi-hat, clear beat
        raw[0] = kick_regularity * 0.5 + if has_beat { 0.3 } else { 0.0 }
            + if kick_density > 0.15 { 0.2 } else { 0.0 };

        // Half-time heavy: low kick density, some bass energy
        raw[1] = (1.0 - kick_density.min(0.3) / 0.3) * 0.4
            + if snare_density < 0.1 { 0.3 } else { 0.0 }
            + if has_beat { 0.1 } else { 0.2 };

        // Backbeat groove: moderate kick/snare, balanced
        raw[2] = if kick_density > 0.08 && snare_density > 0.05 { 0.5 } else { 0.0 }
            + if has_beat { 0.3 } else { 0.0 }
            + (1.0 - (kick_density - snare_density).abs().min(0.2) / 0.2) * 0.2;

        // Broken beat: irregular kick, dense hi-hats
        raw[3] = (1.0 - kick_regularity) * 0.3
            + if hihat_density > 0.3 { 0.4 } else { hihat_density }
            + if kick_density > 0.1 { 0.2 } else { 0.0 };

        // Syncopated dance: off-grid feel, moderate density
        raw[4] = (1.0 - kick_regularity) * 0.2
            + if hihat_energy_avg > 0.1 { 0.3 } else { 0.0 }
            + if has_beat { 0.2 } else { 0.0 }
            + if kick_density > 0.05 && kick_density < 0.2 { 0.3 } else { 0.0 };

        // Ambient/free: no clear beat, low onset density
        raw[5] = if !has_beat { 0.5 } else { 0.0 }
            + (1.0 - kick_density.min(0.2) / 0.2) * 0.3
            + (1.0 - hihat_density.min(0.2) / 0.2) * 0.2;

        // Normalize to sum to 1.0
        let sum: f32 = raw.iter().sum();
        if sum > 0.0 {
            for v in raw.iter_mut() {
                *v /= sum;
            }
        }

        // Smooth transitions
        let alpha = 1.0 - (-dt / 2.0).exp();
        for i in 0..6 {
            self.weights[i] += alpha * (raw[i] - self.weights[i]);
        }

        RhythmData {
            four_on_floor: self.weights[0],
            half_time_heavy: self.weights[1],
            backbeat_groove: self.weights[2],
            broken_beat: self.weights[3],
            syncopated_dance: self.weights[4],
            ambient_free: self.weights[5],
        }
    }
}

/// Fraction of samples above threshold.
fn density(history: &[f32], threshold: f32) -> f32 {
    let count = history.iter().filter(|&&v| v > threshold).count();
    count as f32 / history.len() as f32
}

/// Measure regularity via autocorrelation peak strength.
fn regularity(history: &[f32], threshold: f32) -> f32 {
    let binary: Vec<f32> = history.iter().map(|&v| if v > threshold { 1.0 } else { 0.0 }).collect();
    let n = binary.len();
    let mean: f32 = binary.iter().sum::<f32>() / n as f32;

    if mean < 0.01 {
        return 0.0;
    }

    let mut best_corr = 0.0_f32;
    // Check lags corresponding to 60–200 BPM at ~60fps
    for lag in 18..60 {
        let mut corr = 0.0_f32;
        let mut count = 0;
        for i in 0..(n - lag) {
            corr += (binary[i] - mean) * (binary[(i + lag) % n] - mean);
            count += 1;
        }
        if count > 0 {
            corr /= count as f32;
            if corr > best_corr {
                best_corr = corr;
            }
        }
    }

    // Normalize by variance
    let var: f32 = binary.iter().map(|&v| (v - mean) * (v - mean)).sum::<f32>() / n as f32;
    if var > 1e-6 {
        (best_corr / var).clamp(0.0, 1.0)
    } else {
        0.0
    }
}

fn avg(history: &[f32]) -> f32 {
    history.iter().sum::<f32>() / history.len() as f32
}
