pub mod capture;
pub mod commands;
pub mod devices;

use capture::{default_output_device, find_pinned_device, start_capture_on};
use devices::{DevicePreference, DeviceState};
use parking_lot::Mutex;
use sonora_dsp::{hop_size, Analyzer, AudioBuffer};
use std::sync::atomic::{AtomicBool, Ordering};
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
/// No samples for this long → reopen capture on the current target. Catches
/// streams that died silently (endpoint invalidated without a name change,
/// e.g. a 3.5 mm jack re-routing the same Realtek device). Reopening during
/// genuine silence is harmless.
const WATCHDOG_MS: u128 = 3000;
/// WASAPI loopback delivers no packets while nothing plays. After this long
/// without samples, feed silence so analysis keeps running and visuals decay
/// instead of freezing on the last frame.
const SILENCE_FILL_MS: u128 = 120;

/// An analysis frame with the capture clock at the end of its window (sample
/// frames since start; recordings time the picture by it).
#[derive(serde::Serialize)]
struct Stamped<'a, F: serde::Serialize> {
    #[serde(flatten)]
    frame: &'a F,
    clock: u64,
}

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
    failed: Arc<AtomicBool>,
    started: Instant,
}

fn run_pipeline(
    app_handle: tauri::AppHandle,
    device_state: Arc<DeviceState>,
) -> Result<(), String> {
    let buffer = Arc::new(Mutex::new(AudioBuffer::new(BUFFER_CAPACITY)));

    // Development builds only: SONORA_FAKE_CAPTURE=<16-bit wav> feeds a file through the
    // capture path in real time instead of the speakers (recording sync checks, silently).
    #[cfg(debug_assertions)]
    if let Ok(path) = std::env::var("SONORA_FAKE_CAPTURE") {
        return fake::run(app_handle, buffer, &path);
    }

    let mut active: Option<ActiveCapture> = None;
    let mut analysis: Option<Analyzer> = None;

    // Debounce: if the desired device has been different from the active one
    // for at least DEVICE_DEBOUNCE_MS, swap. Reset whenever it changes again.
    let mut pending_change: Option<(String, Instant)> = None;
    // `None` forces a poll on the first tick.
    let mut last_poll: Option<Instant> = None;
    let mut last_samples = Instant::now();
    let mut last_fill = Instant::now();
    let silence = vec![0.0_f32; 2048];

    loop {
        std::thread::sleep(Duration::from_millis(16));

        let now = Instant::now();

        // Recover a dead or stalled stream on the same target device.
        let restart = match &active {
            Some(a) => {
                a.failed.load(Ordering::Relaxed)
                    || (now.duration_since(last_samples).as_millis() >= WATCHDOG_MS
                        && now.duration_since(a.started).as_millis() >= WATCHDOG_MS)
            }
            None => false,
        };
        if restart {
            reopen(&app_handle, &device_state, &buffer, &mut active, &mut analysis);
            last_samples = now;
        }

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
        let mut new_count = buffer.lock().new_sample_count();
        if new_count > 0 {
            last_samples = now;
        } else if now.duration_since(last_samples).as_millis() >= SILENCE_FILL_MS
            && now.duration_since(last_fill).as_millis() >= 16
        {
            // Nothing arriving: analyse silence at the normal hop rate.
            {
                let mut b = buffer.lock();
                b.write_slice(&silence[..hop.min(silence.len())]);
                crate::out::record::on_silence(hop.min(silence.len()));
            }
            last_fill = now;
            new_count = hop;
        }
        if new_count < hop {
            continue;
        }
        let clock = {
            let mut b = buffer.lock();
            b.read_latest(analysis.window_mut());
            crate::out::record::CLOCK.load(Ordering::Relaxed)
        };
        let frame = analysis.analyze();
        let _ = app_handle.emit("audio-frame", &Stamped { frame: &frame, clock });
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
        DevicePreference::Pinned { id, name } => find_pinned_device(id, name),
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

/// Reopen capture after a stream error or a stall. Same device → quiet reopen
/// that keeps analysis state; a different target goes through the normal swap.
fn reopen(
    app_handle: &tauri::AppHandle,
    device_state: &DeviceState,
    buffer: &Arc<Mutex<AudioBuffer>>,
    active: &mut Option<ActiveCapture>,
    analysis: &mut Option<Analyzer>,
) {
    let Some(prev) = active.as_ref() else { return };
    let failed = prev.failed.load(Ordering::Relaxed);
    let prev_name = prev.device_name.clone();
    let target = match device_state.preference() {
        DevicePreference::Default => default_output_device(),
        DevicePreference::Pinned { id, name } => find_pinned_device(&id, &name),
    };
    let Some(target) = target else {
        // Nothing to capture from; the poll loop reports it and retries.
        *active = None;
        return;
    };
    let same = target.1 == prev_name;
    if failed {
        println!("Audio stream on {prev_name} failed; reopening on {}", target.1);
    }
    apply_swap_inner(app_handle, device_state, buffer, active, analysis, target, same && !failed);
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
    apply_swap_inner(app_handle, device_state, buffer, active, analysis, target, false);
}

fn apply_swap_inner(
    app_handle: &tauri::AppHandle,
    device_state: &DeviceState,
    buffer: &Arc<Mutex<AudioBuffer>>,
    active: &mut Option<ActiveCapture>,
    analysis: &mut Option<Analyzer>,
    target: (cpal::Device, String),
    quiet: bool,
) {
    let (device, name) = target;
    let previous = active.take().map(|a| a.device_name);
    buffer.lock().clear();
    let failed = Arc::new(AtomicBool::new(false));

    match start_capture_on(&device, Arc::clone(buffer), Arc::clone(&failed)) {
        Ok((stream, sample_rate)) => {
            if !quiet {
                match &previous {
                    Some(prev) => println!(
                        "Audio device changed: {prev} → {name} ({sample_rate} Hz)"
                    ),
                    None => println!("Audio capture started on {name} ({sample_rate} Hz)"),
                }
            }
            // Keep analysis state (tempo, envelopes, events) across a reopen
            // at the same rate so recovery is seamless.
            if analysis.as_ref().map(|a| a.sample_rate()) != Some(sample_rate) {
                *analysis = Some(Analyzer::new(sample_rate));
            }
            *active = Some(ActiveCapture {
                _stream: stream,
                device_name: name.clone(),
                failed,
                started: Instant::now(),
            });
            device_state.set_current(name.clone());
            if !quiet {
                let _ = app_handle.emit("audio-device-changed", &name);
            }
        }
        Err(e) => {
            *analysis = None;
            eprintln!("Failed to start capture on {name}: {e}");
            device_state.set_current(String::new());
            let _ = app_handle.emit("audio-device-changed", "");
        }
    }
}

#[cfg(debug_assertions)]
mod fake {
    //! A WAV file played into the capture path at real-time pace (development builds only).
    use super::*;

    fn read_wav(path: &str) -> Result<(u32, usize, Vec<f32>), String> {
        let b = std::fs::read(path).map_err(|e| e.to_string())?;
        let (mut p, mut rate, mut ch, mut data) = (12usize, 48000u32, 2usize, None);
        while p + 8 <= b.len() {
            let id = &b[p..p + 4];
            let len = u32::from_le_bytes([b[p + 4], b[p + 5], b[p + 6], b[p + 7]]) as usize;
            if id == b"fmt " {
                ch = u16::from_le_bytes([b[p + 10], b[p + 11]]) as usize;
                rate = u32::from_le_bytes([b[p + 12], b[p + 13], b[p + 14], b[p + 15]]);
            }
            if id == b"data" {
                data = Some(&b[p + 8..(p + 8 + len).min(b.len())]);
            }
            p += 8 + len + (len % 2);
        }
        let d = data.ok_or("no data chunk")?;
        Ok((rate, ch, d.chunks_exact(2).map(|x| i16::from_le_bytes([x[0], x[1]]) as f32 / 32768.0).collect()))
    }

    pub fn run(app_handle: tauri::AppHandle, buffer: Arc<Mutex<AudioBuffer>>, path: &str) -> Result<(), String> {
        let (rate, ch, pcm) = read_wav(path)?;
        crate::out::record::RATE.store(rate, Ordering::Relaxed);
        let mut analysis = Analyzer::new(rate);
        let name = format!("file: {}", std::path::Path::new(path).file_name().and_then(|n| n.to_str()).unwrap_or("?"));
        eprintln!("Fake capture from {name} ({rate} Hz, {ch} ch)");
        let _ = app_handle.emit("audio-device-changed", &name);
        let start = Instant::now();
        let frames_total = pcm.len() / ch;
        let mut fed = 0usize;
        loop {
            std::thread::sleep(Duration::from_millis(5));
            // Deliver what real time says is due, in whole 10 ms packets (as WASAPI does).
            let due = (start.elapsed().as_secs_f64() * rate as f64) as usize;
            let packet = (rate / 100) as usize;
            while fed + packet <= due {
                let mut b = buffer.lock();
                let mut chunk = Vec::with_capacity(packet * ch);
                for k in 0..packet {
                    let i = (fed + k) % frames_total;
                    let s = &pcm[i * ch..i * ch + ch];
                    b.write_one(s.iter().sum::<f32>() / ch as f32);
                    chunk.extend_from_slice(s);
                }
                crate::out::record::on_capture(&chunk, ch);
                fed += packet;
                drop(b);
            }
            let hop = hop_size(rate);
            if buffer.lock().new_sample_count() < hop {
                continue;
            }
            let clock = {
                let mut b = buffer.lock();
                b.read_latest(analysis.window_mut());
                crate::out::record::CLOCK.load(Ordering::Relaxed)
            };
            let frame = analysis.analyze();
            let _ = app_handle.emit("audio-frame", &Stamped { frame: &frame, clock });
        }
    }
}
