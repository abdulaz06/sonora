//! Live recording, audio side. The capture callback counts every sample frame
//! it delivers (the capture clock, stamped on each analysis frame so the web
//! side can time video frames by the audio they show) and, while a recording
//! is armed, copies them as stereo into a preallocated lock-free ring (no
//! allocation or locking in the callback). A writer thread drains the ring,
//! resamples to 48 kHz when the device runs at another rate, and encodes AAC;
//! the web side pulls the frames and muxes them with the picture.

use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use super::aac::AacEncoder;

/// Ring capacity in stereo frames (~5 s at 48 kHz): the writer drains it every 10 ms.
const RING_FRAMES: usize = 1 << 18;
/// AAC bitrate for recordings (bytes per second: 24000 = 192 kbps, the encoder's top).
const REC_AAC_BPS: u32 = 24000;
/// Writer wake-up (ms).
const WRITER_MS: u64 = 10;

/// Sample frames delivered by capture since the app started (the capture clock).
pub static CLOCK: AtomicU64 = AtomicU64::new(0);
/// The capture device's sample rate (Hz).
pub static RATE: AtomicU32 = AtomicU32::new(48000);

/// Single-producer single-consumer ring of interleaved stereo f32 (stored as bits).
pub struct Tap {
    armed: AtomicBool,
    buf: Box<[AtomicU32]>,
    head: AtomicUsize,
    tail: AtomicUsize,
    /// Frames lost because the ring was full (should stay 0).
    pub dropped: AtomicU64,
}

impl Tap {
    fn new() -> Self {
        Self {
            armed: AtomicBool::new(false),
            buf: (0..RING_FRAMES * 2).map(|_| AtomicU32::new(0)).collect(),
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
            dropped: AtomicU64::new(0),
        }
    }

    #[inline]
    pub fn armed(&self) -> bool {
        self.armed.load(Ordering::Relaxed)
    }

    /// Capture callback: push one stereo frame (no allocation, no lock).
    #[inline]
    pub fn push(&self, l: f32, r: f32) {
        let h = self.head.load(Ordering::Relaxed);
        let t = self.tail.load(Ordering::Acquire);
        if h.wrapping_sub(t) >= RING_FRAMES {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        }
        let i = (h % RING_FRAMES) * 2;
        self.buf[i].store(l.to_bits(), Ordering::Relaxed);
        self.buf[i + 1].store(r.to_bits(), Ordering::Relaxed);
        self.head.store(h.wrapping_add(1), Ordering::Release);
    }

    /// Writer: move everything available into `out` (interleaved stereo).
    fn drain(&self, out: &mut Vec<f32>) {
        let t = self.tail.load(Ordering::Relaxed);
        let h = self.head.load(Ordering::Acquire);
        let mut k = t;
        while k != h {
            let i = (k % RING_FRAMES) * 2;
            out.push(f32::from_bits(self.buf[i].load(Ordering::Relaxed)));
            out.push(f32::from_bits(self.buf[i + 1].load(Ordering::Relaxed)));
            k = k.wrapping_add(1);
        }
        self.tail.store(h, Ordering::Release);
    }
}

pub fn tap() -> &'static Tap {
    static TAP: OnceLock<Tap> = OnceLock::new();
    TAP.get_or_init(Tap::new)
}

/// Capture callback helper: count `frames` on the clock and, when armed, copy them as stereo.
#[inline]
pub fn on_capture(data: &[f32], channels: usize) {
    let frames = data.len() / channels.max(1);
    let t = tap();
    if t.armed() {
        for c in data.chunks(channels.max(1)) {
            let l = c[0];
            let r = if channels > 1 { c[1] } else { l };
            t.push(l, r);
        }
    }
    CLOCK.fetch_add(frames as u64, Ordering::Relaxed);
}

/// The pipeline's silence fill (nothing playing): the clock and the recording advance with it.
pub fn on_silence(frames: usize) {
    let t = tap();
    if t.armed() {
        for _ in 0..frames {
            t.push(0.0, 0.0);
        }
    }
    CLOCK.fetch_add(frames as u64, Ordering::Relaxed);
}

struct Session {
    stop: Arc<AtomicBool>,
    packets: Arc<Mutex<Vec<Vec<u8>>>>,
    thread: Option<std::thread::JoinHandle<()>>,
    error: Arc<Mutex<Option<String>>>,
}

#[derive(Default)]
pub struct RecState {
    session: Mutex<Option<Session>>,
}

pub fn state() -> RecState {
    RecState::default()
}

#[derive(Serialize)]
pub struct RecStarted {
    /// Capture clock at the first recorded sample frame.
    #[serde(rename = "startClock")]
    start_clock: u64,
    /// The capture clock's rate (device Hz).
    #[serde(rename = "clockRate")]
    clock_rate: u32,
    /// The AAC stream's rate and its AudioSpecificConfig.
    #[serde(rename = "sampleRate")]
    sample_rate: u32,
    asc: Vec<u8>,
}

