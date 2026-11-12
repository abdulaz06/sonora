# Feedback round 3 — done

Abdul's notes after Phase 1: Silk's beat ripple/zoom overdid it on bass-heavy songs; Wisp drifted off screen and went blank on a second visit; Ink hit the beats but looked scattered; Voyage's backdrop reacted to beats and read as a thick dome, and the Kaleido drop replaced the best camera moment; Mosh still not good. Decided with him: remove Silk's ripple/zoom; Ink fixed anchors; Voyage thin curved world, stable on beats, drop = dive + barrel roll, beats = roll sway + FOV breath; scrap Mosh.

- [x] Wisp: fixed view (zoom only); second-visit blank fixed — cause was a fresh instance spawning at its world origin while the shared camera had drifted (D33)
- [x] Silk: beat zoom, ripple ring and thread pluck removed (D32)
- [x] Ink: beat anchors, all-anchor bloom every 4th kick, satellites, anchored drop (D34)
- [x] Voyage: world stable on beats, Kaleido drop removed, barrel-roll drop, roll sway + FOV breath, thin analytic cylinder landscape (D35)
- [x] Mosh removed (D36)
- [x] Verified: all styles × five tracks, sync, flicker, perf (1.1–3.3 ms Medium), live desktop app (Punchy, Ocean, dense track)

## Phase 2 (next, unchanged)
- [ ] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [ ] Wisp Depth view (same rules)

## Notes
- Voyage's landscape is seen through the fractal's openings, so the "curving up" reads best when the flight passes near the box's edges; a fly-out vista was the alternative not chosen.

---

# Feedback round 2 (after Prompt 2) — Phase 1 done

Abdul's review of every mode: Punchy flickered and several palettes blew out (all styles); Ink lost the original's tight sync; Silk is the favourite but friends could not see the sync on a phone video; Lumen, Starry Night, Turing and Kaleido not worth keeping; Wisp looked blank; Warp should follow the song's pace; Mosh repetitive and Concrete ugly; Voyage the most promising but should be more warped, with an endless curving world. Decisions taken with him first: lineup Ink/Silk/Wisp/Warp/Voyage/Mosh, Glow as Ink's default look, Punchy = motion not flashes, Silk sync via pluck + beat camera + drop transformation, Voyage cylinder world + beat folds, fixes first and 3D (Depth toggle, Flat default) as a separate phase.

## Phase 1 checklist
- [x] Flicker and exposure: hue-preserving tonemap, auto exposure, Responsiveness → motion only, `intensityGlow`, harness `--flicker` + `dense-128` (D25, D26)
- [x] Lineup and names; settings v4 migration (D27)
- [x] Ink: one kick, one splash (D28)
- [x] Silk: display-pass beat zoom / snap / ripple, pluck, build knot → drop starburst (D29)
- [x] Wisp: coloured smoke, bigger flames, bolder rings
- [x] Warp: pace follows the song; no blow-out at speed
- [x] Mosh: twisting palette-mapped Signal tunnel that reverses with the music (D30)
- [x] Voyage: cylinder backdrop world, melting space, beat corkscrew, drop Kaleido fold (D31)
- [x] Verified: all styles × five tracks, sync, flicker, perf, live desktop app (Punchy, Ocean, dense track)

## Phase 2 (next)
- [ ] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [ ] Wisp Depth view (same rules)

## Notes
- Root cause of the live flicker: Ink's beat pulse scaled brightness up to 2× at Punchy (45% of the frame blown out in a live capture) and the Punchy follower passed per-frame intensity noise into brightness. Live after the fix: no whiteouts on any style.
- The harness's sparse tracks did not reproduce real-music loudness; `dense-128` (16th hats, sidechained chords, heavy mastering) now backs the flicker / exposure checks.
- Silk: moving particles on the beat barely showed (trail buffer keeps 84% of the last frame); the beat motion now warps the whole image in the display pass. The harness "motion on kicks" figure did not capture this well; `scripts/kick-frames.mjs` frame sequences were used to judge it.
- Live desktop checks run on the primary display while Abdul works on the second; settings are backed up and restored around each run.
- Perf (1080p Medium): 1.4–4.5 ms for every style.

