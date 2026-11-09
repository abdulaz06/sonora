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

const zeroBands = (): BandPresence => ({ sub_bass: 0, bass: 0, low_mid: 0, mid: 0, upper_mid: 0, high: 0, air: 0 });
const zeroBand = (): BandData => ({ energy: 0, peak: 0, flux: 0 });

/** A silent frame, used before the first real frame arrives. */
export function emptyFrame(): AudioFeatureFrame {
  return {
    bands: {
      sub_bass: zeroBand(), bass: zeroBand(), low_mid: zeroBand(), mid: zeroBand(),
      upper_mid: zeroBand(), high: zeroBand(), air: zeroBand(),
    },
    spectral: { centroid: 0, spread: 0, flatness: 0, rolloff: 0 },
    energy: { instant: 0, short_term: 0, long_term: 0, ratio: 0, dynamic_range: 0 },
    beat: { bpm: 120, phase: 0, onset: false, confidence: 0 },
    rhythm: { four_on_floor: 0, half_time_heavy: 0, backbeat_groove: 0, broken_beat: 0, syncopated_dance: 0, ambient_free: 0 },
    elements: {
      kick: { presence: 0, energy: 0 }, snare: { presence: 0, energy: 0 }, hihat: { presence: 0, energy: 0 },
      bass: { presence: 0, energy: 0 }, vocal: { presence: 0, energy: 0 }, pad: { presence: 0, energy: 0 },
      lead: { presence: 0, energy: 0 },
    },
    mood: { warmth: 0, brightness: 0, aggression: 0, smoothness: 0, spaciousness: 0 },
    motion_density: 0,
    spectrum_bars: new Array<number>(128).fill(0),
    fade_in_out: 0,
    intensity: 0,
    presence: zeroBands(),
    hits: zeroBands(),
    juiced_fft: new Array<number>(96).fill(0),
  };
}
