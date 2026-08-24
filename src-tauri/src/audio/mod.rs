pub mod archetypes;
pub mod bands;
pub mod beat;
pub mod capture;
pub mod commands;
pub mod devices;
pub mod elements;
pub mod energy;
pub mod fft;
pub mod frame;
pub mod mapping;
pub mod mood;
pub mod onsets;
pub mod spectral;

use archetypes::ArchetypeClassifier;
use bands::BandExtractor;
use beat::BeatTracker;
use capture::{
    default_output_device, find_output_device_by_name, start_capture_on, AudioBuffer,
};
use devices::{DevicePreference, DeviceState};
use elements::ElementDetector;
use energy::EnergyTracker;
use fft::{bins_to_bars, FftProcessor};
use frame::AudioFeatureFrame;
use mapping::MappingLayer;
use mood::{compute_motion_density, MoodAnalyzer};
use onsets::OnsetDetector;
use parking_lot::Mutex;
use spectral::SpectralAnalyzer;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

const FFT_SIZE: usize = 4096;
const BUFFER_CAPACITY: usize = 16384;
const NUM_BARS: usize = 128;
const MIN_HOP: usize = 735;
const TARGET_FPS: f32 = 60.0;

/// How often the pipeline polls for default-device changes (ms).
const DEVICE_POLL_INTERVAL_MS: u128 = 1000;
/// Stable-for window before applying a hot device swap (ms). Avoids thrashing
/// when the user plug/unplugs in quick succession.
const DEVICE_DEBOUNCE_MS: u128 = 500;

/// Start the audio capture and processing pipeline.
pub fn start(app_handle: tauri::AppHandle, device_state: Arc<DeviceState>) {
    std::thread::spawn(move || {
        if let Err(e) = run_pipeline(app_handle, device_state) {
            eprintln!("Audio pipeline error: {e}");
        }
    });
}

