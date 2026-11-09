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

## D12 — CLAUDE.md and .claude/ stay untracked
They are listed in `.gitignore` as local development-assistant files; the project-facing docs live in `DOCS/` and `README.md`.
