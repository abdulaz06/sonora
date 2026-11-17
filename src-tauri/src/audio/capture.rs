use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use parking_lot::Mutex;
use serde::Serialize;
use sonora_dsp::AudioBuffer;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// Public-facing description of an output device for the device picker UI.
/// `id` is the stable Windows endpoint id (survives renames and reordering);
/// cpal opens devices by display name, so the id is resolved to the current
/// name when capture starts.
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

/// Enumerate all output devices for the device picker: endpoint ids from the
/// Windows device API, falling back to display names if that fails.
pub fn list_output_devices() -> Vec<DeviceInfo> {
    #[cfg(windows)]
    {
        let list = endpoints::list();
        if !list.is_empty() {
            return list;
        }
    }
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
/// `failed` is set when the stream reports an error (e.g. the endpoint was
/// invalidated by a plug/unplug); the pipeline then reopens capture.
pub fn start_capture_on(
    device: &cpal::Device,
    buffer: Arc<Mutex<AudioBuffer>>,
    failed: Arc<AtomicBool>,
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
            move |err| {
                eprintln!("Audio stream error: {err}");
                failed.store(true, Ordering::Relaxed);
            },
            None,
        )
        .map_err(|e| format!("Failed to build input stream: {e}"))?;

    stream
        .play()
        .map_err(|e| format!("Failed to start stream: {e}"))?;

    Ok((stream, sample_rate))
}

/// Resolve a pinned device: by endpoint id first (its current display name),
/// then by the saved display name (settings from before v6, or an id that
/// changed).
pub fn find_pinned_device(id: &str, name: &str) -> Option<(cpal::Device, String)> {
    #[cfg(windows)]
    {
        if let Some(current) = endpoints::list().into_iter().find(|d| d.id == id) {
            if let Some(found) = find_output_device_by_name(&current.name) {
                return Some(found);
            }
        }
    }
    find_output_device_by_name(if name.is_empty() { id } else { name })
}

#[cfg(windows)]
mod endpoints {
    use super::DeviceInfo;
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{eRender, IMMDeviceEnumerator, MMDeviceEnumerator, DEVICE_STATE_ACTIVE};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED, STGM_READ};

    /// Active render endpoints (id + friendly name). Empty on any COM error.
    pub fn list() -> Vec<DeviceInfo> {
        unsafe { list_inner().unwrap_or_default() }
    }

    unsafe fn list_inner() -> windows::core::Result<Vec<DeviceInfo>> {
        // Already initialised on this thread (any mode) is fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let en: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let coll = en.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)?;
        let mut out = Vec::new();
        for i in 0..coll.GetCount()? {
            let dev = coll.Item(i)?;
            let pid = dev.GetId()?;
            let id = pid.to_string().unwrap_or_default();
            CoTaskMemFree(Some(pid.0 as *const _));
            let store = dev.OpenPropertyStore(STGM_READ)?;
            let name = store.GetValue(&PKEY_Device_FriendlyName)?.to_string();
            if !id.is_empty() && !name.is_empty() {
                out.push(DeviceInfo { id, name });
            }
        }
        Ok(out)
    }
}
