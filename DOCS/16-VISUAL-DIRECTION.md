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
6. **Palette logic:** works with the shared color system (presets, custom hue, auto hue-drift) and passes the palette gates (§8) with every palette. Vivid, saturated, cinematic; never dry, washed-out or near-monochrome; rainbow is not the goal either.
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
- **Color system:** nine presets + custom hue + **Auto Drift** (slow hue rotation, ~2–4 min per full cycle) + light/dark (inverted) per style. See §8.
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
| **Ink** (Glow, Marble, Sumi) | v0.1 Flow Ink motion on a periodic world: a curl-noise velocity field (no momentum), soft advection; Depth surface or Flat | Intensity → flow speed (motion) and how long ink lingers (glow follower); camera speed | — | Bass → a big soft blob near the centre at a random angle with a one-frame push (lands over three frames); mids / highs → smaller blobs anywhere. Sumi: round ink drops; Marble: blobs mix into its marbled field, gentle beat brightening | New flow pattern + bigger blob (six-frame build); camera lurch |
| **Silk** | GPU particles, density accumulation; Flat (default) or Depth (ribbons floating over the ground) | Presence → active threads; intensity → flow speed | — | Bass → shockwave, thread brightening | Build gathers a knot → drop bursts into an eight-spoke starburst; inversion cut |
| **Wisp** (Depth looks: Ground, Tunnel) | GPU particles + three CPU agents; Flat (default, fixed view, zoom only); Depth Ground (flames light the ground beneath them, floating embers); Depth Tunnel (stateless tunnel particles on lanes and rings, chase camera, trails from a flame-path history) | Intensity → agent speed; Tunnel pace follows the song like Warp | Tunnel: a ring of light races down the walls, camera roll sway | Bass → smoke rings, flame flare; mids → swerves | Agents surge; Tunnel bursts forward |
| **Warp** | GPU particle streaks | Slow intensity → cruise speed; slow-motion in breakdowns and quiet intros, regular pace with the beat, builds accelerate | Speed surge | Bass → streak glow | Hyperspace jump |
| **Voyage** (Void, City, Ocean) | Mandelbox raymarch, CPU-planned spline flight, backdrops: starfield / baked-layout 3D curved city world / curved ocean of swells; half-res + temporal upscale (wide shots sharper) | Presence → fold params and melt; intensity → flight speed, glow; calm moments fly out for wide shots, return as the music picks up | Camera roll sway + FOV breath; fractal corkscrew (backdrops never move) | Bass → fold breath, emissive veins, slight chromatic split; highs → iridescence | Dive back in / surge + wide-angle punch + barrel roll |

**Performance** (RX 7700S, 1080p, synced frame cost at the house-124 drop; budget 16.7 ms):

| Style | Low | Medium |
|-------|-----|--------|
| Ink · Glow | 1.3 ms | 1.6 ms |
| Ink · Marble | 1.5 ms | 2.8 ms |
| Silk (Flat / Depth) | 1.5 / 1.8 ms | 4.6 / 4.6 ms |
| Wisp (Flat / Ground / Tunnel) | 1.1 / 1.2 / 1.05 ms | 1.6 / 1.7 / 1.4 ms |
| Warp | 1.1 ms | 1.4 ms |
| Voyage · Void / City / Ocean | 2.0 / 2.3 / 2.1 ms | 3.4 / 3.5 / 3.3 ms (wide shots 3.5–5.8 ms at 1080p) |

**Beat sync** (`--sync`, house-124): Ink Glow 96–100%, Marble 96–100%, Sumi 100% by region (`regional seen`; a drop on paper barely moves the screen mean), Silk 91% (92% on dense-128; Depth 91–100%), Wisp 100% (Ground and Tunnel 100%), Warp 100%, Voyage 100% of kicks.

**Flicker / exposure** (`--flicker`, dense-128, Punchy, Ocean): Voyage 0.58, Silk 1.17 (Depth 0.83), Wisp 1.25 (Ground 0.83, Tunnel 1.5), Ink Glow 1.9–2.4 (v0.1 itself 3.1), Marble 0.1–1.0, Sumi 0, Warp 1.42 brightness swings per second; at most ~5% blown-out pixels at peak. Gates (D47): swings either way ≤2.5/s, largest one-frame change ≤0.12, blown-out ≤6%; `scripts/motion-check.py`: fine-detail share of motion ≤45% (v0.1 34%), background step ≤0.02.

**Frame rate.** Settings › Quality › Frame rate caps rendering at 30, 60 (default), 90, 120, 144 fps or the display rate.

---

## 8. Colour (palette overhaul for 1.0.1; D67–D71)

