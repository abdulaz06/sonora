mod audio;
mod config;
mod controller;
mod ipc;
mod media;
mod out;
mod tray;

use std::sync::Arc;

use audio::devices::DeviceState;

/// Development builds only (the frontend calls it under `import.meta.env.DEV`):
/// a line from a webview on the dev console, for checks without devtools.
#[tauri::command]
fn dev_log(window: tauri::WebviewWindow, msg: String) {
    eprintln!("[{}] {msg}", window.label());
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let device_state: Arc<DeviceState> = DeviceState::new();
    let device_state_for_setup = Arc::clone(&device_state);
    let media_state = media::new_state();
    let media_for_setup = Arc::clone(&media_state);

    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(device_state)
        .manage(media_state)
        .manage(tray::state())
        .manage(out::state())
        .manage(out::record::state())
        .invoke_handler(tauri::generate_handler![
            config::settings::load_settings,
            config::settings::save_settings,
            audio::commands::get_audio_devices,
            audio::commands::get_current_audio_device,
            audio::commands::set_audio_device,
            media::get_media_session,
            media::media_control,
            tray::set_tray_set_mode,
            tray::set_tray_recording,
            controller::open_controller,
            controller::close_controller,
            out::out_open,
            out::out_write,
            out::out_close,
            out::out_abort,
            out::out_free,
            out::out_reveal,
            out::aac_open,
            out::aac_encode,
            out::aac_close,
            out::record::rec_start,
            out::record::rec_pull,
            out::record::rec_stop,
            out::record::rec_end,
            dev_log,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            audio::start(handle.clone(), Arc::clone(&device_state_for_setup));
            media::start(handle, Arc::clone(&media_for_setup));
            tray::create(app.handle())?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
