//! Tauri commands the frontend uses to inspect and control the audio source.
//!
//! All four commands operate on the shared `DeviceState` managed by Tauri.
//! `set_audio_device` only updates the preference — the audio pipeline thread
//! polls that preference and performs the actual switch on its next tick.

use std::sync::Arc;

use serde::Serialize;

use crate::audio::capture::{list_output_devices, DeviceInfo};
use crate::audio::devices::{DevicePreference, DeviceState};

/// Used by `get_current_audio_device` so the UI can render both the active
/// device and whether the user has it pinned.
#[derive(Serialize)]
pub struct CurrentDevice {
    /// Display name of the device the pipeline is actually capturing from.
    /// Empty string when no device is available yet.
    pub name: String,
    /// `true` if the user has pinned a specific device, `false` if we're
    /// following the system default.
    pub pinned: bool,
    /// The pinned id (when `pinned`), otherwise `None`.
    pub pinned_id: Option<String>,
}

#[tauri::command]
pub fn get_audio_devices() -> Vec<DeviceInfo> {
    list_output_devices()
}

#[tauri::command]
pub fn get_current_audio_device(state: tauri::State<Arc<DeviceState>>) -> CurrentDevice {
    let pref = state.preference();
    let (pinned, pinned_id) = match pref {
        DevicePreference::Default => (false, None),
        DevicePreference::Pinned(id) => (true, Some(id)),
    };
    CurrentDevice {
        name: state.current(),
        pinned,
        pinned_id,
    }
}

/// Set the user's device preference. Pass `None` (or `"default"`) to follow
/// the system default; pass a device id to pin to that device.
#[tauri::command]
pub fn set_audio_device(state: tauri::State<Arc<DeviceState>>, id: Option<String>) {
    let pref = match id {
        None => DevicePreference::Default,
        Some(s) if s == "default" || s.is_empty() => DevicePreference::Default,
        Some(s) => DevicePreference::Pinned(s),
    };
    state.set_preference(pref);
}
