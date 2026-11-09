//! Run the analyzer over a 16-bit PCM WAV and print one JSON frame per line.
//!
//! Used by `scripts/check-parity.mjs` to prove the native and WASM builds
//! produce the same frames:
//!
//! ```text
//! cargo run -p sonora-dsp --example analyze_wav --release -- test-audio/house-124.wav 600
//! ```

use sonora_dsp::StreamAnalyzer;
use std::io::{BufWriter, Write};

fn main() {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("usage: analyze_wav <file.wav> [max_frames]");
    let max_frames: usize = args.next().and_then(|s| s.parse().ok()).unwrap_or(usize::MAX);

    let bytes = std::fs::read(&path).expect("read wav");
    let (sample_rate, mono) = decode_wav(&bytes);

    let mut analyzer = StreamAnalyzer::new(sample_rate);
    let hop = analyzer.hop();
    let out = std::io::stdout();
    let mut out = BufWriter::new(out.lock());
    let mut produced = 0;
    for chunk in mono.chunks(hop) {
        if produced >= max_frames {
            break;
        }
        analyzer.push(chunk);
        while let Some(frame) = analyzer.next_frame() {
            writeln!(out, "{}", serde_json::to_string(&frame).unwrap()).unwrap();
            produced += 1;
        }
    }
}

/// Minimal RIFF/WAVE reader: PCM 16-bit, any channel count, mixed to mono.
fn decode_wav(b: &[u8]) -> (u32, Vec<f32>) {
    assert!(&b[0..4] == b"RIFF" && &b[8..12] == b"WAVE", "not a WAV file");
    let mut pos = 12;
    let mut channels = 1usize;
    let mut sample_rate = 44_100u32;
    while pos + 8 <= b.len() {
        let id = &b[pos..pos + 4];
        let size = u32::from_le_bytes([b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]]) as usize;
        let body = &b[pos + 8..(pos + 8 + size).min(b.len())];
        if id == b"fmt " {
            channels = u16::from_le_bytes([body[2], body[3]]) as usize;
            sample_rate = u32::from_le_bytes([body[4], body[5], body[6], body[7]]);
            let bits = u16::from_le_bytes([body[14], body[15]]);
            assert_eq!(bits, 16, "only 16-bit PCM supported");
        } else if id == b"data" {
            let frames = body.len() / (2 * channels);
            let mut mono = Vec::with_capacity(frames);
            for f in 0..frames {
                let mut acc = 0.0f32;
                for c in 0..channels {
                    let i = (f * channels + c) * 2;
                    acc += i16::from_le_bytes([body[i], body[i + 1]]) as f32 / 32768.0;
                }
                mono.push(acc / channels as f32);
            }
            return (sample_rate, mono);
        }
        pos += 8 + size + (size & 1);
    }
    panic!("no data chunk");
}
