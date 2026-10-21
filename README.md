# Sonora

Sonora is a personal Windows desktop music visualizer built with Rust, TypeScript, WebGL 2, and Tauri 2. It captures a selected output endpoint through WASAPI loopback, derives real-time audio control signals, and renders three GPU-driven visual modes.

## See Sonora in Action

Watch **Flow Ink** respond to music in real time. This one-minute recording shows Sonora's audio-reactive fluid visuals in motion.

<p align="center">
  <a href="https://www.youtube.com/watch?v=kDKyOMpcxeI" title="Watch Sonora — Flow Ink with sound">
    <img src="DOCS/assets/flow-ink-thumbnail.png" alt="Sonora Flow Ink audio-reactive visualization — click to watch the demo" width="900" />
  </a>
</p>

<p align="center">
  <a href="https://www.youtube.com/watch?v=kDKyOMpcxeI"><strong>▶ Watch the 60-second Flow Ink demo with sound</strong></a>
</p>

## Highlights

- Captures the system's default output device or a user-selected output device, with automatic switching when the default changes.
- Runs a 4,096-point Hann-windowed FFT and derives seven frequency bands, spectral descriptors, adaptive onsets, RMS energy, and beat/tempo estimates in Rust.
- Converts raw analysis into smoothed visual controls: sustained band presence, short transient hits, long-window intensity, silence fades, and a 96-bin adaptive spectrum.
- Renders three raw WebGL 2 scenes with GLSL shaders, instanced geometry, floating-point framebuffers, and bloom/composite post-processing.
- Persists visual, audio-device, fullscreen, and window settings; also includes a tray menu, clean mode, and a live DSP debug overlay.

The kick, snare, hi-hat, bass, vocal, pad, lead, mood, and rhythmic labels in the debug data are heuristic estimates built from frequency-band energy, onsets, and temporal smoothing. They are not source separation, machine learning, or semantic music recognition.

## Pipeline

```text
Windows output endpoint
        |
        v
CPAL / WASAPI loopback -> mono circular buffer
        |
        v
Rust DSP: FFT -> bands/onsets -> energy/tempo/proxy features
        |
        v
Art-facing mapping: fade + intensity + presence + hits + 96-bin spectrum
        |
        v
Tauri audio-frame events -> TypeScript render loop
        |
        v
WebGL 2 scene FBO -> bloom passes -> final composite
```

The audio worker targets roughly 60 analysis updates per second. Rendering runs independently through `requestAnimationFrame` and always consumes the most recent feature frame.

## Visual modes

| Mode | Rendering approach | Variants |
| --- | --- | --- |
| **Aura** | Concentric signed-distance shapes, instanced particles and glow orbs, and CPU-traced flow-field tendrils | Circle, Triangle, Square |
| **Halo** | 48 radial spectrum bars driven by a shuffled and smoothed 96-bin FFT signal | Soft, Sharp |
| **Flow Ink** | 384×384 floating-point ping-pong simulation with curl-noise advection and band-driven dye injection | — |

All modes render into a floating-point scene framebuffer before half-resolution horizontal/vertical bloom and a final grain, vignette, and tone-mapped composite.

## Controls

The settings panel exposes the visual mode and variant, Aura ring count, seven preset palettes plus a custom hue, responsiveness, post-processing preset, and audio source.

| Key | Action |
| --- | --- |
| `F11` or `F` | Toggle fullscreen |
| `H` | Toggle clean mode |
| `D` | Toggle the DSP debug overlay |
| `S` | Cycle visual mode |
| `1`–`7` | Select a preset palette |
| `Esc` | Exit fullscreen or clean mode; close an open panel |

The tray menu provides Show, Hide, Toggle Fullscreen, and Quit. Left-clicking the tray icon toggles the window's visibility.

## Download

Version 0.1.0 Windows x64 installers are available from the [latest release](https://github.com/abdulaz06/sonora/releases/latest):

- `Sonora_0.1.0_x64-setup.exe` — NSIS installer
- `Sonora_0.1.0_x64_en-US.msi` — MSI installer

The installers are currently unsigned and install per machine, so Windows may request administrator approval and show an unknown-publisher warning. The installer can download the Microsoft Edge WebView2 runtime when it is missing.

## Build from source

Sonora's audio path is Windows-specific. Development requires:

- Node.js 18, 20, or 22+ with npm
- stable Rust using the MSVC toolchain
- Microsoft C++ Build Tools with **Desktop development with C++**
- Microsoft Edge WebView2
- the Windows VBSCRIPT optional feature when producing MSI packages

See the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/) for setup details.

From the repository root:

```powershell
npm ci
npm run tauri dev
```

Create the production frontend and both Windows installers with:

```powershell
npm run build
npm run tauri build
```

Generated installers are written to `src-tauri/target/release/bundle/`.

## Tech stack

- **Desktop and IPC:** Tauri 2
- **Audio and DSP:** Rust, CPAL, WASAPI loopback, rustfft
- **Rendering:** TypeScript, WebGL 2, GLSL ES 3.0
- **Frontend tooling:** Vite and TypeScript

## Audio and privacy

Audio analysis starts with the application and continues while the window is hidden through the tray. Raw samples remain in an in-memory circular buffer; Sonora emits only derived feature frames to its frontend. The application does not save or upload audio and contains no telemetry or network client. Visual preferences, the selected audio-device display name, and window state are stored locally in the operating system's application-data directory.

## Current limitations

- Instrument and rhythm labels are heuristic proxies and can be wrong, especially when frequency ranges overlap.
- There is no explicit buildup, drop, breakdown, or song-section detector. Mood descriptors are visible in the debug overlay but do not currently select colors.
- Output devices are pinned by display name rather than a stable endpoint identifier.
- Rendering requires WebGL 2 and effectively relies on `EXT_color_buffer_float`; there is no non-float framebuffer fallback.
- The Low/Medium/High setting changes post-processing values, not render resolution or simulation size.
- The project has no automated test suite yet; current verification is based on type checking, compilation, lint diagnostics, release builds, and startup smoke testing.
- Desktop hardening is incomplete: the Tauri content security policy is unset and the default opener capability is enabled.

For a deeper look at the signal layer that connects DSP to rendering, see [Audio-to-visual mapping](DOCS/14-MAPPING-LAYER-SPEC.md).