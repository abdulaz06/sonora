//! The controller: a second window that works as a remote for the output (the
//! Set Mode controller view, D84). The two windows talk over a
//! BroadcastChannel (same origin, same WebView2 environment); this module only
//! opens the window. Closing it never touches the output.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Window label and default size (logical px).
pub const LABEL: &str = "controller";
const WIDTH: f64 = 1280.0;
const HEIGHT: f64 = 800.0;
const MIN_WIDTH: f64 = 960.0;
const MIN_HEIGHT: f64 = 600.0;

/// Open (or bring forward) the controller, optionally at a logical position
/// (the display that isn't showing the output) and in "offer" mode (asks first).
pub fn open(app: &AppHandle, at: Option<(f64, f64)>, size: Option<(f64, f64)>, offer: bool) -> tauri::Result<()> {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }
    let url = if offer { "controller.html?offer=1" } else { "controller.html" };
    let mut b = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App(url.into()))
        .title("sonora · controller")
        .inner_size(size.map_or(WIDTH, |s| s.0.max(MIN_WIDTH)), size.map_or(HEIGHT, |s| s.1.max(MIN_HEIGHT)))
        .min_inner_size(MIN_WIDTH, MIN_HEIGHT)
        .background_color(tauri::window::Color(8, 8, 10, 255));
    b = match at {
        Some((x, y)) => b.position(x, y),
        None => b.center(),
    };
    b.build()?;
    Ok(())
}

/// Open the controller from the app (shortcut, Set Mode, the second-display offer).
/// Async: building a window from a synchronous command can deadlock on Windows.
#[tauri::command]
pub async fn open_controller(
    app: AppHandle,
    x: Option<f64>,
    y: Option<f64>,
    width: Option<f64>,
    height: Option<f64>,
    offer: Option<bool>,
) -> Result<(), String> {
    let at = x.zip(y);
    let size = width.zip(height);
    open(&app, at, size, offer.unwrap_or(false)).map_err(|e| e.to_string())
}

/// Close the controller (the output asks when it quits; the controller closes itself otherwise).
#[tauri::command]
pub fn close_controller(app: AppHandle) {
    if let Some(w) = app.get_webview_window(LABEL) {
        let _ = w.close();
    }
}
