pub mod capture;
pub mod commands;
pub mod devices;

use capture::{default_output_device, find_output_device_by_name, start_capture_on};
use devices::{DevicePreference, DeviceState};
use parking_lot::Mutex;
use sonora_dsp::{hop_size, Analyzer, AudioBuffer};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::Emitter;

/// Ring-buffer capacity shared with the capture callback (samples).
const BUFFER_CAPACITY: usize = 16384;

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
    let mut analysis: Option<Analyzer> = None;

    // Debounce: if the desired device has been different from the active one
    // for at least DEVICE_DEBOUNCE_MS, swap. Reset whenever it changes again.
    let mut pending_change: Option<(String, Instant)> = None;
    // `None` forces a poll on the first tick.
    let mut last_poll: Option<Instant> = None;

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

        let hop = hop_size(analysis.sample_rate());
        let new_count = buffer.lock().new_sample_count();
        if new_count < hop {
            continue;
        }
        buffer.lock().read_latest(analysis.window_mut());
        let frame = analysis.analyze();
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
    analysis: &mut Option<Analyzer>,
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
    analysis: &mut Option<Analyzer>,
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
            *analysis = Some(Analyzer::new(sample_rate));
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
