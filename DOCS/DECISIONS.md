# Decisions

Short ADR-style records. Newest last.

## D1 — One analysis crate for desktop and browser
**Context:** the renderer needs the same frames in the Tauri app and in a plain browser (dev page, verification harness, future web build).
**Decision:** `crates/sonora-dsp` holds the whole pipeline with no platform code. `src-tauri` feeds it from WASAPI; `crates/sonora-dsp-wasm` wraps it with wasm-bindgen and returns frames as JSON (same serde_json as the Tauri event payload, so the shape is identical by construction). `scripts/check-parity.mjs` compares native vs WASM frame by frame; the only differences are single rounding quanta (1e-3) caused by MSVC vs wasm libm.
**Consequence:** a Cargo workspace at the repo root; build output moves to `/target`. `npm run build` now needs `wasm-pack`.

## D2 — Hop derived from sample rate
Frames are produced every `round(sample_rate / 60)` samples in both builds (was a fixed 735). Keeps the analysis at 60 Hz of audio time at 48 kHz too, and makes offline rendering exact.

## D3 — Per-band adaptive normalisation in the mapping layer
**Context:** with raw band RMS, high/air sat ~100× below bass, so high hits never fired, mid presence stayed near 0 and intensity saturated on loud masters.
**Decision:** `norm.rs` divides each band by a slowly decaying running peak (30 s half-life) with an absolute floor; presence, hits and the beat ODF use the normalised values. Intensity mixes loudness relative to the track's own recent peak (70%) with absolute loudness (30%). Raw `bands` in the frame are unchanged, so classic styles and the debug overlay are unaffected.

## D4 — Beat tracker rewrite
Autocorrelation of a smoothed ODF with a log-Gaussian tempo prior (120 BPM, 0.9 octave) and a half-tempo harmonic term; phase is a free-running oscillator corrected toward ODF peaks (PLL) instead of hard resets. Locks 124 BPM house exactly; reads the 140 half-time track as 70 in its drop (a valid half-time reading).

## D5 — Event layer in TypeScript, per analysis frame
Runs on every analysis frame (not per render frame) so results are deterministic for a given input and identical in desktop and browser. Drum activity for drop/breakdown uses sub-bass presence + bass-hit activity rather than the 60–250 Hz band, which pads leak into. Drops require a sharp jump (<0.9 s) armed by a build, a short gap inside music, or a long kick-less stretch; long silences are track changes, not drops.

## D6 — Two post pipelines
Art styles use `ArtPost` (render scale, threshold mip bloom, ACES or no tonemap). Classic styles keep the legacy pipeline so their look does not change.

## D7 — Flow Ink world: periodic fluid domain
The sim runs on a torus (REPEAT textures) 4 world units across, so the camera can drift forever with no walls. Depth view fog ends at ~3.4 units so a tile never repeats on screen.

## D8 — Flow Ink dye stores palette slots, not colours
Dye channels are ink A, ink B, sparkle, lift. Colour is applied at render time, so palette changes and Auto Drift recolour ink already on screen, and duotone/paper variants are just different shading.

## D9 — Directional jets instead of radial explosions
A radial splat is pure divergence and the pressure projection deletes it (only swirl survives, giving cartoon spirals). Bass hits and drops inject directional jets, which roll up into vortex pairs (ink "mushrooms"); dye goes in as broken rings with thin tendrils. A subtractive floor decay clears faint haze so quiet passages keep negative space.

## D10 — Verification in audio time
`npm run verify` renders in a real browser (system Edge, real GPU) and advances audio and visuals together with a fixed dt, so screenshots are deterministic and independent of frame rate. A separate real-time pass measures FPS at the drop.

## D11 — Auto Drift on by default
DOCS/16 lists palette drift under "never static"; drift defaults on with a 3-minute cycle and can be turned off or slowed to 10 minutes in settings.

## D12 — Local working notes stay untracked
The local working-notes file and tool settings are listed in `.gitignore`; the project-facing docs live in `DOCS/` and `README.md`.

## D13 — Beat response bypasses the solver
**Context:** Flow Ink 2.0 looked good but lost v0.1's lock to the beat. Measured: only 9% of kicks produced a visible change in Flat. The DSP was fine (95–100% of kicks detected, ~30 ms); the incompressible solver needs hundreds of ms to turn a splat into motion, and hits added no brightness.
**Decision:** three frame-accurate layers keyed to the bass-hit envelope: (1) dye-only "kicks", a divergent, lopsided outward push applied to ink advection but not to the velocity field (so the pressure solve cannot cancel it); (2) an "energy" dye channel injected by hits that glows past 1.0 and decays in ~150 ms; (3) a global ink-brightness pulse. Responsiveness scales (1) and (3).
**Result:** `npm run verify -- --sync`: Ink Flat/Depth and Marble see 100% of kicks with 40–66% luminance jumps at 33–60 ms; Sumi (paper) 43–90% on the luminance metric, which undersells motion on paper.

## D14 — v0.1 palettes restored; drift off by default
The first seven palettes are v0.1's, in v0.1 order, so names and saved indices mean the same colours; four duotones follow. Flow Ink maps ink A = primary, ink B = accent, sparkle = highlight, as v0.1 did. Auto Drift (renamed "Colour drift") is off by default; settings v3 resets older saves that had it on.

## D15 — User camera for Depth
`CameraView` = height, tilt, curve (−1 bowl … +1 planet). Presets: Glide, Horizon, Planet, Valley, Overhead. Curvature is applied in the ground vertex shader around the camera (−k·d²) with matching normals; fog grows with altitude, and the sky's horizon band brightens with planet curvature (atmosphere). Mouse: drag turns/tilts (pans in Flat), wheel changes height (zooms in Flat), double-click snaps to the nearest preset, `C` cycles presets.

## D16 — Sync metric in the harness
`--sync` renders 12 s around the drop and scores, per known kick (exported by the generator), the largest relative luminance change within 133 ms. It is the regression test for "music and visuals in sync".

## D17 — Desktop capture recovers by itself
**Context:** plugging speakers into the 3.5 mm jack could stop the visuals while music kept playing. cpal reported the stream error but nothing reopened capture, and when the endpoint name stays the same (Realtek jack re-routing) the default-device poll saw no change. WASAPI loopback also delivers no packets during silence, so the renderer froze on its last frame.
**Decision:** a stream error flags the capture for reopen; a watchdog reopens after 3 s without samples (harmless during silence, quiet when it is the same device, keeps analysis state); after 120 ms without samples the pipeline analyses silence at the normal hop rate so visuals decay instead of freezing.

## D18 — Web audio sources: tab first, health-checked
**Context:** Chromium binds whole-computer (system) audio sharing to the output device active when sharing started; changing speakers/headphones silences it and a new capture needs a click. Tab audio follows the tab. The old source dropdown also could not re-select the same option, so re-sharing silently did nothing.
**Decision:** a source chooser with plain-language options (Browser tab — recommended, Whole computer, Microphone/line-in with device list, Audio file, Test tracks), a status chip with a live level meter, and a banner with one-click Reconnect when sharing stops or when a device change is followed by silence while music had been playing. Captures request raw audio (no echo cancellation / noise suppression / auto-gain, which Chromium otherwise applies). Microphones re-acquire automatically. The last capture type is remembered for a one-click reconnect on the next visit.
