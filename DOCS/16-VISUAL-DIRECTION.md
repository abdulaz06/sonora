# 16 — Visual Direction & Art-Style Bible

> Source of truth for every art style Sonora ships. Supersedes the "modes" thinking in 05 and 15.
> Reference frames live in `DOCS/reference/` (contact sheets with timestamps; `-motion` files are 8 frames across ~1 s).
> **Open and look at the referenced images before building or tuning a style.**

---

## 1. The Quality Bar (every style must pass all of these)

Flow Ink is the floor, not the ceiling. A style is not done until:

1. **Layered:** at least 3 visually distinct elements reacting to *different* signals (e.g. body ← presence, impacts ← bass hits, detail ← high hits, scale/camera ← intensity). One shape reacting to everything is an automatic fail.
2. **Never static:** the composition visibly changes within any 8-second window of a steady loop. Use camera drift, field evolution, palette drift, and seeded variation; same song twice should look related but not identical.
3. **Wallpaper test:** a random frame is something you would set as a desktop wallpaper.
4. **Arc-aware:** silence → fade-in → build → drop → breakdown reads clearly. Quiet music = restraint and negative space. Drops land with a visible event (cut, inversion, burst, camera lurch), not just "more."
5. **Texture over blur:** fine detail (filaments, grain, stipple, strands) instead of soft gaussian mush. Every reference that looks good has fine-scale detail.
6. **Palette logic:** works with the shared color system (presets, custom hue, auto hue-drift). Duotone and near-monochrome palettes are encouraged; rainbow is not.
7. **Light and dark:** where the reference supports it, offer an inverted (ink-on-paper) variant.
8. **Performance:** 60 fps at 1080p on Medium on the dev machine (RX 7700S); Low preset genuinely reduces sim/render resolution, particle count, or raymarch steps.
9. **Self-verified:** the author has rendered it headless against the test tracks and looked at the screenshots before calling it done.

---

## 2. Reference Analysis (what each reel teaches)

| Ref | What it is | How it is made (best guess) | What Sonora takes from it |
|-----|-----------|------------------------------|---------------------------|
| 01, 11 | Photo textures (concrete, asphalt) recursively nested inside themselves, smeared diagonally, RGB block glitches | Feedback buffer (zoom + rotate each frame), luminance-driven displacement, pixel-sort style streaking, channel-offset glitch blocks | **Mosh** style. Recursion tunnel; beat = new nested frame + smear burst; hats = RGB glitch blocks. The most "underground" look in the set |
| 02 | Red-on-white labyrinth that grows from a few seeds, hidden text emerges, flips to spots at the end | Gray-Scott reaction-diffusion; text used as a seed mask; feed/kill parameter shift changes stripes → spots | **Turing** style. Hits seed new growth; intensity morphs pattern regime; **track title from media info seeds the pattern on song change** |
| 03 | Blue/violet hyperspace warp, white and gold sparks streaking from center | Particles flying toward camera with velocity-stretched sprites | Variant of **Strands** engine ("Warp"). Good as a drop/build layer, too generic alone |
| 04 | Arena LED wall: orange/black marbled fluid with fine stipple grain | Marbling / fluid sim rendered as duotone with grain/stipple, huge scale, slow | Direction for **Flow Ink 2.0**: duotone, fine grain, giant world much larger than the screen, slow camera drift ("Marble" variant) |
| 05 | Central light burst of thousands of hair-thin iridescent filaments; spreads into an X on loud moments | Dense particle traces (additive), anamorphic streak, chromatic dispersion | **Strands** "Lumen" variant: filament burst whose spread/shape follows energy and band balance |
| 06 | Sun glints on water shot as long exposure: gold and red horizontal light streaks | Specular highlights on a noise heightfield, temporal accumulation + horizontal motion blur | Later style **Glint** (backlog). Cheap, gorgeous, good for chill music |
| 07 | Black ink exploding in water on white, curling filaments, bursts | High-res fluid sim, vorticity, fine dye filaments | **Flow Ink 2.0** "Sumi" variant (ink on paper) and the target level of filament detail |
| 08 | Millions of particles forming silky gold ribbons on black; hard cuts to black-on-white; dust starfield | GPU particles advected by curl noise, additive density accumulation, beat-synced inversion cuts | **Strands** "Silk" variant — the headline new style. Beat/drop = inversion cut |
| 09 | Soap-bubble plasma orbs, iridescent rims, god rays, lens flares | 3D spheres with fresnel rims, volumetric light rays | Backlog **Prism**; feeds the parked laser-show/3D-light idea |
| 10 | A single bright wisp darting through black, leaving faint smoke trails and rings | One agent + trail accumulation, minimal | **Strands** "Wisp" variant: minimal ambient mode, agent speed/turns from audio |
| 12 | Long camera flight through raymarched 3D fractals (Mandelbulb/box), kaleidoscope sections, iridescent | Raymarched distance-field fractals, camera path, music-modulated parameters | **Fractal** style: true 3D, flying camera; fractal parameters breathe with presence, hits = folds/pulses |

