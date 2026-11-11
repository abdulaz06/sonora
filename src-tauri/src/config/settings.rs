//! Persistent user settings — read/written as JSON in the OS app data dir.
//!
//! The frontend owns the settings *schema* (it's untyped on this side beyond
//! "valid JSON"). We just store whatever object the frontend hands us, and
//! return whatever we last stored. Keeping the schema flexible means adding a
//! new preference doesn't require touching Rust.

use std::fs;
use std::path::PathBuf;

use serde_json::Value;
use tauri::{AppHandle, Manager};

const SETTINGS_FILENAME: &str = "settings.json";

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("could not resolve app data dir: {e}"))?;
    if !dir.exists() {
        fs::create_dir_all(&dir)
            .map_err(|e| format!("could not create app data dir {dir:?}: {e}"))?;
    }
    Ok(dir.join(SETTINGS_FILENAME))
}

/// Load saved settings as a JSON value, or `null` if no file exists yet.
/// Corrupt JSON is treated the same as "no settings" — a fresh run rather
/// than an error, so a bad write never bricks the app.
#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Value, String> {
    let path = settings_path(&app)?;
    if !path.exists() {
        return Ok(Value::Null);
    }
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("could not read {path:?}: {e}"))?;
    // Editors such as Notepad may save with a UTF-8 byte-order mark.
    match serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}')) {
        Ok(v) => Ok(v),
        Err(e) => {
            eprintln!("settings.json parse error ({e}); treating as no settings");
            Ok(Value::Null)
        }
    }
}

/// Persist the supplied JSON value to settings.json. Writes are debounced
/// on the frontend side, so this is invoked at human cadence (~1Hz at most).
#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Value) -> Result<(), String> {
    let path = settings_path(&app)?;
    let serialized = serde_json::to_string_pretty(&settings)
        .map_err(|e| format!("could not serialize settings: {e}"))?;
    fs::write(&path, serialized)
        .map_err(|e| format!("could not write {path:?}: {e}"))?;
    Ok(())
}