/// Owned by the pipeline thread. Lives as long as a single capture session;
/// torn down + recreated on every device switch (so per-stream-rate state
/// like band-bin indices and per-frame envelopes start fresh).
struct AnalysisState {
    fft_proc: FftProcessor,
    samples: Vec<f32>,
    magnitudes_db: Vec<f32>,
    bars: Vec<f32>,
    band_ext: BandExtractor,
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

impl AnalysisState {
    fn new(sample_rate: u32) -> Self {
        let sr = sample_rate as f32;
        Self {
            fft_proc: FftProcessor::new(FFT_SIZE),
            samples: vec![0.0_f32; FFT_SIZE],
            magnitudes_db: vec![0.0_f32; FFT_SIZE / 2],
            bars: vec![0.0_f32; NUM_BARS],
            band_ext: BandExtractor::new(sr, FFT_SIZE),
            spectral_an: SpectralAnalyzer::new(sr, FFT_SIZE),
            energy_tr: EnergyTracker::new(),
            onset_det: OnsetDetector::new(),
            beat_tr: BeatTracker::new(TARGET_FPS),
            element_det: ElementDetector::new(),
            archetype_cl: ArchetypeClassifier::new(),
            mood_an: MoodAnalyzer::new(),
            mapping: MappingLayer::new(sr, FFT_SIZE),
            sample_rate,
        }
    }
}

/// Live capture session. The cpal `Stream` is `!Send` on Windows, so it lives
/// for the entire pipeline thread and is dropped/recreated in place on swap.
struct ActiveCapture {
    _stream: cpal::Stream,
    device_name: String,
}

fn run_pipeline(
    app_handle: tauri::AppHandle,
    device_state: Arc<DeviceState>,
) -> Result<(), String> {
    let buffer = Arc::new(Mutex::new(AudioBuffer::new(BUFFER_CAPACITY)));

    let mut active: Option<ActiveCapture> = None;
    let mut analysis: Option<AnalysisState> = None;

    // Debounce: if the desired device has been different from the active one
    // for at least DEVICE_DEBOUNCE_MS, swap. Reset whenever it changes again.
    let mut pending_change: Option<(String, Instant)> = None;
    // `None` forces a poll on the first tick.
    let mut last_poll: Option<Instant> = None;

    let dt = 1.0 / TARGET_FPS;

    loop {
        std::thread::sleep(Duration::from_millis(16));

        let now = Instant::now();
        let due = last_poll
            .map(|t| now.duration_since(t).as_millis() >= DEVICE_POLL_INTERVAL_MS)
            .unwrap_or(true);
        if due {
            last_poll = Some(now);
            try_apply_device(
                &app_handle,
                &device_state,
                &buffer,
                &mut active,
                &mut analysis,
                &mut pending_change,
                now,
            );
        }

        let analysis = match (&active, &mut analysis) {
            (Some(_), Some(an)) => an,
            _ => continue,
        };

        let new_count = {
            let buf = buffer.lock();
            buf.new_sample_count()
        };

        if new_count < MIN_HOP {
            continue;
        }

        {
            let mut buf = buffer.lock();
            buf.read_latest(&mut analysis.samples);
        }

        let sample_rate = analysis.sample_rate as f32;

        // Layer 1: Signal processing
        analysis
            .fft_proc
            .process(&analysis.samples, &mut analysis.magnitudes_db);
        bins_to_bars(
            &analysis.magnitudes_db,
            NUM_BARS,
            sample_rate,
            &mut analysis.bars,
        );

        let bands = analysis.band_ext.process(&analysis.magnitudes_db);
        let spectral = analysis.spectral_an.process(&analysis.magnitudes_db);
        let energy = analysis.energy_tr.process(&analysis.samples, dt);

        // Layer 2: Musical features
        let onsets = analysis.onset_det.process(&bands);
        let beat = analysis.beat_tr.process(&onsets, dt);
        let elements = analysis
            .element_det
            .process(&bands, &onsets, spectral.centroid, dt);
        let rhythm = analysis.archetype_cl.process(&elements, &beat, dt);

        // Layer 3: State / mood
        let mood = analysis.mood_an.process(&spectral, &energy, &onsets, dt);
        let motion_density = compute_motion_density(&onsets, &energy, &spectral);

        // Layer 4: Mapping — art-ready control signals
        let mapping_out = analysis.mapping.process(
            &analysis.magnitudes_db,
            &bands,
            &onsets,
            &energy,
            motion_density,
            dt,
        );

        let frame = AudioFeatureFrame {
            bands,
            spectral,
            energy,
            beat,
            rhythm,
            elements,
            mood,
            motion_density,
            spectrum_bars: round_vec(&analysis.bars),
            fade_in_out: round_f32(mapping_out.fade_in_out),
            intensity: round_f32(mapping_out.intensity),
            presence: mapping_out.presence,
            hits: mapping_out.hits,
            juiced_fft: round_vec(&mapping_out.juiced_fft),
        };

        let _ = app_handle.emit("audio-frame", &frame);
    }
}

/// Resolve the user's preferred device, debounce, and (re)start capture if
/// the target has changed. Called from the pipeline thread only.
fn try_apply_device(
    app_handle: &tauri::AppHandle,
    device_state: &DeviceState,
    buffer: &Arc<Mutex<AudioBuffer>>,
    active: &mut Option<ActiveCapture>,
    analysis: &mut Option<AnalysisState>,
    pending_change: &mut Option<(String, Instant)>,
    now: Instant,
) {
    let preference = device_state.preference();

    let target = match &preference {
        DevicePreference::Default => default_output_device(),
        DevicePreference::Pinned(name) => find_output_device_by_name(name),
    };

    let target_name = target.as_ref().map(|(_, n)| n.clone());
    let current_name = active.as_ref().map(|a| a.device_name.clone());

    match (target_name, current_name) {
        // Already on the right device — clear any pending swap.
        (Some(tn), Some(cn)) if tn == cn => {
            *pending_change = None;
        }
        // No device available at all — drop any active stream and retry next tick.
        (None, _) => {
            if let Some(prev) = active.take() {
                eprintln!(
                    "Audio device unavailable (was {}). Will retry.",
                    prev.device_name
                );
                *analysis = None;
                buffer.lock().clear();
                device_state.set_current(String::new());
                let _ = app_handle.emit("audio-device-changed", "");
            }
            *pending_change = None;
        }
        // Cold start: nothing active, target available — go immediately.
        (Some(_), None) => {
            *pending_change = None;
            apply_swap(
                app_handle,
                device_state,
                buffer,
                active,
                analysis,
                target.unwrap(),
            );
        }
        // Hot swap: active stream on a different device — debounce.
        (Some(tn), Some(_)) => {
            let stable = match pending_change {
                Some((name, t)) if *name == tn => {
                    now.duration_since(*t).as_millis() >= DEVICE_DEBOUNCE_MS
                }
                _ => {
                    *pending_change = Some((tn.clone(), now));
                    false
                }
            };
            if stable {
                *pending_change = None;
                apply_swap(
                    app_handle,
                    device_state,
                    buffer,
                    active,
                    analysis,
                    target.unwrap(),
                );
            }
        }
    }
}

/// Drop the current stream, build a new one on `target`, reset analysis state,
/// and notify the frontend. On failure, leaves `active`/`analysis` clear so the
/// next tick will retry.
fn apply_swap(
    app_handle: &tauri::AppHandle,
    device_state: &DeviceState,
    buffer: &Arc<Mutex<AudioBuffer>>,
    active: &mut Option<ActiveCapture>,
    analysis: &mut Option<AnalysisState>,
    target: (cpal::Device, String),
) {
    let (device, name) = target;
    let previous = active.take().map(|a| a.device_name);
    *analysis = None;
    buffer.lock().clear();

    match start_capture_on(&device, Arc::clone(buffer)) {
        Ok((stream, sample_rate)) => {
            match &previous {
                Some(prev) => println!(
                    "Audio device changed: {prev} → {name} ({sample_rate} Hz)"
                ),
                None => println!("Audio capture started on {name} ({sample_rate} Hz)"),
            }
            *analysis = Some(AnalysisState::new(sample_rate));
            *active = Some(ActiveCapture {
                _stream: stream,
                device_name: name.clone(),
            });
            device_state.set_current(name.clone());
            let _ = app_handle.emit("audio-device-changed", &name);
        }
        Err(e) => {
            eprintln!("Failed to start capture on {name}: {e}");
            device_state.set_current(String::new());
            let _ = app_handle.emit("audio-device-changed", "");
        }
    }
}

fn round_f32(v: f32) -> f32 {
    (v * 1000.0).round() / 1000.0
}

fn round_vec(v: &[f32]) -> Vec<f32> {
    v.iter().map(|x| (x * 1000.0).round() / 1000.0).collect()
}
