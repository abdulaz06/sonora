# Sprint log — Prompt 1: engine reset + Flow Ink 2.0

> Resume rule: read this file and `git log` first, then continue from the first unchecked item. Never redo checked work.

## Checklist

### 1. Repo reset
- [ ] 1.1 Audit code/docs; remove superseded docs
- [ ] 1.2 New `CLAUDE.md` (architecture, art-style system, Quality Bar, brand, git rules, harness)
- [ ] 1.3 Aura + Halo moved to hidden Classic group ("Show classic styles", off by default)

### 2. Shared DSP crate + browser build
- [ ] 2.1 `crates/sonora-dsp` platform-free analysis crate; Tauri app uses it
- [ ] 2.2 WASM build of the same crate (`crates/sonora-dsp-wasm`)
- [ ] 2.3 Browser audio front-end: AudioWorklet → WASM; file / mic / tab audio
- [ ] 2.4 `FrameSource` interface with Tauri + WASM implementations
- [ ] 2.5 `npm run dev:web` dev page (source, style/variant, FPS, debug overlay)
- [ ] 2.6 Native vs WASM frame parity check

### 3. Verification harness
- [ ] 3.1 `test-audio/` generator: house 124, half-time 140, ambient, silence + fade-in
- [ ] 3.2 `npm run verify` Playwright harness (timestamps, 8-frame drop strip, FPS)

### 4. Shared engine features
- [ ] 4.1 World camera (2D drift/zoom/rotate; 3D perspective + fog; intensity speed; drop lurch)
- [ ] 4.2 Event layer (drop, build, breakdown, bigHit, trackChange) + debug overlay
- [ ] 4.3 Colour system (cinematic presets, duotones, custom hue, Auto Drift, light/dark)
- [ ] 4.4 Real quality presets (render scale, sim size, steps) + Auto
- [ ] 4.5 Style interface v2 (category, variants, supportsLight, supportsDepth, event/camera hooks), documented

### 5. Flow Ink 2.0
- [ ] 5.1 Stable-fluids sim (advection, divergence, Jacobi pressure, vorticity), hi-res dye
- [ ] 5.2 World bigger than screen + camera drift
- [ ] 5.3 Depth view (displaced surface, 3D camera, fog) + Flat toggle
- [ ] 5.4 Fine detail (filaments, sharpened dye, grain, highlight-only bloom)
- [ ] 5.5 Audio mapping per DOCS/16 §5
- [ ] 5.6 Variants Ink / Sumi / Marble
- [ ] 5.7 Verified on all four test tracks; Quality Bar pass; performance

### 6. Wrap-up
- [ ] 6.1 `npm run tauri build` succeeds; desktop runs with system audio
- [ ] 6.2 README refreshed; summary at top of this log

## Notes / decisions in flight

## Blocked on Abdul
