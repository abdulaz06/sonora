# Sonora: sprint brief after Prompts 1 and 2 (for planning Prompts 3 and 4)

Sonora is a Windows desktop music visualizer: a Tauri 2 shell, Rust WASAPI loopback capture, and a platform-free Rust DSP crate that also compiles to WebAssembly so the same renderer runs in a browser dev page and in a verification harness. The renderer is TypeScript with raw WebGL 2.

This brief covers what Prompts 1 and 2 delivered, then the six feedback rounds and the Phase 2 work since. The plan has drifted a long way from the original four prompts: the lineup, the engine rules and several styles all changed. Prompts 3 and 4 should be rewritten against the current state in section 4, not the original plan.

## 1. Prompt 1: engine reset + Flow Ink 2.0 (done as specified)
- **DSP crate** (`crates/sonora-dsp`): FFT, bands, per-band adaptive normalisation, onsets, a rewritten beat tracker and the mapping layer. Native and WASM output match frame for frame.
- **Browser dev page:** test tracks, files, mic, tab or system audio. The source chooser has a level meter and auto-reconnect.
- **Engine:**
  - event layer (drop / build / breakdown / bigHit / trackChange)
  - world camera: 2D drift; 3D glide with fog, beat bank and drop lurch; presets; height, tilt and planet/bowl curvature; mouse drag and scroll
  - colour engine: v0.1 palettes, duotones, custom hue, Auto Drift, paper colour
  - quality presets Low / Medium / High / Auto
  - style interface v2 + registry
  - art post pipeline
- **Verification harness** (`npm run verify`): renders in audio time on the real GPU and writes screenshots at silence / fade-in / build / drop / breakdown, plus a drop strip and frame cost. Added later:
  - `--sync`: the share of kicks the picture reacts to
  - `--flicker`: brightness swings and blow-out
  - a loud `dense-128` test track
- **Feedback after Prompt 1:**
  - The visuals had lost beat sync; fixed with frame-accurate reactions.
  - v0.1 palettes were restored.
  - Camera presets were added.
  - Every setting got a plain-language hint.
  - Desktop capture now auto-recovers.

## 2. Prompt 2: art styles (done, then heavily revised)
**Shipped as specified:**
- Strands, a GPU particle engine with five looks: Silk, Lumen, Wisp, Starry Night, Warp
- Turing (reaction-diffusion; track titles grow into the pattern)
- Mosh (datamosh tunnel)
- Fractal (raymarched Mandelbox flight; Voyage and Kaleido)
- a global **flash guard** (WCAG 2.3.1: at most 3 deliberate flashes per second, plus a luminance probe that damps swings)
- style previews
- verify scripts
- MSI/NSIS builds

**Added on request:**
- **Frame-rate cap**: 30 / 60 (default) / 90 / 120 / 144 / max.

## 3. What changed since (all done)

### Round 2: big restructure (Phase 1)
**Global fix: Punchy flickered and bright palettes blew out on every style.** New engine rules came out of it:
- Responsiveness (Smooth → Punchy) drives **motion only**, never brightness.
- Brightness rides a slow `intensityGlow` follower, and hits get fixed headroom.
- A hue-preserving filmic tonemap plus auto exposure.

**New lineup: Ink, Silk, Wisp, Warp, Voyage.** Aura and Halo stay hidden under Classic; a settings migration maps old IDs.
- **Removed:** Lumen, Starry Night, Turing, Kaleido, and Mosh's Concrete look (Mosh itself was scrapped in round 3).
- **Flow Ink → "Ink"**, with looks Glow (default), Marble and Sumi.
- **Silk, Wisp and Warp** became separate styles.
- **Fractal → "Voyage"**.

### Round 3
- **Silk:** the beat zoom, ripple and pluck were removed. Kept: bass shockwaves, inversion cut on drops, a build knot that bursts into a starburst on the drop.
- **Wisp:** now has its own fixed view; it used to go blank on a second visit.
- **Ink:** kicks bloom from fixed anchors. This was replaced again in round 6.
- **Voyage:** the Kaleido drop was removed; drops dive with a barrel roll, and beats sway the roll and breathe the FOV.
- **Mosh:** scrapped.

### Round 4
- Voyage's fractal beat reactions came back; only the backdrop stays still.
- Voyage got wide shots out of the fractal in calm moments.
- Warp got slow-motion sections: breakdowns and quiet intros at 10% pace.

### Round 5: Voyage backdrops
- **Void** (default): a dark sky with stars.
- **City:** a curved world baked into a texture, with 3D terrain, trees and street-grid cities; one wide shot shows a city hanging upside down.
- **Ocean:** huge swells.
- Wide shots return when the music picks up (capped at 10 s).

### Phase 2: Depth views for Silk and Wisp
- Each gets a Depth/Flat toggle with **Flat as the default**.
- Flat renders are pixel-identical to before.
- **Silk Depth:** ribbons float and dip over the ground under the gliding 3D camera; the dust shows the planet's outline. Abdul liked it.

### Round 6
- **Ink:** a first attempt at v0.1's feel (focus zone, beat light, flow hold, quasi-steady flow, ambient drizzle). Abdul judged it worse: Glow's hits still got carried off, Sumi lost its look and flickered, and Marble's hits teleported. Fully replaced in round 7.
- **Wisp Depth** got two looks:
  - **Ground:** flame-lit ground, embers.
  - **Tunnel:** a chase camera down an endless tunnel.
- **Camera:** a saved Flat **Zoom** (default mid-slider) and a new Planet preset.

### Round 7 (latest)
**Finding.** Abdul recorded current Ink on the same song as his v0.1 clip. Aligned by audio and measured frame by frame:
- 73% of round-6 Ink's motion was fine-detail shimmer, everywhere, all the time. v0.1 measures 34%: its change happens in big shapes.
- Still frames can't show this. Difference images and a large-vs-fine split can.

