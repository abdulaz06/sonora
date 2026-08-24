mod audio;
mod config;
mod ipc;
mod tray;

use std::sync::Arc;

use audio::devices::DeviceState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let device_state: Arc<DeviceState> = DeviceState::new();
    let device_state_for_setup = Arc::clone(&device_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(device_state)
        .invoke_handler(tauri::generate_handler![
            config::settings::load_settings,
            config::settings::save_settings,
            audio::commands::get_audio_devices,
            audio::commands::get_current_audio_device,
            audio::commands::set_audio_device,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            audio::start(handle, Arc::clone(&device_state_for_setup));
            tray::create(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
