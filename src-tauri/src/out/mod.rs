//! Video output for exports and recordings: files in `Videos\sonora\`
//! (written at positions the web side's MP4 muxer chooses), the AAC encoder
//! that ships with Windows, free disk space, and "open folder". The web side
//! encodes the picture (WebCodecs, hardware H.264) and muxes; Rust only stores
//! bytes and encodes audio.

pub mod aac;
pub mod record;

use parking_lot::Mutex;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::File;
use std::io::{Seek, SeekFrom, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU32, Ordering};
use tauri::ipc::{InvokeBody, Request, Response};

use aac::AacEncoder;

static NEXT_ID: AtomicU32 = AtomicU32::new(1);

struct OutFile {
    file: File,
    path: PathBuf,
}

#[derive(Default)]
pub struct OutState {
    files: Mutex<HashMap<u32, OutFile>>,
    encoders: Mutex<HashMap<u32, AacEncoder>>,
}

pub fn state() -> OutState {
    OutState::default()
}

/// `Videos\sonora` (the Videos known folder; `%USERPROFILE%\Videos` as a fallback).
pub fn videos_dir() -> PathBuf {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Shell::{FOLDERID_Videos, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
        if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Videos, KF_FLAG_DEFAULT, None) {
            let s = p.to_string().unwrap_or_default();
            windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            if !s.is_empty() {
                return PathBuf::from(s).join("sonora");
            }
        }
    }
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Videos").join("sonora")
}

/// Bytes free for the user on the volume holding `dir`.
pub fn free_bytes(dir: &std::path::Path) -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
        let mut free = 0u64;
        let probe = if dir.exists() { dir.to_path_buf() } else { dir.parent().map(|p| p.to_path_buf()).unwrap_or_default() };
        if GetDiskFreeSpaceExW(&HSTRING::from(probe.as_os_str()), Some(&mut free), None, None).is_ok() {
            return free;
        }
    }
    let _ = dir;
    u64::MAX
}

/// File names from the web side: keep letters, digits and a few separators.
fn clean_name(name: &str) -> String {
    let s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || " -_.,()'".contains(c) { c } else { '-' })
        .collect();
    let s = s.trim().trim_matches('.').to_string();
    if s.is_empty() { "sonora".into() } else { s.chars().take(90).collect() }
}

#[derive(Serialize)]
pub struct Opened {
    id: u32,
    path: String,
    free: u64,
}

/// Create `Videos\sonora\<name>.<ext>` (a free name: " 2", " 3", … appended).
#[tauri::command]
pub fn out_open(state: tauri::State<OutState>, name: String, ext: String) -> Result<Opened, String> {
    let dir = videos_dir();
    std::fs::create_dir_all(&dir).map_err(|e| format!("can't create {}: {e}", dir.display()))?;
    let base = clean_name(&name);
    let ext = if ext.chars().all(|c| c.is_ascii_alphanumeric()) && !ext.is_empty() { ext } else { "mp4".into() };
    let mut path = dir.join(format!("{base}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{base} {n}.{ext}"));
        n += 1;
    }
    let file = File::create(&path).map_err(|e| format!("can't write {}: {e}", path.display()))?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let shown = path.display().to_string();
    state.files.lock().insert(id, OutFile { file, path });
    Ok(Opened { id, path: shown, free: free_bytes(&dir) })
}

fn header(req: &Request<'_>, key: &str) -> Result<u64, String> {
    req.headers()
        .get(key)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .ok_or_else(|| format!("missing header {key}"))
}

/// Write the raw body at a byte position (`x-id`, `x-pos` headers).
#[tauri::command]
pub async fn out_write(state: tauri::State<'_, OutState>, request: Request<'_>) -> Result<(), String> {
    let id = header(&request, "x-id")? as u32;
    let pos = header(&request, "x-pos")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected bytes".into()) };
    let mut files = state.files.lock();
    let f = files.get_mut(&id).ok_or("unknown file")?;
    f.file.seek(SeekFrom::Start(pos)).map_err(|e| e.to_string())?;
    f.file.write_all(bytes).map_err(|e| e.to_string())
}

/// Finish a file; returns its size.
#[tauri::command]
pub fn out_close(state: tauri::State<OutState>, id: u32) -> Result<u64, String> {
    let f = state.files.lock().remove(&id).ok_or("unknown file")?;
    f.file.sync_all().map_err(|e| e.to_string())?;
    Ok(f.file.metadata().map(|m| m.len()).unwrap_or(0))
}

/// Cancel: close and delete the partial file.
#[tauri::command]
pub fn out_abort(state: tauri::State<OutState>, id: u32) {
    if let Some(f) = state.files.lock().remove(&id) {
        drop(f.file);
        let _ = std::fs::remove_file(&f.path);
    }
}

/// Free space where videos go (bytes).
#[tauri::command]
pub fn out_free() -> u64 {
    free_bytes(&videos_dir())
}

/// Show a saved file in Explorer (only files inside Videos\sonora).
#[tauri::command]
pub fn out_reveal(path: String) -> Result<(), String> {
    let dir = videos_dir();
    let p = PathBuf::from(&path);
    let target = if p.starts_with(&dir) && p.exists() { p } else { dir.clone() };
    std::fs::create_dir_all(&dir).ok();
    let arg = if target.is_file() { format!("/select,{}", target.display()) } else { target.display().to_string() };
    std::process::Command::new("explorer").arg(arg).spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize)]
pub struct AacOpened {
    id: u32,
    asc: Vec<u8>,
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
    channels: u32,
}

/// Start an AAC encoder (44.1 / 48 kHz, 1–2 channels; 96–192 kbps).
#[tauri::command]
pub fn aac_open(state: tauri::State<OutState>, sample_rate: u32, channels: u32, kbps: u32) -> Result<AacOpened, String> {
    let bps = match kbps { 0..=111 => 12000, 112..=143 => 16000, 144..=175 => 20000, _ => 24000 };
    let enc = AacEncoder::new(sample_rate, channels, bps)?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let asc = enc.asc.clone();
    state.encoders.lock().insert(id, enc);
    Ok(AacOpened { id, asc, sample_rate, channels })
}

/// AAC frames as one buffer: u32 count, u32 length each, then the bytes (little-endian).
pub fn pack(frames: &[Vec<u8>]) -> Vec<u8> {
    let mut out = Vec::with_capacity(4 + frames.len() * 4 + frames.iter().map(|f| f.len()).sum::<usize>());
    out.extend_from_slice(&(frames.len() as u32).to_le_bytes());
    for f in frames {
        out.extend_from_slice(&(f.len() as u32).to_le_bytes());
    }
    for f in frames {
        out.extend_from_slice(f);
    }
    out
}

/// Encode interleaved 16-bit PCM (raw body, `x-id` header) → packed AAC frames.
#[tauri::command]
pub async fn aac_encode(state: tauri::State<'_, OutState>, request: Request<'_>) -> Result<Response, String> {
    let id = header(&request, "x-id")? as u32;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected bytes".into()) };
    let pcm: Vec<i16> = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    let mut encs = state.encoders.lock();
    let enc = encs.get_mut(&id).ok_or("unknown encoder")?;
    Ok(Response::new(pack(&enc.encode(&pcm)?)))
}

/// Flush and close an encoder → its last packed frames.
#[tauri::command]
pub fn aac_close(state: tauri::State<OutState>, id: u32) -> Result<Response, String> {
    let mut enc = state.encoders.lock().remove(&id).ok_or("unknown encoder")?;
    Ok(Response::new(pack(&enc.finish()?)))
}
