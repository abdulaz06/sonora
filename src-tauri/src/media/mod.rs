//! Now playing: reads the Windows media session (GlobalSystemMediaTransport-
//! ControlsSessionManager) on a background thread and emits `media-session`
//! to the frontend whenever the track, cover or playback state changes.
//! Commands: `get_media_session` (latest state) and `media_control`
//! (previous / play-pause / next forwarded to the active session).

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::Arc;

/// How often the session is polled (ms). Track changes show within this.
#[cfg(windows)]
const POLL_MS: u64 = 500;
/// Largest cover accepted (bytes); bigger thumbnails are skipped.
#[cfg(windows)]
const MAX_ART_BYTES: usize = 1_500_000;
/// Some players (browsers) set the cover a moment after the title: while a
/// track has no cover yet, ask again on this many polls (album colours).
#[cfg(windows)]
const ART_RETRIES: u32 = 10;

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub title: String,
    pub artist: String,
    pub album: String,
    /// Cover as a data: URL ('' when the player provides none).
    pub art: String,
    pub playing: bool,
    pub app: String,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_play_pause: bool,
}

#[derive(Default)]
pub struct MediaState {
    current: Mutex<Option<MediaInfo>>,
}

pub type SharedMedia = Arc<MediaState>;

pub fn new_state() -> SharedMedia {
    Arc::new(MediaState::default())
}

#[tauri::command]
pub fn get_media_session(state: tauri::State<SharedMedia>) -> Option<MediaInfo> {
    state.current.lock().clone()
}

#[tauri::command]
pub fn media_control(action: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        imp::control(&action).map_err(|e| e.to_string())
    }
    #[cfg(not(windows))]
    {
        let _ = action;
        Ok(())
    }
}

/// Start the polling thread.
pub fn start(app: tauri::AppHandle, state: SharedMedia) {
    #[cfg(windows)]
    std::thread::spawn(move || imp::run(app, state));
    #[cfg(not(windows))]
    {
        let _ = (app, state);
    }
}

#[cfg(windows)]
mod imp {
    use super::{MediaInfo, SharedMedia, ART_RETRIES, MAX_ART_BYTES, POLL_MS};
    use base64::Engine;
    use tauri::Emitter;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    };
    use windows::Storage::Streams::{DataReader, IRandomAccessStreamReference};

    pub fn run(app: tauri::AppHandle, state: SharedMedia) {
        let mut manager: Option<Manager> = None;
        // Cover is fetched only when the track changes.
        let mut art_key = String::new();
        let mut art = String::new();
        let mut art_tries = 0u32;
        loop {
            if manager.is_none() {
                manager = Manager::RequestAsync().and_then(|op| op.get()).ok();
            }
            let info = manager.as_ref().and_then(|m| read(m, &mut art_key, &mut art, &mut art_tries).ok().flatten());
            {
                let mut cur = state.current.lock();
                if *cur != info {
                    *cur = info.clone();
                    let _ = app.emit("media-session", &info);
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(POLL_MS));
        }
    }

    fn read(m: &Manager, art_key: &mut String, art: &mut String, art_tries: &mut u32) -> windows::core::Result<Option<MediaInfo>> {
        let session: Session = match m.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None),
        };
        let props = session.TryGetMediaPropertiesAsync()?.get()?;
        let title = props.Title()?.to_string();
        if title.is_empty() {
            return Ok(None);
        }
        let artist = props.Artist()?.to_string();
        let album = props.AlbumTitle()?.to_string();
        let key = format!("{title}\u{0}{artist}\u{0}{album}");
        if key != *art_key {
            *art_key = key;
            *art_tries = 0;
            *art = props.Thumbnail().ok().and_then(|t| cover(&t).ok().flatten()).unwrap_or_default();
        } else if art.is_empty() && *art_tries < ART_RETRIES {
            *art_tries += 1;
            *art = props.Thumbnail().ok().and_then(|t| cover(&t).ok().flatten()).unwrap_or_default();
        }
        let playback = session.GetPlaybackInfo()?;
        let controls = playback.Controls()?;
        Ok(Some(MediaInfo {
            title,
            artist,
            album,
            art: art.clone(),
            playing: playback.PlaybackStatus()? == Status::Playing,
            app: session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default(),
            can_prev: controls.IsPreviousEnabled().unwrap_or(false),
            can_next: controls.IsNextEnabled().unwrap_or(false),
            can_play_pause: controls.IsPlayPauseToggleEnabled().unwrap_or(false),
        }))
    }

    fn cover(r: &IRandomAccessStreamReference) -> windows::core::Result<Option<String>> {
        let stream = r.OpenReadAsync()?.get()?;
        let size = stream.Size()? as usize;
        if size == 0 || size > MAX_ART_BYTES {
            return Ok(None);
        }
        let reader = DataReader::CreateDataReader(&stream)?;
        reader.LoadAsync(size as u32)?.get()?;
        let mut bytes = vec![0u8; size];
        reader.ReadBytes(&mut bytes)?;
        let mime = if bytes.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "image/jpeg" };
        Ok(Some(format!("data:{mime};base64,{}", base64::engine::general_purpose::STANDARD.encode(&bytes))))
    }

    pub fn control(action: &str) -> windows::core::Result<()> {
        let m = Manager::RequestAsync()?.get()?;
        let s = m.GetCurrentSession()?;
        let _ = match action {
            "prev" => s.TrySkipPreviousAsync()?.get()?,
            "next" => s.TrySkipNextAsync()?.get()?,
            _ => s.TryTogglePlayPauseAsync()?.get()?,
        };
        Ok(())
    }
}