---

# Prompt 2: the art styles

## Summary (Prompt 2 complete)

**What shipped**
- Four new art styles after Flow Ink, in registry order: **Strands** (Silk, Lumen, Wisp, Starry Night, Warp), **Turing** (Coral, Bioluminescent), **Mosh** (Concrete, Signal), **Fractal** (Voyage, Kaleido). Aura and Halo stay hidden under Classic. Every look has a plain-language hint in Settings and a preview in `src/assets/previews/`.
- **Flash guard** (WCAG 2.3.1): deliberate flashes need `ctx.flash.request()` (at most 3 per second), and a GPU luminance probe damps any source that swings more than 3 times a second (D19).
- **Turing text seeding**: track titles grow into the pattern as readable words. Sources are the media session, files played on the dev page, and the new **Seed text** button (D22).
- **Fractal**: a raymarched Mandelbox flight on a spline planned by a CPU copy of the distance estimator. It marches at half resolution with a temporal upscale and an adaptive step budget (D24).
- **Frame rate** setting (added on request): 30 / 60 (default) / 90 / 120 / 144 / max. Auto quality judges frame time against the cap.
- Shared GL toolkit for styles (`src/styles/shared/`), plus scripts: `verify-art.sh`, `perf-art.sh`, `make-previews.py`.
- The desktop settings loader accepts files saved with a BOM (Notepad).

**Verification**
- All 11 new looks were rendered on all four test tracks (`scripts/verify-art.sh all`) and the contact sheets reviewed. Fixes from that review: Lumen redrawn as filament streaks, Turing thins out in breakdowns, Fractal's camera prefers open lines of sight, Starry Night is cheaper.
- Beat sync (`--sync`, house-124): every art look sees 91–100% of kicks, peaking 38–88 ms after each kick. Per-hit luminance jumps stay under the flash threshold.
- Performance, RX 7700S at 1080p Medium: 1.7–7.6 ms per frame for every look (budget 16.7 ms). Low is 1.2–3.7 ms. Full table in DOCS/16 §7.
- `npm run tauri build` produces the MSI and NSIS installers. In the built app with real system audio, Flow Ink, Silk, Starry Night, Coral, Concrete, Voyage and Kaleido all ran and reacted.

**What to look at**
- `npm run dev:web`: pick a test track, open Settings and try each Style and Look. Use **Seed text** with Turing. Settings › Quality › Frame rate sets the cap.
- `npm run verify -- --style fractal --variant voyage --track house-124`, then open `verify/fractal-voyage-depth/house-124/`.

**Known issues / follow-ups**
- Lumen's filaments are softer than the reference's hair-thin strands. Its colour comes from the palette, not true iridescence.
- Mosh's composition is centred on its vanishing point (it wanders slightly); variety between sections comes from smear and glitch more than from framing.
- Turing breakdowns thin the maze slowly (about 2.5 s ease), so the breakdown screenshot still shows mostly maze.
- At a drop on bright palettes, Kaleido can get very bright (drop flash now softened).
- The harness output folder still says `-depth` for styles without a depth view (cosmetic).


## Checklist
- [x] P2.1 Flash limiter (≤3 large luminance flashes/s), registry order Flow Ink, Strands, Turing, Mosh, Fractal
- [x] P2.2 Strands engine (GPU particles, density accumulation, quality-scaled counts)
- [x] P2.3 Strands: Silk (inversion cut on drop), Lumen, Wisp, Starry Night, Warp
- [x] P2.4 Turing (Gray-Scott, regimes, seeds, drop inversion) + Coral, Bioluminescent
- [x] P2.5 Turing text-seeding hook via trackChange + dev-page button
- [x] P2.6 Mosh (feedback, smear, glitch, freeze-release) + Concrete, Signal
- [x] P2.7 Fractal (raymarched, spline flight, adaptive, half-res + temporal) + Voyage, Kaleido
- [x] P2.8 Every variant verified on all four tracks; Quality Bar pass; perf at 1080p Medium
- [x] P2.9 Preview images src/assets/previews/<style>-<variant>.webp
- [x] P2.10 Docs: local notes, DOCS/16, decisions
- [x] P2.11 `npm run tauri build`; every style in the desktop app with system audio

