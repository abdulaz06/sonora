//! System tray icon with right-click menu.
//! Left-click toggles window visibility. Right-click shows menu.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "Show Sonora", true, None::<&str>)?;
    let hide_i = MenuItem::with_id(app, "hide", "Hide", true, None::<&str>)?;
    let fs_i = MenuItem::with_id(app, "fullscreen", "Toggle Fullscreen", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &hide_i, &fs_i, &sep, &quit_i])?;

    let _tray = TrayIconBuilder::with_id("sonora-tray")
        .icon(app.default_window_icon().cloned().ok_or_else(|| {
            tauri::Error::AssetNotFound("default window icon missing".into())
        })?)
        .tooltip("Sonora")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "hide" => {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }
            "fullscreen" => {
                if let Some(w) = app.get_webview_window("main") {
                    if let Ok(fs) = w.is_fullscreen() {
                        let _ = w.set_fullscreen(!fs);
                    }
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    match w.is_visible() {
                        Ok(true) => {
                            let _ = w.hide();
                        }
                        _ => {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                }
            }
        })
        .build(app)?;

    Ok(())
}
