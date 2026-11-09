# Sprint log — Prompt 1: engine reset + Flow Ink 2.0

> Resume rule: read this file and `git log` first, then continue from the first unchecked item. Never redo checked work.

## Checklist

### 1. Repo reset
- [ ] 1.1 Audit code/docs; remove superseded docs
- [ ] 1.2 New `CLAUDE.md` (architecture, art-style system, Quality Bar, brand, git rules, harness)
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
- [ ] 5.4 Fine detail (filaments, sharpened dye, grain, highlight-only bloom)
- [ ] 5.5 Audio mapping per DOCS/16 §5
- [ ] 5.6 Variants Ink / Sumi / Marble
- [ ] 5.7 Verified on all four test tracks; Quality Bar pass; performance

### 6. Wrap-up
- [ ] 6.1 `npm run tauri build` succeeds; desktop runs with system audio
- [ ] 6.2 README refreshed; summary at top of this log

## Notes / decisions in flight
- DSP: per-band normalisation + beat tracker rewrite were needed for signals to be usable (see DECISIONS D3/D4). Parity native vs WASM: max diff one rounding quantum (1e-3).
- Event detector verified offline (`npm run events -- <track>`): house-124 build@40.4 drop@49.7 breakdown@83.2; halftime-140 build@16.2 drop@23.0 breakdown@52.8; ambient builds only on swells; silence-fadein no false drop.
- Harness runs on the RX 7700S via system Edge (Playwright's bundled browser build not cached). House track, 1080p Medium: ~165 fps.
- 4.5 interface is in code; the CLAUDE.md write-up is part of 1.2.

## Blocked on Abdul
