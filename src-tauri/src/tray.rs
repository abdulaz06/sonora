//! System tray: Show, Menu, Set Mode (checkable), Controller, Export, Fullscreen, Quit.
//! Left-click toggles the window. Actions the web side owns (menu, Set Mode,
//! fullscreen) are sent to it as `tray` events; `set_tray_set_mode` keeps the
//! Set Mode check in sync when it changes in the app.

use parking_lot::Mutex;
use tauri::{
    image::Image,
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Wry,
};

/// The 32 px brand tile (hand-tuned small optical weight).
const TRAY_ICON: &[u8] = include_bytes!("../icons/tray-32.png");

pub struct TrayState {
    set_mode: Mutex<Option<CheckMenuItem<Wry>>>,
}

pub fn state() -> TrayState {
    TrayState { set_mode: Mutex::new(None) }
}

fn show(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let show_i = MenuItem::with_id(app, "show", "Show sonora", true, None::<&str>)?;
    let menu_i = MenuItem::with_id(app, "menu", "Menu", true, None::<&str>)?;
    let set_i = CheckMenuItem::with_id(app, "setmode", "Set Mode", true, false, None::<&str>)?;
    let ctl_i = MenuItem::with_id(app, "controller", "Controller (second screen)", true, None::<&str>)?;
    let exp_i = MenuItem::with_id(app, "export", "Export a video…", true, None::<&str>)?;
    let fs_i = MenuItem::with_id(app, "fullscreen", "Fullscreen", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_i, &menu_i, &set_i, &ctl_i, &exp_i, &fs_i, &sep, &quit_i])?;
    *app.state::<TrayState>().set_mode.lock() = Some(set_i);

    TrayIconBuilder::with_id("sonora-tray")
        .icon(Image::from_bytes(TRAY_ICON)?)
        .tooltip("sonora")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "show" => show(app),
            "menu" | "setmode" | "fullscreen" | "export" => {
                show(app);
                let _ = app.emit("tray", event.id.as_ref());
            }
            "controller" => {
                // The output decides where (the display it isn't on): it opens the window.
                let _ = app.emit("tray", "controller");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                let app = tray.app_handle();
                if let Some(w) = app.get_webview_window("main") {
                    if w.is_visible().unwrap_or(false) {
                        let _ = w.hide();
                    } else {
                        show(app);
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Keep the tray's Set Mode check in sync with the app.
#[tauri::command]
pub fn set_tray_set_mode(state: tauri::State<TrayState>, on: bool) {
    if let Some(item) = state.set_mode.lock().as_ref() {
        let _ = item.set_checked(on);
    }
}
