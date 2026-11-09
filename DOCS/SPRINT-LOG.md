# Sprint log — Prompt 1: engine reset + Flow Ink 2.0

## Summary (Prompt 1 complete)

**What shipped**
- `crates/sonora-dsp`: the whole analysis pipeline as a platform-free crate, used by the desktop app (WASAPI) and compiled to WebAssembly for the browser. Native vs WASM parity verified frame by frame. Signal fixes along the way: per-band adaptive normalisation (hats/air now register), relative intensity, and a rewritten beat tracker (locks 124 BPM exactly).
- Browser front-end: `npm run dev:web` plays test tracks, any audio file (pick or drag & drop), the microphone or tab/system audio through an AudioWorklet into the WASM analyser. One `FrameSource` interface, Tauri and WASM implementations.
- Verification: procedural test tracks (`npm run gen:audio`), `npm run verify` (real GPU via system Edge, audio-time rendering, marker screenshots, 8-frame drop strip, FPS + synced frame cost), `npm run check:parity`, `npm run events`.
- Engine: event layer (drop / build / breakdown / bigHit / trackChange), world camera (2D drift and 3D glide with fog, beat bank, drop lurch), colour system (6 cinematic presets + 4 duotones, custom hue, Auto Drift, paper colour), real quality presets + Auto, style interface v2 + registry, new art post pipeline (highlight-only bloom, filmic/none tonemap, grain).
- Flow Ink 2.0: stable fluids on a periodic world, MacCormack ink advection, vortex-pair jets, Depth (default) and Flat views, Ink / Sumi / Marble with light/dark.
- Aura and Halo live in a hidden Classic group ("Show classic styles"). Settings panel restyled to the brand. README rewritten. `npm run tauri build` produces MSI + NSIS; the built app captured real system audio and rendered Flow Ink.

**What to look at**
- `npm run dev:web` → pick `house-124`, press `D` for the debug overlay (events, section, fps), `V` toggles Depth/Flat, try Sumi and Marble, and Background light/dark.
- `npm run verify -- --variant marble --palette 6 --track house-124` then open `verify/…/4-drop.png` and the `5-drop-strip-*` frames.
- Desktop: `npm run tauri dev` with music playing.

**Performance (RX 7700S, 1080p, synced frame cost)**: Low 1.37 ms · Medium 2.40 ms · High 3.62 ms · Flat (Medium) 2.21 ms. Real-time harness bench: ~105 fps (capped by headless rAF).

**Known issues / follow-ups**
- Depth view foreground is slightly soft at the very bottom of the screen (ink texture magnified ~4–5 px per texel at the closest point).
- Ink and Sumi go fully empty in true silence (intentional negative space); Marble keeps a slow-moving field.
- Builds can also fire on ambient swells; half-time music reads at half BPM in its drop.
- Brand fonts (Inter Display, IBM Plex Mono) are referenced but not yet bundled; the UI falls back to system fonts.
- Tauri npm packages were aligned to the Rust crates (2.12 / 2.7) after the workspace lockfile refresh.
- README video still shows Flow Ink v0.1.

## Quality Bar — Flow Ink 2.0 (self-assessed from harness screenshots, all four tracks)
1. Layered: inflow ← mid presence, jets/splats ← bass hits, sparkle ← high hits, turbulence + camera ← intensity, surface breathing ← beat. Pass.
2. Never static: camera drift, evolving flow, Auto Drift, seeded variation. Pass.
3. Wallpaper test: build, drop and breakdown frames on every variant. Pass (silence is intentionally empty).
4. Arc-aware: silence → sparse fade-in → denser build → drop burst + lurch → thin streams in breakdowns. Pass.
5. Texture over blur: filaments, curls, pigment grain, Marble stipple; highlight-only bloom. Pass (see foreground note).
6. Palette logic: presets, duotones, custom hue, Auto Drift (RGB crossfades). Pass.
7. Light and dark: all three looks. Pass.
8. Performance: far above 60 fps at 1080p Medium; Low is ~57% of Medium's cost. Pass.
9. Self-verified with `npm run verify` on house-124, halftime-140, ambient-pad, silence-fadein. Pass.