**What Abdul wants:** colours that make the visuals richer: vivid, saturated, cinematic. Loved: Ocean, Neon, Crimson, Violet. Hated: Ivory / Black (plain white on black) and dull duotones. Every palette must look great in every style, look and view.

**Rules (measured with the palette matrix, `DOCS/reference/palettes/PALETTE-RESEARCH.md`):**
- **Analogous core:** primary and secondary about 20–60° apart (OKLCH hue). Styles blend them (additive strands, Voyage's stone bands, nebulae); distant hues averaged in RGB cancel toward grey (Aurora 1.0 lost 70% of its chroma there).
- **One contrasting accent** that works as a small detail and as Ink's large second ink. Not complementary to the primary in styles that add them as equal light: Wisp's second flame is the accent, and green + magenta flames add up to white (Acid moved to an ultraviolet accent).
- **Highlight:** a lighter version of the core, warm cores toward yellow, cool cores toward cyan.
- **High chroma, matched lightness:** palettes are defined in OKLCH and converted with gamut mapping by chroma reduction (`src/engine/oklch.ts`), so brightness is even across palettes; primaries sit at L 0.55–0.68. Yellow and gold need care: a dark yellow reads olive, so golds stay light and the engine's `shade` slot (the primary's dark tone) turns them toward amber; yellow-greens stay lighter instead.
- **Dark, palette-tinted background** (OKLCH L 0.13–0.16, a whisper of chroma); a lighter floor lowers Ink Glow's flicker swings. Sumi's paper stays bone.
- **Styles never average two distant slots in RGB.** Mix along the hue (Voyage's `keepChroma`) or let bands pick one colour. Additive build-up is compressed hue-preservingly (Wisp's smoke), so dense light stays coloured instead of greying.

**The set (keys 1–9; OKLCH L C h — bg / primary / secondary / accent / highlight):**

| # | Palette | bg | primary | secondary | accent | highlight |
|---|---|---|---|---|---|---|
| 1 | Ocean | .133 .014 284 | .572 .174 262 | .457 .174 294 | .770 .121 195 | .793 .099 232 |
| 2 | Aurora | .16 .022 200 | .66 .16 158 | .62 .11 195 | .62 .22 315 | .88 .12 170 |
| 3 | Ember | .142 .010 33 | .626 .198 37 | .655 .131 70 | .522 .173 17 | .847 .155 89 |
| 4 | Neon | .14 .012 302 | .669 .280 328 | .871 .148 195 | .952 .203 110 | .687 .200 353 |
| 5 | Crimson | .139 .012 6 | .591 .228 21 | .608 .167 38 | .627 .221 345 | .683 .174 28 |
| 6 | Solar | .15 .02 60 | .68 .155 68 | .63 .18 48 | .66 .22 355 | .90 .13 80 |
| 7 | Violet | .139 .012 308 | .548 .230 302 | .554 .199 328 | .490 .206 276 | .702 .178 313 |
| 8 | Sunset | .14 .025 330 | .64 .24 355 | .55 .24 315 | .72 .18 55 | .86 .09 50 |
| 9 | Acid | .16 .028 150 | .64 .21 145 | .70 .20 132 | .60 .24 280 | .86 .15 165 |

Ocean, Ember, Neon, Crimson and Violet are v0.1's colours exactly (Neon's background lifted from L 0.125 to 0.14 like the others'). The four duotones are gone; saved choices migrate by name (settings v8).

**Custom hue** builds the same structure from one hue: primary at L 0.62 (+ a hue lift toward the gamut cusp: yellows and cyans lighter, blues darker), secondary +35°, accent +150°, highlight L 0.88 leaning to yellow or cyan. **Auto Drift** turns every hue in OKLCH with the same lift; palette changes crossfade in OKLCH along the shorter hue arc (never through grey).

**Metrics and gates** (`npm run verify -- --palette-matrix`, `scripts/palette-metrics.py`, thresholds in `scripts/palette-thresholds.json`, calibrated on the 1.0 palettes: good = Ocean / Neon / Crimson / Violet, bad = Ivory / Black, Aurora in Voyage). Per frame on the content (lit pixels on dark looks, ink on paper): mean OKLCH chroma (≥ 0.85 × the lowest good palette in that combo), grey share (≤ highest good + 10 points), off-palette share (hues far from every palette hue and from the arcs between nearby ones; ≤ highest good + 10), olive share (dark yellows; ≤ highest good + 5), exposure (content L and whole-frame L within ±0.07 of Ocean in the same combo), separation (k-means ΔE ≥ 0.8 × lowest good; Ink A vs B ΔE×100 ≥ 10). Plus the flicker / blown-out gates for every palette × combo (`palette-matrix.mjs --flicker`).

