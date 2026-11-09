//! The full analysis chain behind one type, plus a streaming wrapper that
//! decides when a new frame is due.

use crate::archetypes::ArchetypeClassifier;
use crate::bands::BandExtractor;
use crate::beat::BeatTracker;
use crate::buffer::AudioBuffer;
use crate::elements::ElementDetector;
use crate::energy::EnergyTracker;
use crate::fft::{bins_to_bars, FftProcessor};
use crate::frame::AudioFeatureFrame;
use crate::mapping::MappingLayer;
use crate::mood::{compute_motion_density, MoodAnalyzer};
use crate::norm::BandNormalizer;
use crate::onsets::OnsetDetector;
use crate::spectral::SpectralAnalyzer;

/// Analysis window length (samples).
pub const FFT_SIZE: usize = 4096;
/// Number of log-spaced bars in `spectrum_bars`.
pub const NUM_BARS: usize = 128;
/// Frames per second of audio the analyzer produces.
pub const ANALYSIS_RATE: f32 = 60.0;
/// Ring-buffer capacity used by [`StreamAnalyzer`].
const STREAM_BUFFER_CAPACITY: usize = 16384;
/// Upper bound on frames produced per `next_frame` burst after a stall.
const MAX_BACKLOG_HOPS: usize = 4;
/// Onset-detection-function weights over normalised band flux
/// (sub, bass, low-mid, then the mean of mid..air).
const ODF_WEIGHTS: [f32; 4] = [0.45, 0.3, 0.1, 0.15];

/// Samples of audio between two analysis frames at `sample_rate`.
pub fn hop_size(sample_rate: u32) -> usize {
    ((sample_rate as f32 / ANALYSIS_RATE).round() as usize).max(1)
}

/// Owns every stage of the pipeline. One instance per sample rate; recreate
/// it when the capture device (and therefore the rate) changes.
pub struct Analyzer {
    fft_proc: FftProcessor,
    samples: Vec<f32>,
    magnitudes_db: Vec<f32>,
    bars: Vec<f32>,
    band_ext: BandExtractor,
    normalizer: BandNormalizer,
    spectral_an: SpectralAnalyzer,
    energy_tr: EnergyTracker,
    onset_det: OnsetDetector,
    beat_tr: BeatTracker,
    element_det: ElementDetector,
    archetype_cl: ArchetypeClassifier,
    mood_an: MoodAnalyzer,
    mapping: MappingLayer,
    sample_rate: u32,
}

