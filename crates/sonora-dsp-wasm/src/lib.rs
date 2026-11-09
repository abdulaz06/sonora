//! WebAssembly front for `sonora-dsp`.
//!
//! The browser pushes mono PCM (from an AudioWorklet or a decoded file) and
//! pulls frames as JSON strings. JSON keeps the frame shape byte-for-byte the
//! same as the desktop's Tauri event payload, which is also serde_json.

use sonora_dsp::StreamAnalyzer;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmAnalyzer {
    inner: StreamAnalyzer,
}

#[wasm_bindgen]
impl WasmAnalyzer {
    #[wasm_bindgen(constructor)]
    pub fn new(sample_rate: u32) -> WasmAnalyzer {
        WasmAnalyzer {
            inner: StreamAnalyzer::new(sample_rate),
        }
    }

    #[wasm_bindgen(js_name = sampleRate)]
    pub fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    /// Samples of audio per analysis frame.
    pub fn hop(&self) -> usize {
        self.inner.hop()
    }

    /// Append mono samples.
    pub fn push(&mut self, samples: &[f32]) {
        self.inner.push(samples);
    }

    /// Next frame as JSON, or `undefined` if less than one hop is pending.
    #[wasm_bindgen(js_name = nextFrameJson)]
    pub fn next_frame_json(&mut self) -> Option<String> {
        self.inner
            .next_frame()
            .and_then(|f| serde_json::to_string(&f).ok())
    }
}