/// Arm the tap and start the writer. The first recorded frame is the clock value returned.
#[tauri::command]
pub fn rec_start(state: tauri::State<RecState>) -> Result<RecStarted, String> {
    let mut slot = state.session.lock();
    if slot.is_some() {
        return Err("already recording".into());
    }
    let dev = RATE.load(Ordering::Relaxed);
    let out_rate = if dev == 44100 || dev == 48000 { dev } else { 48000 };
    let mut enc = AacEncoder::new(out_rate, 2, REC_AAC_BPS)?;
    let asc = enc.asc.clone();
    let t = tap();
    // Empty the ring, then arm: the clock value read between the two is the first frame.
    let mut scratch = Vec::new();
    t.drain(&mut scratch);
    t.dropped.store(0, Ordering::Relaxed);
    let start_clock = CLOCK.load(Ordering::Acquire);
    t.armed.store(true, Ordering::Release);
    let stop = Arc::new(AtomicBool::new(false));
    let packets = Arc::new(Mutex::new(Vec::new()));
    let error = Arc::new(Mutex::new(None));
    let (s2, p2, e2) = (Arc::clone(&stop), Arc::clone(&packets), Arc::clone(&error));
    let thread = std::thread::spawn(move || {
        let mut buf: Vec<f32> = Vec::with_capacity(RING_FRAMES * 2);
        let mut rs = Resampler::default();
        let mut pcm: Vec<i16> = Vec::with_capacity(RING_FRAMES * 2);
        loop {
            let last = s2.load(Ordering::Acquire);
            buf.clear();
            tap().drain(&mut buf);
            if !buf.is_empty() {
                pcm.clear();
                let from = RATE.load(Ordering::Relaxed);
                rs.process(&buf, from, out_rate, &mut pcm);
                match enc.encode(&pcm) {
                    Ok(frames) => p2.lock().extend(frames),
                    Err(e) => { *e2.lock() = Some(e); break; }
                }
            }
            if last {
                match enc.finish() {
                    Ok(frames) => p2.lock().extend(frames),
                    Err(e) => *e2.lock() = Some(e),
                }
                break;
            }
            std::thread::sleep(Duration::from_millis(WRITER_MS));
        }
    });
    *slot = Some(Session { stop, packets, thread: Some(thread), error });
    Ok(RecStarted { start_clock, clock_rate: dev, sample_rate: out_rate, asc })
}

/// AAC frames encoded since the last pull (packed like `aac_encode`).
#[tauri::command]
pub fn rec_pull(state: tauri::State<RecState>) -> Result<tauri::ipc::Response, String> {
    let slot = state.session.lock();
    let s = slot.as_ref().ok_or("not recording")?;
    if let Some(e) = s.error.lock().clone() {
        return Err(e);
    }
    let frames: Vec<Vec<u8>> = std::mem::take(&mut *s.packets.lock());
    Ok(tauri::ipc::Response::new(super::pack(&frames)))
}

#[derive(Serialize)]
pub struct RecStopped {
    /// Capture clock at the last recorded frame.
    #[serde(rename = "endClock")]
    end_clock: u64,
    dropped: u64,
}

/// Disarm, flush the encoder; the remaining frames come with the next (last) `rec_pull`.
#[tauri::command]
pub fn rec_stop(state: tauri::State<RecState>) -> Result<RecStopped, String> {
    let t = tap();
    t.armed.store(false, Ordering::Release);
    let end_clock = CLOCK.load(Ordering::Acquire);
    let mut slot = state.session.lock();
    let s = slot.as_mut().ok_or("not recording")?;
    s.stop.store(true, Ordering::Release);
    if let Some(h) = s.thread.take() {
        let _ = h.join();
    }
    Ok(RecStopped { end_clock, dropped: t.dropped.load(Ordering::Relaxed) })
}

/// Forget the session (after the last pull).
#[tauri::command]
pub fn rec_end(state: tauri::State<RecState>) {
    let mut slot = state.session.lock();
    if let Some(mut s) = slot.take() {
        tap().armed.store(false, Ordering::Release);
        s.stop.store(true, Ordering::Release);
        if let Some(h) = s.thread.take() {
            let _ = h.join();
        }
    }
}

/// Linear resampler for interleaved stereo (only used when the device isn't at 44.1 / 48 kHz).
#[derive(Default)]
struct Resampler {
    pos: f64,
    last: [f32; 2],
}

impl Resampler {
    fn process(&mut self, inp: &[f32], from: u32, to: u32, out: &mut Vec<i16>) {
        let q = |x: f32| (x.clamp(-1.0, 1.0) * 32767.0).round() as i16;
        if from == to || from == 0 {
            out.extend(inp.iter().map(|&x| q(x)));
            return;
        }
        let step = from as f64 / to as f64;
        let n = inp.len() / 2;
        // Position relative to inp[0]; index -1 is the previous chunk's last frame.
        while self.pos < n as f64 - 1.0 {
            let i = self.pos.floor();
            let f = (self.pos - i) as f32;
            let i = i as isize;
            for c in 0..2 {
                let a = if i < 0 { self.last[c] } else { inp[i as usize * 2 + c] };
                let b = inp[(i + 1) as usize * 2 + c];
                out.push(q(a + (b - a) * f));
            }
            self.pos += step;
        }
        self.pos -= n as f64;
        if n > 0 {
            self.last = [inp[(n - 1) * 2], inp[(n - 1) * 2 + 1]];
        }
    }
}