impl Analyzer {
    pub fn new(sample_rate: u32) -> Self {
        let sr = sample_rate as f32;
        Self {
            fft_proc: FftProcessor::new(FFT_SIZE),
            samples: vec![0.0; FFT_SIZE],
            magnitudes_db: vec![0.0; FFT_SIZE / 2],
            bars: vec![0.0; NUM_BARS],
            band_ext: BandExtractor::new(sr, FFT_SIZE),
            normalizer: BandNormalizer::new(),
            spectral_an: SpectralAnalyzer::new(sr, FFT_SIZE),
            energy_tr: EnergyTracker::new(),
            onset_det: OnsetDetector::new(),
            beat_tr: BeatTracker::new(ANALYSIS_RATE),
            element_det: ElementDetector::new(),
            archetype_cl: ArchetypeClassifier::new(),
            mood_an: MoodAnalyzer::new(),
            mapping: MappingLayer::new(sr, FFT_SIZE),
            sample_rate,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.sample_rate
    }

    /// The analysis window. Fill it with the latest `FFT_SIZE` mono samples
    /// (oldest first), then call [`Analyzer::analyze`].
    pub fn window_mut(&mut self) -> &mut [f32] {
        &mut self.samples
    }

    /// Run the whole chain over the current window.
    pub fn analyze(&mut self) -> AudioFeatureFrame {
        let dt = 1.0 / ANALYSIS_RATE;
        let sample_rate = self.sample_rate as f32;

        // Layer 1: signal processing
        self.fft_proc.process(&self.samples, &mut self.magnitudes_db);
        bins_to_bars(&self.magnitudes_db, NUM_BARS, sample_rate, &mut self.bars);
        let bands = self.band_ext.process(&self.magnitudes_db);
        let spectral = self.spectral_an.process(&self.magnitudes_db);
        let energy = self.energy_tr.process(&self.samples, dt);
        let norm = self.normalizer.process(&bands, dt);

        // Layer 2: musical features
        let onsets = self.onset_det.process(&bands);
        let f = &norm.flux;
        let odf = ODF_WEIGHTS[0] * f[0]
            + ODF_WEIGHTS[1] * f[1]
            + ODF_WEIGHTS[2] * f[2]
            + ODF_WEIGHTS[3] * (f[3] + f[4] + f[5] + f[6]) * 0.25;
        let beat = self.beat_tr.process(odf, dt);
        let elements = self
            .element_det
            .process(&bands, &onsets, spectral.centroid, dt);
        let rhythm = self.archetype_cl.process(&elements, &beat, dt);

        // Layer 3: mood
        let mood = self.mood_an.process(&spectral, &energy, &onsets, dt);
        let motion_density = compute_motion_density(&onsets, &energy, &spectral);

        // Layer 4: mapping
        let m = self.mapping.process(
            &self.magnitudes_db,
            &norm,
            &energy,
            motion_density,
            dt,
        );

        AudioFeatureFrame {
            bands,
            spectral,
            energy,
            beat,
            rhythm,
            elements,
            mood,
            motion_density,
            spectrum_bars: round_vec(&self.bars),
            fade_in_out: round_f32(m.fade_in_out),
            intensity: round_f32(m.intensity),
            presence: m.presence,
            hits: m.hits,
            juiced_fft: round_vec(&m.juiced_fft),
        }
    }
}

/// Analyzer + ring buffer + hop scheduling. Push PCM in any block size; pull
/// frames out at exactly [`ANALYSIS_RATE`] per second of audio.
pub struct StreamAnalyzer {
    analyzer: Analyzer,
    buffer: AudioBuffer,
    hop: usize,
    pending: usize,
}

impl StreamAnalyzer {
    pub fn new(sample_rate: u32) -> Self {
        Self {
            analyzer: Analyzer::new(sample_rate),
            buffer: AudioBuffer::new(STREAM_BUFFER_CAPACITY),
            hop: hop_size(sample_rate),
            pending: 0,
        }
    }

    pub fn sample_rate(&self) -> u32 {
        self.analyzer.sample_rate()
    }

    pub fn hop(&self) -> usize {
        self.hop
    }

    /// Append mono samples.
    pub fn push(&mut self, samples: &[f32]) {
        self.buffer.write_slice(samples);
        self.pending = (self.pending + samples.len()).min(self.hop * MAX_BACKLOG_HOPS);
    }

    /// Produce the next frame if at least one hop of new audio has arrived.
    pub fn next_frame(&mut self) -> Option<AudioFeatureFrame> {
        if self.pending < self.hop {
            return None;
        }
        self.pending -= self.hop;
        self.buffer.read_latest(self.analyzer.window_mut());
        Some(self.analyzer.analyze())
    }
}

fn round_f32(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}

fn round_vec(v: &[f32]) -> Vec<f32> {
    v.iter().map(|x| round_f32(*x)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn produces_one_frame_per_hop() {
        let mut s = StreamAnalyzer::new(48_000);
        assert_eq!(s.hop(), 800);
        s.push(&vec![0.0; 799]);
        assert!(s.next_frame().is_none());
        s.push(&[0.0]);
        assert!(s.next_frame().is_some());
        assert!(s.next_frame().is_none());
    }

    #[test]
    fn sine_lands_in_the_right_band() {
        let sr = 44_100;
        let mut s = StreamAnalyzer::new(sr);
        let mut last = None;
        let mut phase = 0.0_f32;
        for _ in 0..120 {
            let block: Vec<f32> = (0..s.hop())
                .map(|_| {
                    phase += 2.0 * std::f32::consts::PI * 1000.0 / sr as f32;
                    0.5 * phase.sin()
                })
                .collect();
            s.push(&block);
            if let Some(f) = s.next_frame() {
                last = Some(f);
            }
        }
        let f = last.expect("frames");
        assert!(f.presence.mid > f.presence.sub_bass);
        assert!(f.presence.mid > f.presence.air);
        assert!(f.fade_in_out > 0.0);
        let json = serde_json::to_string(&f).unwrap();
        assert!(json.contains("juiced_fft"));
    }
}
