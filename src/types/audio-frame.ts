export interface BandData {
  energy: number;
  peak: number;
  flux: number;
}

export interface Bands {
  sub_bass: BandData;
  bass: BandData;
  low_mid: BandData;
  mid: BandData;
  upper_mid: BandData;
  high: BandData;
  air: BandData;
}

export interface SpectralFeatures {
  centroid: number;
  spread: number;
  flatness: number;
  rolloff: number;
}

export interface EnergyData {
  instant: number;
  short_term: number;
  long_term: number;
  ratio: number;
  dynamic_range: number;
}

export interface BeatData {
  bpm: number;
  phase: number;
  onset: boolean;
  confidence: number;
}

export interface RhythmData {
  four_on_floor: number;
  half_time_heavy: number;
  backbeat_groove: number;
  broken_beat: number;
  syncopated_dance: number;
  ambient_free: number;
}

export interface ElementData {
  presence: number;
  energy: number;
}

export interface Elements {
  kick: ElementData;
  snare: ElementData;
  hihat: ElementData;
  bass: ElementData;
  vocal: ElementData;
  pad: ElementData;
  lead: ElementData;
}

export interface MoodData {
  warmth: number;
  brightness: number;
  aggression: number;
  smoothness: number;
  spaciousness: number;
}

/** Per-band sustained-energy signal (mapping layer). */
export interface BandPresence {
  sub_bass: number;
  bass: number;
  low_mid: number;
  mid: number;
  upper_mid: number;
  high: number;
  air: number;
}

/** Per-band transient signal (mapping layer). */
export interface BandHits {
  sub_bass: number;
  bass: number;
  low_mid: number;
  mid: number;
  upper_mid: number;
  high: number;
  air: number;
}

export interface AudioFeatureFrame {
  bands: Bands;
  spectral: SpectralFeatures;
  energy: EnergyData;
  beat: BeatData;
  rhythm: RhythmData;
  elements: Elements;
  mood: MoodData;
  motion_density: number;
  spectrum_bars: number[];

  // ── Mapping layer: art-ready control signals ──
  /** Global scene visibility (0 = silent, 1 = fully active). */
  fade_in_out: number;
  /** Long-window song intensity (0–1). Drives macro size/density. */
  intensity: number;
  /** Per-band sustained energy. */
  presence: BandPresence;
  /** Per-band transient spikes. */
  hits: BandHits;
  /** Processed log-frequency spectrum (96 bins, 0–1). */
  juiced_fft: number[];
}
