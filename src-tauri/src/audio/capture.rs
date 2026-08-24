use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;

/// Pre-allocated circular buffer for audio samples (mono f32).
pub struct AudioBuffer {
    data: Vec<f32>,
    write_pos: usize,
    new_samples: usize,
    capacity: usize,
}

impl AudioBuffer {
    pub fn new(capacity: usize) -> Self {
        Self {
            data: vec![0.0; capacity],
            write_pos: 0,
            new_samples: 0,
            capacity,
        }
    }

    /// Write a single mono sample. Called from the audio callback.
    pub fn write_one(&mut self, sample: f32) {
        self.data[self.write_pos] = sample;
        self.write_pos = (self.write_pos + 1) % self.capacity;
        self.new_samples = (self.new_samples + 1).min(self.capacity);
    }

    /// Number of new samples since last read.
    pub fn new_sample_count(&self) -> usize {
        self.new_samples
    }

    /// Read the latest `count` samples into `out`. Resets new sample counter.
    pub fn read_latest(&mut self, out: &mut [f32]) {
        let count = out.len().min(self.capacity);
        let start = (self.write_pos + self.capacity - count) % self.capacity;
        for i in 0..count {
            out[i] = self.data[(start + i) % self.capacity];
        }
        self.new_samples = 0;
    }

    /// Discard accumulated samples (called on device switch so the next FFT
    /// frame doesn't mix audio from two different devices).
    pub fn clear(&mut self) {
        for s in self.data.iter_mut() {
            *s = 0.0;
        }
        self.write_pos = 0;
        self.new_samples = 0;
    }
}

/// Public-facing description of an output device for the device picker UI.
/// `id` is currently the device name — cpal doesn't expose stable IDs.
#[derive(Clone, Debug, Serialize)]
pub struct DeviceInfo {
    pub id: String,
    pub name: String,
}

/// Get the current default output device along with its display name.
/// Returns `None` if there's no default device or its name can't be read.
pub fn default_output_device() -> Option<(cpal::Device, String)> {
    let host = cpal::default_host();
    let device = host.default_output_device()?;
    let name = device.name().ok()?;
    Some((device, name))
}

/// Find an output device by name. Returns `None` if no such device exists
/// (e.g. user pinned a device that has since been unplugged).
pub fn find_output_device_by_name(name: &str) -> Option<(cpal::Device, String)> {
    let host = cpal::default_host();
    let devices = host.output_devices().ok()?;
    for d in devices {
        if let Ok(n) = d.name() {
            if n == name {
                return Some((d, n));
            }
        }
    }
    None
}

/// Enumerate all output devices for the device picker.
pub fn list_output_devices() -> Vec<DeviceInfo> {
    let host = cpal::default_host();
    let mut out = Vec::new();
    if let Ok(devices) = host.output_devices() {
        for d in devices {
            if let Ok(name) = d.name() {
                out.push(DeviceInfo {
                    id: name.clone(),
                    name,
                });
            }
        }
    }
    out
}

/// Start WASAPI loopback capture on the supplied output device.
/// The returned `Stream` is `!Send` on Windows — keep it on the thread that
/// created it for its entire lifetime.
pub fn start_capture_on(
    device: &cpal::Device,
    buffer: Arc<Mutex<AudioBuffer>>,
) -> Result<(cpal::Stream, u32), String> {
    let config = device
        .default_output_config()
        .map_err(|e| format!("Failed to get output config: {e}"))?;

    let sample_rate = config.sample_rate().0;
    let channels = config.channels() as usize;
    let stream_config: cpal::StreamConfig = config.config();

    let stream = device
        .build_input_stream(
            &stream_config,
            move |data: &[f32], _info: &cpal::InputCallbackInfo| {
                let mut buf = buffer.lock();
                // Convert to mono by averaging channels
                for chunk in data.chunks(channels) {
                    let mono: f32 = chunk.iter().sum::<f32>() / channels as f32;
                    buf.write_one(mono);
                }
            },
            |err| {
                eprintln!("Audio stream error: {err}");
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {e}"))?;

    Ok((stream, sample_rate))
}