## Notes (Prompt 2)
- Flash guard: request() tokens (≤3/s, 0.25 s gap) + async luminance probe with damping (D19). Overlay shows flashes/s.
- Strands: GPU particle engine shared by five looks. Lumen redrawn as instanced filament streaks after the first all-track review showed only a flare.
- Turing: Gray-Scott; title seeding with a cleared moat so words stay readable (D22); breakdowns thin the pattern.
- Mosh: analytic Droste tunnel after the resampling-feedback version blurred to mush (D21).
- Fractal: negative Mandelbox scales were nearly solid at flyable clearance (measured); Voyage 2.9, Kaleido 2.6. Planner keeps clearance and prefers long lines of sight (D24).
- Beat sync: first pass had Silk 22%, Wisp/Warp 9%, Starry/Coral 0% of kicks; added frame-accurate hit brightening/swelling → 91–100% everywhere, kept per-hit luminance jumps under the flash threshold.
- Perf (1080p Medium): 1.7–7.6 ms per frame for every look; Starry halved its strokes (12 → 7.6 ms). Table in DOCS/16 §7.
- Added: Frame rate setting (30/60/90/120/144/max, default 60) on Abdul's request; Auto quality judges against the cap.
- Verified: scripts/verify-art.sh all (11 looks × 4 tracks), contact sheets reviewed; previews via scripts/make-previews.py.

---

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

## Feedback round (after Prompt 1) — done
Abdul's side-by-side video (v0.1 vs 2.0, same song) showed 2.0 had lost beat sync, Flat was weaker than v0.1, colours looked wrong, controls were unclear, and asked for camera control and planet/bowl curvature.
- [x] Measured sync: DSP fine (95–100% kicks, ~30 ms); visuals responded to 9% of kicks (Flat). Added `npm run verify -- --sync`.
- [x] Beat response: dye-only kicks, energy glow channel, ink pulse (D13). Now 100% of kicks seen in Ink/Marble, 40–66% luminance jumps, 33–60 ms.
- [x] Flat: bolder v0.1-like ink masses (bigger soft splats, closer view, less decay) with filament detail; no more starburst splats.
- [x] Colours: v0.1 palettes restored in order; drift off by default + settings migration (D14). The video showed drift cycling hue every ~70 s.
- [x] Camera: presets Glide/Horizon/Planet/Valley/Overhead, Height/Tilt/Curve sliders, drag/scroll/double-click, `C` key (D15).
- [x] Controls explained: every setting has a plain-language hint; "Cycle" became "Drift speed — one full colour cycle every N minutes"; quality and background options describe what they do. Responsiveness now actually scales kick strength and pulse.
- [x] Live input latency: AudioWorklet block 1024 → 256 samples.
- [x] Bug: settings panel closed itself when a button re-rendered it.

## Audio selection round — done
- [x] Desktop: capture reopens on stream errors and after 3 s without samples; silence is analysed so visuals decay instead of freezing (D17).
- [x] Web: source chooser (tab recommended / whole computer / mic + device list / file / test tracks), status chip with level meter, reconnect banner, raw-audio constraints, mic auto re-acquire, remembered last source (D18).
- [x] Settings → Audio: level meter on both builds; desktop wording explains that the default follows Windows' current speakers/headphones; web button opens the chooser.
- [x] Tested: getDisplayMedia path in Edge with auto-accept flags (live → simulated device change → silence → reconnect banner; continued sound → no banner). Physical jack plugging not testable here.

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