**Harness.**
- `scripts/motion-check.py` gates sequences:
  - fine-detail share of motion ≤45%
  - background (night/paper) step ≤0.02
- Flicker is now counted in both directions. Earlier checks missed dark flashes on paper.
- New flicker gates: swings ≤2.5/s, one-frame change ≤0.12, blown-out ≤6%. v0.1 itself is 3.1 swings/s and 0.11.
- `--sync` also reports regional sync.
- Private real-song tracks (`scripts/add-local-track.py`).

**Engine.** The flash guard now counts darkening too. Its exposure hold had an unstable one-frame-late loop that flipped paper looks between white and grey every frame; it's now smoothed and bounded.

**Ink, all looks:** ported v0.1's motion model.
- A curl-noise velocity field (no momentum), with soft advection.
- v0.1's impulses: a big soft blob near the centre per kick, smaller ones for mids and highs.
- Each hit builds over 3 frames.
- The field evolves and jumps on drops, so it doesn't repeat.
- Glow measures 42% fine share.
- The looks only change drawing and drops:

| Look | Drawing and drops | Beat response |
|---|---|---|
| Glow | linear shading, as v0.1 | its new ink |
| Sumi | round ink drops on bone paper | no beat pulse, no wash |
| Marble | a renewing marbled field, same motion and hits | its round-5 gentle brightening |

**Settings per style (v5):** palette, drift, responsiveness, camera and Flat zoom are stored per style, with a "Same colours for every style" option. Quality and frame-rate cap stay global. Presets can differ per style: Silk's Planet is 0.9 / 0.73 / 1.

**Wisp Depth.**
- Flames are kept on screen.
- Embers drift on their own and swirl in the flames' wakes. They ride bass rings and stir on kicks.
- A gentler drop flare in Depth.

**Status:** Abdul is reviewing round 7 before Prompt 3.

## 4. Current state (what Prompts 3 and 4 should assume)

**Styles:**

| Style | Looks | Views |
|---|---|---|
| Ink (v0.1 motion) | Glow / Marble / Sumi | Depth default, Flat |
| Silk | — | Flat default, Depth |
| Wisp | Depth looks: Ground / Tunnel | Flat default, Depth |
| Warp | — | — |
| Voyage | Void / City / Ocean | — |

Classic Aura and Halo stay hidden.

**Engine rules now in force:**
- Beat sync is the product: every look must react to at least 90% of kicks (whole screen, or by region for paper looks), starting on the frame of the hit.
- Responsiveness drives motion only; `intensityGlow` drives brightness.
- Flash guard; auto exposure and the hue tonemap.
- Flicker gates on `dense-128` at Punchy: swings in either direction ≤2.5/s, one-frame change ≤0.12, blown-out ≤6%.
- Motion gate (`motion-check.py`): fine-detail share ≤45%, background step ≤0.02. Busy shimmer and paper or background pulsing are treated as bugs.
- Every style uses the camera and responds visibly to the drop.

**Measured now:**
- **Sync:** 96–100% of kicks for every look.
- **Frame cost** (RX 7700S, 1080p Medium): about 1.4–4.6 ms per style; Voyage wide shots peak around 5.8 ms.

**Tooling:**
- `npm run verify` with `--sync`, `--flicker`, `--quality`, `--palette`, `--flat`, `--camera`
- `verify-art.sh`, `perf-art.sh`, `flicker-art.sh`
- `kick-frames.mjs`, `snapshots.mjs`
- `beat-strip.mjs` (a 50 ms frame strip across two beats)
- `frame-seq.mjs` and `motion-check.py` (motion and flicker gates on sequences or recordings)
- `add-local-track.py` (private real-song tracks)
- a live desktop-check script

**Settings:**
- version 5
- everything visual is stored per style (palette, drift, responsiveness, camera, Flat zoom), with an optional shared-colours toggle
- depth and light mode per style
- quality and frame-rate cap global

**Docs:** decisions D1–D49 in `DOCS/DECISIONS.md`, a sprint log per round in `DOCS/SPRINT-LOG.md`, the art bible and Quality Bar in `DOCS/16-VISUAL-DIRECTION.md`.

## 5. Things the original plan assumed that changed
- **Style count and names:** five art styles instead of four "families" with many looks. Turing, Mosh, Lumen, Starry Night and Kaleido are gone, so later prompt items about them (text-seeding UI, Mosh presets, and so on) are obsolete.
  - The Turing text-seeding hook (`trackChange` → seed text) no longer has a consumer.
- **3D is a per-style toggle** (Ink, Silk, Wisp). Voyage, Warp and Wisp Tunnel are inherently 3D with their own cameras.
- **Brightness, flash and sync handling is an engine-level contract.** New styles or features must follow it and pass `--flicker` and `--sync`.
- **Abdul prefers this process:**
  - Ask questions before each round.
  - Work in small separate phases he can assess one at a time.
  - Study references (videos, screenshots) before tuning.
  - Judge motion with measurements on sequences or recordings, not still frames.
  - Never let a fixed flicker return.

## 6. Open items and known issues
- Brand fonts (Inter Display, IBM Plex Mono) are referenced but not bundled; the UI falls back to system fonts.
- The README video still shows v0.1.
- Ink Depth is slightly soft at the very bottom of the screen.
- Half-time music reads at half BPM in its drop, which also lengthens Ink's beat-light fade there.
- Builds can fire on ambient swells.
- Voyage's City and Ocean are judged at viewing distance only.
- The per-style settings UI (switching styles in the panel, the shared-colours toggle) was verified in code, by a migration test and in the desktop app via saved settings, but not clicked through in the browser this round.