Also from Abdul's own notes: **Starry Night** (built as a Strands variant rendering short brushstrokes along a swirling vortex field), **auto RGB hue drift** (shared color feature), **bigger-than-screen world with moving camera** (shared engine feature).

---

## 3. The Lineup for v1.0

Five engines. Variants are cheap once an engine exists.

| Style | Engine | Variants | Refs |
|-------|--------|----------|------|
| **Flow Ink** (flagship) | Fluid sim, large world, 3D camera over a displaced ink surface | Ink (dark, current look upgraded), Sumi (ink on paper), Marble (duotone + grain) | 04, 07 |
| **Strands** | GPU particle sim with density accumulation | Silk, Lumen, Wisp, Starry Night, Warp | 08, 05, 10, 03 |
| **Turing** | Reaction-diffusion | Coral (light), Bioluminescent (dark) | 02 |
| **Mosh** | Feedback buffer + displacement + glitch | Concrete (procedural grain texture), Signal (pure feedback from its own frames) | 01, 11 |
| **Fractal** | Raymarched distance fields + camera path | Voyage (flythrough), Kaleido (mirrored) | 12 |

Backlog: Glint (06), Prism (09), Laser Show (3D).
Classic: Aura and Halo move to a hidden "Classic" section (settings toggle, off by default).

---

## 4. Shared Engine Features (built once, used by every style)

- **World camera:** styles render into a world larger than the screen; a camera drifts, banks, and lurches on drops. 2D styles get pan/zoom/rotate; 3D styles get a full perspective camera with fog.
- **Color system:** presets + custom hue + **Auto Drift** (slow, near-imperceptible hue rotation, ~2–4 min per full cycle) + duotone support + light/dark (inverted) per style.
- **Event layer:** a single place that turns mapping signals into discrete events every style can subscribe to: `drop`, `build`, `breakdown`, `bigHit`, `trackChange`. Drop detection = sharp intensity rise after a sustained build or a silence gap.
- **Signal contract:** styles consume only the mapping layer (FadeInOut, Intensity, Presence×7, Hits×7, Juiced FFT, beat phase/confidence, events) — never raw element heuristics.

---

## 5. Signal → Visual Mapping per Style (starting point; tune by eye)

| Style | Macro (presence / intensity) | Meso (beat) | Micro (hits) | Drop event |
|-------|------------------------------|-------------|--------------|------------|
| Flow Ink | Mid presence = ink inflow; intensity = turbulence + camera speed | Beat phase = surface breathing | Bass = big splats + surface lift; highs = fine sparkle dye | Camera lurch + burst from off-screen |
| Strands | Presence = particle count/emission; intensity = flow speed | Beat = field direction pulse | Bass = shockwave in the field; highs = dust sparkle | Inversion cut (Silk), X-spread (Lumen) |
| Turing | Intensity = feed/kill regime (spots ↔ maze ↔ stripes) | Beat = growth pulses | Hits = seed drops at random positions | Pattern inversion + reseed |
| Mosh | Intensity = recursion zoom speed | Beat = new nested frame | Highs = RGB glitch blocks; bass = smear burst | Full mosh freeze-then-release |
| Fractal | Presence = fractal power/fold params | Beat = camera roll/pulse | Bass = fold "breath"; highs = iridescent shimmer | Kaleido flip or camera dive |