> Resume rule: read this file and `git log` first, then continue from the first unchecked item. Never redo checked work.

## Checklist

### 1. Repo reset
- [x] 1.1 Audit code/docs; remove superseded docs
- [x] 1.2 New local working notes (architecture, art-style system, Quality Bar, brand, git rules, harness)
- [x] 1.3 Aura + Halo moved to hidden Classic group ("Show classic styles", off by default)

### 2. Shared DSP crate + browser build
- [x] 2.1 `crates/sonora-dsp` platform-free analysis crate; Tauri app uses it
- [x] 2.2 WASM build of the same crate (`crates/sonora-dsp-wasm`)
- [x] 2.3 Browser audio front-end: AudioWorklet → WASM; file / mic / tab audio
- [x] 2.4 `FrameSource` interface with Tauri + WASM implementations
- [x] 2.5 `npm run dev:web` dev page (source, style/variant, FPS, debug overlay)
- [x] 2.6 Native vs WASM frame parity check

### 3. Verification harness
- [x] 3.1 `test-audio/` generator: house 124, half-time 140, ambient, silence + fade-in
- [x] 3.2 `npm run verify` Playwright harness (timestamps, 8-frame drop strip, FPS)

### 4. Shared engine features
- [x] 4.1 World camera (2D drift/zoom/rotate; 3D perspective + fog; intensity speed; drop lurch)
- [x] 4.2 Event layer (drop, build, breakdown, bigHit, trackChange) + debug overlay
- [x] 4.3 Colour system (cinematic presets, duotones, custom hue, Auto Drift, light/dark)
- [x] 4.4 Real quality presets (render scale, sim size, steps) + Auto
- [x] 4.5 Style interface v2 (category, variants, supportsLight, supportsDepth, event/camera hooks), documented

### 5. Flow Ink 2.0
- [x] 5.1 Stable-fluids sim (advection, divergence, Jacobi pressure, vorticity), hi-res dye
- [x] 5.2 World bigger than screen + camera drift
- [x] 5.3 Depth view (displaced surface, 3D camera, fog) + Flat toggle
- [x] 5.4 Fine detail (filaments, sharpened dye, grain, highlight-only bloom)
- [x] 5.5 Audio mapping per DOCS/16 §5
- [x] 5.6 Variants Ink / Sumi / Marble
- [x] 5.7 Verified on all four test tracks; Quality Bar pass; performance

### 6. Wrap-up
- [x] 6.1 `npm run tauri build` succeeds; desktop runs with system audio
- [x] 6.2 README refreshed; summary at top of this log

## Notes / decisions in flight
- DSP: per-band normalisation + beat tracker rewrite were needed for signals to be usable (see DECISIONS D3/D4). Parity native vs WASM: max diff one rounding quantum (1e-3).
- Event detector verified offline (`npm run events -- <track>`): house-124 build@40.4 drop@49.7 breakdown@83.2; halftime-140 build@16.2 drop@23.0 breakdown@52.8; ambient builds only on swells; silence-fadein no false drop.
- Harness runs on the RX 7700S via system Edge (Playwright's bundled browser build not cached). House track, 1080p Medium: ~165 fps.
- 4.5 interface is in code; documented in the local working notes ("Art-style system") and in `src/styles/visual-style.ts`.
- 1.1: the repo only tracked DOCS/14 (kept) besides assets; the superseded material was the README's old modes/limitations sections, rewritten. Older planning docs referenced by DOCS/16 (05, 15) were never committed.
- The working-notes file is gitignored by design (D12) and exists locally.
- 6.1: release build OK (MSI 3.5 MB, NSIS 2.3 MB); built exe captured "Speakers (Realtek(R) Audio) 48000 Hz" and rendered Flow Ink with a quiet test clip.

## Blocked on Abdul
- Nothing blocking.
