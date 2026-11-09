use serde::Serialize;

/// Per-band audio energy data.
#[derive(Clone, Copy, Default, Serialize)]
pub struct BandData {
    pub energy: f32,
    pub peak: f32,
    pub flux: f32,
}

/// All 7 frequency bands.
#[derive(Clone, Default, Serialize)]
pub struct Bands {
    pub sub_bass: BandData,
    pub bass: BandData,
    pub low_mid: BandData,
    pub mid: BandData,
    pub upper_mid: BandData,
    pub high: BandData,
    pub air: BandData,
}

/// Spectral shape features.
#[derive(Clone, Default, Serialize)]
pub struct SpectralFeatures {
    pub centroid: f32,
    pub spread: f32,
    pub flatness: f32,
    pub rolloff: f32,
}

/// Multi-timescale energy tracking.
#[derive(Clone, Default, Serialize)]
pub struct EnergyData {
    pub instant: f32,
    pub short_term: f32,
    pub long_term: f32,
    pub ratio: f32,
    pub dynamic_range: f32,
}

/// Beat and tempo information.
#[derive(Clone, Default, Serialize)]
pub struct BeatData {
    pub bpm: f32,
    pub phase: f32,
    pub onset: bool,
    pub confidence: f32,
}

/// Soft classification across 6 rhythmic archetypes.
#[derive(Clone, Default, Serialize)]
pub struct RhythmData {
    pub four_on_floor: f32,
    pub half_time_heavy: f32,
    pub backbeat_groove: f32,
    pub broken_beat: f32,
    pub syncopated_dance: f32,
    pub ambient_free: f32,
}

/// Estimated presence and energy of a musical element.
#[derive(Clone, Default, Serialize)]
pub struct ElementData {
    pub presence: f32,
    pub energy: f32,
}

/// All detected musical elements.
#[derive(Clone, Default, Serialize)]
pub struct Elements {
    pub kick: ElementData,
    pub snare: ElementData,
    pub hihat: ElementData,
    pub bass: ElementData,
    pub vocal: ElementData,
    pub pad: ElementData,
    pub lead: ElementData,
}

/// Mood signals derived from spectral/energy characteristics.
#[derive(Clone, Default, Serialize)]
pub struct MoodData {
    pub warmth: f32,
    pub brightness: f32,
    pub aggression: f32,
    pub smoothness: f32,
    pub spaciousness: f32,
}

/// Per-band sustained-energy signal (mapping layer).
/// Slow attack (~200ms) / slow release (~1–2s). Stays high during sustained
/// vocals, pads, bass lines. Does not spike on individual transients.
#[derive(Clone, Default, Serialize)]
pub struct BandPresence {
    pub sub_bass: f32,
    pub bass: f32,
    pub low_mid: f32,
    pub mid: f32,
    pub upper_mid: f32,
    pub high: f32,
    pub air: f32,
}

/// Per-band transient signal (mapping layer).
/// Instant attack, ~80ms decay. Spikes on onset events per band.
#[derive(Clone, Default, Serialize)]
pub struct BandHits {
    pub sub_bass: f32,
    pub bass: f32,
    pub low_mid: f32,
    pub mid: f32,
    pub upper_mid: f32,
    pub high: f32,
    pub air: f32,
}

/// The complete audio analysis output sent to the frontend each frame.
#[derive(Clone, Default, Serialize)]
pub struct AudioFeatureFrame {
    pub bands: Bands,
    pub spectral: SpectralFeatures,
    pub energy: EnergyData,
    pub beat: BeatData,
    pub rhythm: RhythmData,
    pub elements: Elements,
    pub mood: MoodData,
    pub motion_density: f32,
    /// Spectrum bars for visualization (128 log-frequency bars, 0–1).
    pub spectrum_bars: Vec<f32>,

    // ── Mapping layer: art-ready control signals ──
    /// Global scene visibility gate (0 = silent, 1 = fully active).
    /// Rise ~3s, fall ~6s. Replaces the old silence handler.
    pub fade_in_out: f32,
    /// Long-window song intensity (0–1). Drives macro size/density.
    pub intensity: f32,
    /// Per-band sustained energy signal.
    pub presence: BandPresence,
    /// Per-band transient spike signal.
    pub hits: BandHits,
    /// Processed log-frequency spectrum (96 bins, 0–1).
    pub juiced_fft: Vec<f32>,
}
