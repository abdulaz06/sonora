use crate::audio::frame::BeatData;
use crate::audio::onsets::OnsetFrame;

const ONSET_HISTORY_SIZE: usize = 512;
const MIN_BPM: f32 = 60.0;
const MAX_BPM: f32 = 200.0;

pub struct BeatTracker {
    /// History of bass onset strengths (ring buffer).
    onset_history: Vec<f32>,
    onset_write_pos: usize,
    /// Current BPM estimate.
    bpm: f32,
    /// Smoothed BPM for stability.
    bpm_smooth: f32,
    /// Beat phase (0.0–1.0 within current beat).
    phase: f32,
    /// Time since last detected beat (seconds).
    time_since_beat: f32,
    /// Expected beat interval in seconds.
    beat_interval: f32,
    /// Confidence in current beat tracking.
    confidence: f32,
    /// Analysis rate (frames per second).
    fps: f32,
    /// Frames since last autocorrelation.
    frames_since_acf: usize,
}

impl BeatTracker {
    pub fn new(fps: f32) -> Self {
        Self {
            onset_history: vec![0.0; ONSET_HISTORY_SIZE],
            onset_write_pos: 0,
            bpm: 120.0,
            bpm_smooth: 120.0,
            phase: 0.0,
            time_since_beat: 0.0,
            beat_interval: 0.5, // 120 BPM default
            confidence: 0.0,
            fps,
            frames_since_acf: 0,
        }
    }

    pub fn process(&mut self, onsets: &OnsetFrame, dt: f32) -> BeatData {
        // Combine bass onsets for beat tracking
        let onset_strength =
            onsets.sub_bass.strength * 0.5 + onsets.bass.strength * 0.3 + onsets.low_mid.strength * 0.2;

        // Record onset in history
        self.onset_history[self.onset_write_pos] = onset_strength;
        self.onset_write_pos = (self.onset_write_pos + 1) % ONSET_HISTORY_SIZE;

        // Run autocorrelation periodically (~every 2 seconds)
        self.frames_since_acf += 1;
        if self.frames_since_acf >= (self.fps * 2.0) as usize {
            self.frames_since_acf = 0;
            self.update_tempo();
        }

        // Advance phase
        self.time_since_beat += dt;
        self.phase = if self.beat_interval > 0.0 {
            (self.time_since_beat / self.beat_interval).fract()
        } else {
            0.0
        };

        // Detect beat onset: phase wraps around (close to 0) and there's an onset
        let beat_onset = onset_strength > 0.3
            && (self.phase < 0.15 || self.phase > 0.85)
            && self.time_since_beat > self.beat_interval * 0.6;

        if beat_onset {
            self.time_since_beat = 0.0;
            self.phase = 0.0;
        }

        BeatData {
            bpm: self.bpm_smooth,
            phase: self.phase,
            onset: beat_onset,
            confidence: self.confidence,
        }
    }

    fn update_tempo(&mut self) {
        let min_lag = (self.fps * 60.0 / MAX_BPM) as usize; // lag for MAX_BPM
        let max_lag = (self.fps * 60.0 / MIN_BPM) as usize; // lag for MIN_BPM
        let max_lag = max_lag.min(ONSET_HISTORY_SIZE / 2);

        if min_lag >= max_lag {
            return;
        }

        // Autocorrelation of onset history
        let mut best_lag = min_lag;
        let mut best_corr = 0.0_f32;
        let mut total_corr = 0.0_f32;

        for lag in min_lag..max_lag {
            let mut corr = 0.0_f32;
            let mut count = 0;
            for i in 0..(ONSET_HISTORY_SIZE - lag) {
                let idx_a = (self.onset_write_pos + ONSET_HISTORY_SIZE - 1 - i) % ONSET_HISTORY_SIZE;
                let idx_b = (idx_a + ONSET_HISTORY_SIZE - lag) % ONSET_HISTORY_SIZE;
                corr += self.onset_history[idx_a] * self.onset_history[idx_b];
                count += 1;
            }
            if count > 0 {
                corr /= count as f32;
            }
            total_corr += corr;
            if corr > best_corr {
                best_corr = corr;
                best_lag = lag;
            }
        }

        let avg_corr = total_corr / (max_lag - min_lag) as f32;
        let new_bpm = self.fps * 60.0 / best_lag as f32;

        // Confidence based on how strong the autocorrelation peak is vs average
        self.confidence = if avg_corr > 1e-6 {
            ((best_corr / avg_corr - 1.0) / 3.0).clamp(0.0, 1.0)
        } else {
            0.0
        };

        if self.confidence > 0.15 {
            self.bpm = new_bpm;
            // Smooth BPM transitions
            self.bpm_smooth += 0.1 * (self.bpm - self.bpm_smooth);
            self.beat_interval = 60.0 / self.bpm_smooth;
        }
    }
}