---

## 6. Notes for whoever builds these

- The reels were analysed from frames only; audio sync is inferred. Prioritise looking right on the reference frames, then sync.
- Fractal is the heaviest style: adaptive step count, half-res render with upscale on Low/Medium.
- Turing and Flow Ink share ping-pong FBO infrastructure; reuse it.
- Strands needs GPU-side particle state (float textures + ping-pong, or transform feedback). Do not simulate particles on the CPU.
- Mosh must not use any copyrighted photos; generate the concrete/asphalt texture procedurally.

---

## 7. What shipped in v1.0 (Prompt 2 + feedback rounds 2 and 3)

Registry order: **Ink, Silk, Wisp, Warp, Voyage**; Aura and Halo stay in the hidden Classic group. Lumen, Starry Night, Turing, Kaleido and Mosh were removed after review. Every style consumes only mapping signals and events, honours the palette, asks the flash guard before any deliberate flash, and follows the brightness rules: Responsiveness drives motion only, brightness rides the slow `intensityGlow` follower, hits have fixed headroom, and the hue-preserving tonemap plus auto exposure keep bright palettes coloured. Previews live in `src/assets/previews/`.

| Style | Engine | Body / intensity | Beat | Hits | Drop |
|-------|--------|------------------|------|------|------|
| **Ink** (Glow, Marble, Sumi) | Stable fluids on a periodic world; Depth surface or Flat | Mid presence → ink drizzle; intensity → turbulence, camera speed | Every 4th kick blooms all anchors | Bass → bloom from the next beat anchor (stable composition, fixed colour per anchor); mids → satellites; highs → sparkle around anchors | Every anchor blooms, new layout; camera lurch |
| **Silk** | GPU particles, density accumulation | Presence → active threads; intensity → flow speed | — | Bass → shockwave, thread brightening | Build gathers a knot → drop bursts into an eight-spoke starburst; inversion cut |
| **Wisp** | GPU particles + three CPU agents in a fixed view (zoom only) | Intensity → agent speed | — | Bass → smoke rings, flame flare; mids → swerves | Agents surge |
| **Warp** | GPU particle streaks | Slow intensity → cruise speed; slow-motion in breakdowns and quiet intros, regular pace with the beat, builds accelerate | Speed surge | Bass → streak glow | Hyperspace jump |
| **Voyage** | Mandelbox raymarch, CPU-planned spline flight, analytic cylinder landscape (fields, water, forests, cities), half-res + temporal upscale | Presence → fold params and melt; intensity → flight speed, glow; breakdowns fly out for wide shots | Camera roll sway + FOV breath; fractal corkscrew (the landscape never moves) | Bass → fold breath, emissive veins, slight chromatic split; highs → iridescence | Dive back in / surge + wide-angle punch + barrel roll |

**Performance** (RX 7700S, 1080p, synced frame cost at the house-124 drop; budget 16.7 ms):

| Style | Low | Medium |
|-------|-----|--------|
| Ink · Glow | 1.5 ms | 3.0 ms |
| Ink · Marble | 1.6 ms | 3.3 ms |
| Silk | 1.5 ms | 3.3 ms |
| Wisp | 1.1 ms | 1.6 ms |
| Warp | 1.1 ms | 1.4 ms |
| Voyage | 1.9 ms | 3.3 ms |

**Beat sync** (`--sync`, house-124): Ink Glow 100% (Depth and Flat), Marble 100%, Sumi 96%, Silk 91% (92% on dense-128), Wisp 100%, Warp 100%, Voyage 100% of kicks.

**Flicker / exposure** (`--flicker`, dense-128, Punchy, Ocean): Ink 0.08, Voyage 0.58, Silk 1.17, Wisp 1.25, Warp 1.42 brightness swings per second; at most 3.5% blown-out pixels at peak.

**Frame rate.** Settings › Quality › Frame rate caps rendering at 30, 60 (default), 90, 120, 144 fps or the display rate.
