//! Sonora's audio analysis pipeline, free of any platform or audio-API code.
//!
//! The same crate runs inside the desktop app (fed by WASAPI loopback) and in
//! the browser as WebAssembly (fed by an AudioWorklet). Both paths push mono
//! PCM into a [`StreamAnalyzer`] and receive identical [`AudioFeatureFrame`]s.
//!
//! Layers, in order:
//! 1. FFT, bands, spectral shape, energy
//! 2. Onsets, beat/tempo, element and rhythm proxies
//! 3. Mood proxies
//! 4. Mapping layer (fade, intensity, presence, hits, juiced FFT) — see
//!    `DOCS/14-MAPPING-LAYER-SPEC.md`.

// DSP loops index several parallel arrays at once; iterator chains would be
// less readable than the explicit indices.
#![allow(clippy::needless_range_loop)]

pub mod analyzer;
pub mod archetypes;
pub mod bands;
pub mod beat;
pub mod buffer;
pub mod elements;
pub mod energy;
pub mod fft;
pub mod frame;
pub mod mapping;
pub mod mood;
pub mod norm;
pub mod onsets;
pub mod spectral;

pub use analyzer::{hop_size, Analyzer, StreamAnalyzer, ANALYSIS_RATE, FFT_SIZE};
pub use buffer::AudioBuffer;
pub use frame::AudioFeatureFrame;
