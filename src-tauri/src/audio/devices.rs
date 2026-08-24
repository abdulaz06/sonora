//! Shared device-selection state.
//!
//! Two pieces of cross-thread state:
//!  - `preference`: what the *user* wants (system default, or a pinned device).
//!    Mutated by Tauri command handlers; read by the audio pipeline thread.
//!  - `current`:    the device the pipeline is *actually* capturing from.
//!    Written by the pipeline thread on every successful (re)start; read by
//!    the `get_current_audio_device` command so the UI can label the source.

use parking_lot::Mutex;
use std::sync::Arc;

/// What the user has asked us to capture from.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DevicePreference {
    /// Follow the system default — auto-switch when it changes.
    Default,
    /// Stay on this specific device regardless of the system default.
    /// The string is the device's display name (cpal doesn't expose
    /// stable IDs, so name is our id).
    Pinned(String),
}

pub struct DeviceState {
    preference: Mutex<DevicePreference>,
    current: Mutex<String>,
}

impl DeviceState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            preference: Mutex::new(DevicePreference::Default),
            current: Mutex::new(String::new()),
        })
    }

    pub fn preference(&self) -> DevicePreference {
        self.preference.lock().clone()
    }

    pub fn set_preference(&self, p: DevicePreference) {
        *self.preference.lock() = p;
    }

    pub fn current(&self) -> String {
        self.current.lock().clone()
    }

    pub fn set_current(&self, name: String) {
        *self.current.lock() = name;
    }
}
