# Palette overhaul + 1.0.1 — done (awaiting review; type "Ship it" to release)

> Resume rule: read this section and `git log`, continue from the first unchecked item. Never redo checked work.
> Frames: `C:/Users/abdul/sonora-palette-frames/<set>/` (outside OneDrive, delete at the end); sheets + metrics: `verify/palettes/<set>/`.

## Summary

**Look first:** `verify/palettes/review/` — `before-after.jpg` (every style / look / view, the 1.0 palettes left, the new set right), `voyage-before-after.jpg` (all three backdrops), `palette-<name>.jpg` (each palette in every style / look / view, two songs), `ink-before-after.jpg` (the only two Ink colour changes), `clips/<style>.mp4` (the same seeded passage once per palette, labelled 1–9) and `clips/drift-cycle-ink-glow-depth.mp4` (one full Auto Drift turn at 2×). In the app: keys 1–9.

### The set (OKLCH L C h; DOCS/16 §8)
| # | Palette | bg | primary | secondary | accent | highlight | notes |
|---|---|---|---|---|---|---|---|
| 1 | Ocean | .133 .014 284 | .572 .174 262 | .457 .174 294 | .770 .121 195 | .793 .099 232 | v0.1, unchanged |
| 2 | Aurora | .16 .022 200 | .66 .16 158 | .62 .11 195 | .62 .22 315 | .88 .12 170 | reworked: teal-green core, orchid accent |
| 3 | Ember | .142 .010 33 | .626 .198 37 | .655 .131 70 | .522 .173 17 | .847 .155 89 | v0.1, unchanged |
| 4 | Neon | .14 .012 302 | .669 .280 328 | .871 .148 195 | .952 .203 110 | .687 .200 353 | v0.1; bg .125 → .14 (Glow Depth flicker) |
| 5 | Crimson | .139 .012 6 | .591 .228 21 | .608 .167 38 | .627 .221 345 | .683 .174 28 | v0.1, unchanged |
| 6 | Solar | .15 .02 60 | .68 .155 68 | .63 .18 48 | .66 .22 355 | .90 .13 80 | Gold reworked: amber, never olive |
| 7 | Violet | .139 .012 308 | .548 .230 302 | .554 .199 328 | .490 .206 276 | .702 .178 313 | v0.1, unchanged |
| 8 | Sunset | .14 .025 330 | .64 .24 355 | .55 .24 315 | .72 .18 55 | .86 .09 50 | new |
| 9 | Acid | .16 .028 150 | .64 .21 145 | .70 .20 132 | .60 .24 280 | .86 .15 165 | new (ultraviolet accent, not magenta) |

Duotones gone; saved choices migrate by name (settings v8: Gold → Solar, Ember / Black → Ember, Crimson / Black → Crimson, Cold / Black and Ivory / Black → Ocean; custom hue and drift kept).

### Colour metrics, final set (content chroma · grey share; thresholds calibrated on the 1.0 palettes)
Every palette passes every colour gate (chroma, grey, off-palette, olive, exposure vs Ocean, separation) in all 19 combos, and every flicker / blown-out gate on dense-128 at Punchy (Silk's deliberate inversion cut excepted, unchanged from 1.0: 1-frame step 0.64–0.77 for every palette). Sumi and paper looks are ink on bone by design (low chroma for every palette, as in 1.0).

| combo | Ocean | Aurora | Ember | Neon | Crimson | Solar | Violet | Sunset | Acid |
|---|---|---|---|---|---|---|---|---|---|
| ink-glow-depth | 0.092 · 8% | 0.090 · 8% | 0.118 · 8% | 0.130 · 9% | 0.146 · 8% | 0.103 · 8% | 0.144 · 8% | 0.133 · 8% | 0.116 · 8% |
| ink-glow-flat | 0.089 · 8% | 0.087 · 9% | 0.114 · 8% | 0.126 · 9% | 0.140 · 8% | 0.099 · 8% | 0.140 · 8% | 0.129 · 8% | 0.113 · 9% |
| ink-marble-depth | 0.120 · 0% | 0.116 · 0% | 0.136 · 0% | 0.196 · 0% | 0.167 · 0% | 0.110 · 0% | 0.168 · 0% | 0.171 · 0% | 0.158 · 0% |
| ink-marble-flat | 0.120 · 0% | 0.116 · 0% | 0.137 · 0% | 0.196 · 0% | 0.167 · 0% | 0.110 · 0% | 0.169 · 0% | 0.171 · 0% | 0.158 · 0% |
| ink-sumi-depth | 0.007 · 100% | 0.008 · 100% | 0.009 · 100% | 0.008 · 100% | 0.009 · 100% | 0.009 · 100% | 0.008 · 100% | 0.009 · 100% | 0.008 · 100% |
| ink-sumi-flat | 0.008 · 100% | 0.008 · 100% | 0.009 · 100% | 0.009 · 100% | 0.009 · 100% | 0.009 · 100% | 0.008 · 100% | 0.009 · 100% | 0.009 · 100% |
| ink-glow-flat-light | 0.039 · 63% | 0.036 · 62% | 0.053 · 53% | 0.063 · 54% | 0.060 · 50% | 0.047 · 53% | 0.053 · 55% | 0.063 · 50% | 0.043 · 56% |
| ink-marble-flat-light | 0.075 · 5% | 0.079 · 1% | 0.092 · 0% | 0.136 · 0% | 0.112 · 0% | 0.073 · 1% | 0.107 · 0% | 0.117 · 0% | 0.102 · 0% |
| ink-sumi-flat-dark | 0.006 · 98% | 0.012 · 97% | 0.011 · 97% | 0.008 · 98% | 0.011 · 98% | 0.015 · 97% | 0.008 · 98% | 0.013 · 98% | 0.019 · 97% |
| silk-flat | 0.077 · 27% | 0.084 · 30% | 0.093 · 27% | 0.142 · 26% | 0.123 · 26% | 0.076 · 31% | 0.120 · 26% | 0.099 · 26% | 0.117 · 27% |
| silk-depth | 0.080 · 25% | 0.089 · 25% | 0.095 · 25% | 0.143 · 25% | 0.124 · 25% | 0.083 · 25% | 0.124 · 25% | 0.104 · 25% | 0.120 · 25% |
| silk-flat-light | 0.024 · 81% | 0.026 · 81% | 0.029 · 81% | 0.040 · 80% | 0.035 · 80% | 0.028 · 81% | 0.035 · 80% | 0.034 · 80% | 0.037 · 80% |
| wisp-flat | 0.073 · 8% | 0.080 · 11% | 0.103 · 1% | 0.111 · 2% | 0.125 · 1% | 0.085 · 10% | 0.120 · 0% | 0.091 · 12% | 0.098 · 2% |
| wisp-ground | 0.066 · 9% | 0.066 · 16% | 0.089 · 2% | 0.093 · 7% | 0.113 · 1% | 0.072 · 8% | 0.110 · 1% | 0.079 · 8% | 0.084 · 4% |
| wisp-tunnel | 0.070 · 3% | 0.063 · 11% | 0.095 · 1% | 0.085 · 3% | 0.124 · 0% | 0.076 · 3% | 0.119 · 1% | 0.084 · 3% | 0.082 · 3% |
| warp | 0.110 · 1% | 0.094 · 1% | 0.118 · 1% | 0.114 · 4% | 0.148 · 0% | 0.110 · 1% | 0.155 · 0% | 0.158 · 1% | 0.140 · 0% |
| voyage-void | 0.094 · 4% | 0.078 · 8% | 0.113 · 1% | 0.121 · 6% | 0.149 · 1% | 0.090 · 3% | 0.144 · 3% | 0.131 · 2% | 0.110 · 3% |
| voyage-city | 0.092 · 4% | 0.077 · 7% | 0.109 · 0% | 0.109 · 6% | 0.143 · 0% | 0.091 · 2% | 0.137 · 3% | 0.125 · 1% | 0.106 · 2% |
| voyage-ocean | 0.098 · 2% | 0.076 · 7% | 0.109 · 1% | 0.109 · 6% | 0.145 · 0% | 0.092 · 2% | 0.145 · 1% | 0.133 · 1% | 0.108 · 2% |

### What changed in each style's colour mapping, and why
- **Voyage (D69):** the stone was `mix(grey 0.64, tint, 0.42)` — 0.06–0.11 chroma for any palette, and an RGB average of a distant primary / secondary (Aurora, Neon) cancelled to grey. Bands now pick between the core colours with a chroma-keeping blend, the tint is normalised to a fixed value (78% of the albedo, ±10% value with the bands so the forms read), the nebula uses the core colours, and the sea / crest light take the secondary. Ocean: chroma 0.055–0.063 → 0.092–0.098, grey 12–20 → 2–4%, frame brightness +0.01–0.02. Aurora grey 57 → 8%, Neon 44–48 → 6%.
- **Wisp (D70):** the smoke's per-channel `1 − exp` greyed dense coloured trails; half of a hue-preserving version is blended in: grey Ocean Flat 21 → 8%, Tunnel 8 → 3%, at the same brightness.
- **Ink (signed off):** no slot changes for the presets. A derived `shade` slot (the primary's dark tone) feeds Marble on paper: identical to primary × 0.55 for every palette except golds, which it turns amber (Solar there was mustard-olive; stills in `ink-before-after.jpg`). Neon's background lift is the other Ink-visible change (invisible in the stills, fixes Glow Depth flicker).
- **Silk, Warp:** no mapping change (already saturated; their numbers are identical).
- **Custom hue / Auto Drift / crossfades (D71):** OKLCH everywhere; the RGB crossfade dipped to grey in 6 of 36 preset pairs (Ocean ↔ Solar to chroma 0.008), the OKLCH one never below 0.103.

### Gates at Ocean, 1.0 → now (`verify/palettes/gates/baseline-ocean.log`, `…/new-ocean.log`)
| look · view | sync house / song | flicker swings · step · blown-out | fine share house / song | bg step p99 |
|---|---|---|---|---|
| Ink (all six) | identical (Glow 100/100, Marble 100/96, Sumi regional 100) | identical | identical | identical |
| Silk Flat / Depth | 91/96 · 91/96, identical | identical (step = inversion cut) | identical | identical |
| Wisp Flat | 100/100 → 100/100 | 1.25 · 0.062 · 3.2% → same | 48/70 → 50/72% | 0.0125 → 0.0136 |
| Wisp Ground / Tunnel | 100/100 → 100/100 | same | 46/53 → 47/53, 67/68 → 66/68% | ≈ |
| Warp | identical | identical | identical | identical |
| Voyage Void | 100/100 → 100/100 (rise 35.8/80.1 → 32.6/71.9%) | 1.33 · 0.079 → 1.00 · 0.075 | 74/75 → 74/76% | 0.0133 → 0.0153 |
| Voyage City / Ocean | 100/100 → 100/100 (rise −1 to −3 points) | 0.50 / 0.83 → 0.50 / 0.67 | 78/75 → 77/75% | 0.033 → 0.025 |

### Custom hue and Auto Drift (`verify/palettes/hues/`, `…/drift*/`)
- **Custom hue, every 15° (24 × 19 combos × 2 tracks):** all 24 pass every colour gate. The primary skips the olive band (a pick at 65–140° becomes gold ~66° or lime ~138°) and the dull cyan band (162–245° → teal ~160° or azure ~243°, with the picked cyan kept as the secondary); the accent sits 70° away on the side that doesn't cross the olive band.
- **Auto Drift, every 30° of phase (12 × 19 × 2), from Ocean, Neon and Solar:** Ocean passes every phase (its one failing sample is tagged as a transition: the highlight mid-way through its quick band crossing). Solar misses by hairlines at 4 phases (Marble content chroma 0.101 vs floor 0.102; at one phase Marble / Warp exposure +0.08 vs ±0.07). **Neon fails at 5 of 12 phases:** turned 90–150° its wide triad becomes orange / blue-violet / teal / gold and the teal and gold flames and veins add up to olive in Wisp and Voyage (12–28%); at 270–300° Warp's streaks are dull (chroma 0.068–0.077 vs 0.093). Not fixed — see "Unsure".
- Crossings: Auto Drift turns the palette rigidly and passes quickly (12% of the stretch's width of phase, a few seconds) through turns that would rest the primary or secondary in the olive span or the primary in the cyan band; samples taken inside a crossing are tagged `-crossing` and not judged.
- Crossfades between presets: OKLCH, never below chroma 0.103 (RGB dipped to 0.008, Ocean ↔ Solar).

### Frame cost (interleaved, 3 rounds, 1080p Medium, house-124 drop, median; `scripts/palette-cost.mjs`)
1.0 → now: Ink Glow Depth 1.50 → 1.50 ms, Glow Flat 1.34 → 1.33, Marble Depth 1.61 → 1.60, Sumi Depth 1.38 → 1.40, Silk Flat 2.87 → 2.92, Wisp Flat 1.35 → 1.35, Ground 1.46 → 1.47, Tunnel 1.22 → 1.24, Warp 1.43 → 1.43, Voyage Void 2.98 → 2.98, City 3.11 → 3.13, Ocean 2.94 → 3.03. Unchanged within noise (largest +0.10 ms, Voyage Ocean's palette sea).

### Beat sync per palette (house-124, every style / look / view)
Every palette keeps ≥ 90% of kicks seen in every look (lowest: Silk 91%, as in 1.0); Sumi by region 100% for every palette.

### Desktop build
`npm run tauri build` (updater artifacts off): `sonora_1.0.0_x64-setup.exe` (17.5 MB) and the MSI build; the release exe starts, opens its window, runs 12 s, settings v8 (no `inkLegacy`), closes cleanly. (The local settings file was already v8, so the v7 → v8 path is covered by the unit test, not this run.)

### Unsure / for your eyes
- **Voyage's sea and stone now carry the palette strongly** (a violet sea with Ocean, an amber sea with Ember / Solar, a lime one with Acid). It's what the brief asked for, but it changes Voyage's character more than any other style; the before/after sheet shows it.
- **Wisp Flat's fine-detail share rises 2 points** (48 → 50%, 70 → 72%; the ≤45% gate already failed at 1.0). Saturated trails show more texture; half of the hue-preserving build-up is the compromise (fully: +3; none: the old grey).
- **Custom hue and drift skip two narrow regions:** a custom pick in the olive band becomes gold or lime, one in the cyan band teal or azure (the picked cyan stays as the secondary), and Auto Drift passes those turns quickly instead of resting there. sRGB simply has no vivid dark yellow and no vivid mid-light cyan; resting there failed the gates in every style.
- **Auto Drift on Neon** still fails at 5 of 12 phases (olive gold + teal mixes in Wisp / Voyage at 90–150°, dull Warp streaks at 270–300°). Neon's colours span a wide triad (magenta / cyan / yellow); turned rigidly they land on complementary pairs whose light adds up to olive. Options: drift Neon-like wide palettes over a narrower range, or turn only their core and keep the accent; I didn't want to pick for you. Every preset at rest, every custom hue, and drift on Ocean pass.
- **Silk's 1-frame step** (the drop inversion cut) still exceeds 0.12, for every palette, exactly as in 1.0 (flash-guarded and deliberate).
- **The olive metric** was widened after looking at frames (dark yellows from 75°, lightness-dependent); the baseline was recalibrated with it before the final set was judged.

## Checklist
- [x] 0 Read CLAUDE.md, sprint log, decisions, DOCS/16, brand, colour engine, every palette-reading shader, PALETTE-RESEARCH.md + images; attribution off in `.claude/settings.json`
- [x] 1.1 Palette matrix tool (`npm run verify -- --palette-matrix`, `scripts/palette-matrix.mjs`): every palette × 19 style/look/view combos × 2 tracks (house-124, ref-song), 6 shots each; batch flicker gates (`--flicker`)
- [x] 1.2 Colour metrics (`scripts/palette-metrics.py`): chroma, M, grey share, off-palette, olive, exposure L/L95, separation; contact sheets per palette / per combo / overview
- [x] 1.3 Baseline: current 11 palettes, matrix + flicker gates (every palette × combo) + Ink/Voyage gates at the default palette
- [x] 1.4 Calibrate thresholds on the baseline (good: Ocean/Neon/Crimson/Violet; bad: Ivory / Black, Aurora in Voyage); write them here
- [x] 1.5 Diagnose: Voyage grey stone, distant-hue mixing, olive yellows, HSL lightness; anything else
- [x] 2.1 OKLCH palettes in the engine (gamut map by chroma), the 9-palette set, duotones removed
- [x] 2.2 Prove every palette in every combo (metrics + flicker); fix or replace failures
- [x] 2.3 `paletteFromHue` (analogous core + accent, OKLCH), 15° sweep; Auto Drift in OKLCH, crossfade without a grey dip
- [x] 3.1 Voyage stone carries palette colour (all backdrops), before/after + gates
- [x] 3.2 Ink: Marble with the accent as ink B, Sumi tint; slot changes only if a palette fails (before/after)
- [x] 3.3 Strands / Wisp / Warp: additive build-up stays saturated; gates
- [x] 4.1 Settings migration by name (v8) + test; Set Mode duotone logic removed
- [x] 4.2 Picker swatches (core + accent), palette thumbnails/media regenerated, (i) text, UI shots
- [x] 4.3 Docs: CLAUDE.md, DOCS/16 colour section, PALETTE-RESEARCH.md "What the real engine showed", decisions
- [x] 5 Remove "Ink: previous behaviour" + legacy path, `../sonora-baseline` worktree; re-run Ink gates (no change)
- [x] 6.1 Full gate run, review package `verify/palettes/review/` (sheets, before/after, Voyage, clips, Auto Drift cycle)
- [x] 6.2 Desktop build runs; summary at the top of this section; stop and wait for "Ship it"
- [ ] 6.3 (on "Ship it") 1.0.1 version bump, release notes, tag, release assets + latest.json checked

## Notes

### Baseline (current 11 palettes, before any change) — `verify/palettes/baseline/`
Matrix: 11 palettes × 19 combos (Ink Glow/Marble/Sumi × Depth/Flat, Glow/Marble light, Sumi dark, Silk Flat/Depth/light, Wisp Flat/Ground/Tunnel, Warp, Voyage Void/City/Ocean) × house-124 + ref-song, 6 shots each (build, 4-frame drop strip, calm), 640×360, medium quality, seeded. Metrics per frame on the content pixels (lit on dark looks, ink on paper looks and during Silk's inversion cut).

**Calibrated thresholds** (`scripts/palette-thresholds.json`, `python scripts/palette-metrics.py calibrate|gate`). Good references: Ocean, Neon, Crimson, Violet (Neon left out in Voyage — measured to fail there by the same mechanism as Aurora, below). Per combo: chroma ≥ 0.85 × the lowest good palette; grey share ≤ highest good + 10 points; off-palette ≤ highest good + 10 points; olive ≤ highest good + 5 points; k-means separation ≥ 0.8 × lowest good. Exposure: content L and whole-frame L within ±0.07 of Ocean in the same combo (widest loved palette: Neon in Voyage City, +0.06). Ink A vs B ΔE×100 ≥ 10 (loved minimum: Violet 11.7).

| combo | chroma ≥ | grey ≤ | off ≤ | olive ≤ | sep ≥ |
|---|---|---|---|---|---|
| ink-glow-depth | 0.079 | 19% | 15% | 20% | 9 |
| ink-glow-flat | 0.076 | 19% | 12% | 24% | 9 |
| ink-marble-depth / flat | 0.102 | 10% | 10% | 5% | 8 |
| ink-sumi-depth / flat (ink on bone by design) | 0.006 / 0.007 | 100% | 10% | 5% | 21 |
| ink-glow-flat-light | 0.033 | 73% | 14% | 5% | 16 |
| ink-marble-flat-light | 0.064 | 15% | 10% | 5% | 10 |
| ink-sumi-flat-dark | 0.005 | 100% | 10% | 5% | 16 |
| silk-flat / depth | 0.066 / 0.068 | 37% / 35% | 10% | 5% | 22 |
| silk-flat-light | 0.021 | 92% | 10% | 5% | 30 |
| wisp-flat / ground / tunnel | 0.052 / 0.051 / 0.053 | 31 / 26 / 19% | 14 / 18 / 22% | 12 / 11 / 10% | 22 |
| warp | 0.093 | 14% | 25% | 7% | 11 |
| voyage-void / city / ocean | 0.046 / 0.053 / 0.053 | 30 / 23 / 22% | 13 / 25 / 17% | 5 / 9 / 5% | 12 |

Gate result on the baseline: Ocean, Ember, Crimson, Violet pass everywhere. Ivory / Black fails all 19 combos (grey 78–100%). Aurora fails Voyage ×3 (grey 56–57%, chroma 0.038–0.042) plus Marble/Warp exposure (+0.09–0.10 L). Neon fails Voyage ×3 (grey 44–48%, off-palette 29–37%). Gold fails 16 (olive 14–53%, Marble/Warp exposure). Ember / Black, Cold / Black, Crimson / Black fail Wisp (grey 36–72%: low-chroma highlights turn the flame cores white).

**Diagnosis (research findings vs measurements)**
1. *Voyage's grey stone desaturates every palette* — confirmed. Content chroma for the loved palettes in Voyage 0.079–0.091 vs 0.13–0.16 in Warp and 0.14–0.20 in Marble; Ocean is 12–20% grey there. The stone albedo is `mix(grey 0.64, tint, 0.42)`: computed albedo chroma is only 0.06–0.11 for any palette.
2. *Distant primary/secondary hues mix toward grey* — confirmed. RGB midpoint chroma loss: Aurora −70% (0.055), Neon −35%, the rest ≤4%. On the stone that leaves Aurora 0.016 and Neon 0.051 albedo chroma: Voyage grey 56% / 48%. Warp's additive streak overlap gives Aurora 16% grey (others 0–4%).
3. *Yellows go olive when darkened* — confirmed. Gold is 14–53% olive (yellow hue darker than L 0.62) in every look; its primary darkened by Marble-light / Sumi (×0.55) lands at OKLCH L 0.52 h 84. Also: Neon's and Aurora's yellow accents read olive where Glow's ink B is thin (15–20% of Glow's content).
4. *HSL lightness makes brightness uneven* — confirmed. OKLCH L of the primaries spans 0.548 (Violet) to 0.801 (Gold); Gold/Aurora/Ivory render +0.07–0.12 brighter (whole-frame L) in Marble and Warp than Ocean.
5. *Also found:* Ink Glow Depth's flicker swings depend on the palette (dense-128, Punchy): Ocean 2.33/s, Violet 2.42, but Neon 2.58, Aurora 2.75, Gold 2.50 (step 0.126), Ivory 2.83, Ember / Cold / Black 2.67 — over the 2.5 gate; bright accents make Glow's hits jump more. Silk's 1-frame step 0.62–0.77 is its deliberate drop inversion cut (flash-guarded, a known issue since 1.0, every palette alike). Sumi's palette tint is effectively invisible (content chroma 0.006–0.009). City / Ocean backdrops keep fixed colours (warm windows, teal sea): Ocean is 15% off-palette in City.

# Ink smoothness fix (spawn pops, jagged lines, frame pacing) — done (awaiting review)

## Summary

**Watch first:** `verify/ink-fix/videos/` — for each look (Depth, Ember palette, your song at 20 s), the same seeded passage rendered at 165 fps timing with the previous behaviour (left) and the fix (right): `<look>-depth-realtime-165fps.mp4` and `<look>-depth-slow4x.mp4`; `marble-highlight-landing-slow8x.mp4` is the moment class from the slow-motion evidence (a highlight hit landing in Marble Depth). In the app: Settings › Advanced › "Ink: previous behaviour" switches live between the two (fix is the default). **The switch is temporary: it gets removed once you sign off.**

### Root causes (with the measurements that proved them)
1. **Frame pacing.** The cap defaulted to 60 on a 165 Hz display; no offered cap divided 165, so frames were held 3-3-3-2 refreshes. Measured with the new real-time pacing check (renderer's own rAF loop on this 165 Hz display): cap 60 → refreshes per frame {3/2} alternating; match display → {1}, 0 held frames in 1319; 1/2 → {2}; 1/3 → {3}.
2. **Frame-rate dependence (Ink + engine), five per-frame assumptions**, each confirmed with the new `--dt-sweep` (same seeded passage at 60/120/165 fps):
   - landing counted in frames (18 ms at 165 fps instead of 50 ms);
   - the one-frame push (2.75× weaker at 165 fps);
   - **the soft advection resampled the ink once per rendered frame**: at 165 fps the ink was blurred ~2× as much per second as at the tuned 60 fps (Glow Flat passage: 60 vs 165 fps brightness +28%, picture difference 61%; Glow's median kick rise 47% → 39%; Marble's large-shape motion 3.3% → 5.5%) — this predates the fix (the previous behaviour shows it too);
   - hits decided per rendered frame (a cooldown could expire on a different audio frame);
   - the flash guard's running mean assumed 60 observations per second.
3. **Spawn pops.** Three mechanisms: (a) the frame-counted landing above (a full-size blob in 18 ms); (b) the 2nd and 3rd shares of a hit landed at the hit's original spot while the 1st had already flowed on (visible as ghosted, triple-stacked bands in Sumi); (c) a full-size blob fading in instead of entering the flow. Marble's highlight was also a third colour (mint glow ×2) against its duotone intent. New pop score (new ink unexplained by the flow or by a brightness change, % of the frame per 1/60 s) at 165 fps, p99: previous **Glow 5.57 / Marble 4.03 / Sumi 4.80** (the evidence shows 4.3% in 21 ms).
4. **Jagged, breaking lines.** One factor at a time on the same seeded sequence (dye resolution ×2, sharpening off, bilinear / Catmull-Rom / B-spline display filtering, smooth sampling of the blurred field, MacCormack vs soft advection, grain off, dither off, veins off): only **Marble's veins** moved the numbers (Marble Depth fine-detail change 11.2% → 5.6% with veins off; display-sampling factors < 0.1). The veins are a sine of the ink ratio; where the ratio is steep (fast-stretched boundaries) several vein lines fall inside one pixel and alias into dashed, saw-toothed lines that change every frame. Close-ups show it directly. Near-camera magnification and dye resolution were not the cause. Sumi has no veins; none of the display factors moved its numbers; its "breaking" was the ghosted landing (3b).

### What changed and why it's minimal
- **Frame cap (D61):** default "match display" (refresh measured from rAF intervals, also probed on the menu), even divisor caps (every 2nd/3rd refresh), common caps marked "may stutter on this display" in the (i) text when they don't divide it; settings v7 migrates a saved 60 to match, keeps other choices (test). "Unlimited" not offered (the WebView shows one frame per refresh; extras are thrown away).
- **FPS readout (D62):** Settings › Performance › Show FPS (off) or P: tiny Bone/42% mono text in a chosen corner, fps · cap · worst frame, twice a second, DOM only.
- **Frame-rate independence (D63):** landing and push in seconds; advection in fixed 1/60 s steps with the display sampling the ink along the flow in between (identical to before at 60 fps — 0.00 difference; less sim work at 165); hits per analysis frame; flash guard in real time. Harness: audio fed in whole hops with the fraction kept (it ran 0.1% slow at 165 fps, and partial hops shifted the analysis windows).
- **Pops (D64):** hits start as a seed (45% radius) on the frame of the hit and spread to full size (Glow 50 ms so kicks keep their punch; Marble and Sumi 100 ms), carried by the flow (CPU copy of the curl field) — the final shape is exactly the old blob's. Marble's highlight lights the marble in its own colours. Motion model, speeds, fades, thresholds, timing of hits, camera and palettes untouched.
- **Jagged lines (D65):** veins thinner than a pixel fade to their average tone; veins wide enough to draw are unchanged.

### Gates (60 fps, the harness rate; baseline → fix). Logs: `verify/ink-fix/baseline/gates/gates.log`, `verify/ink-fix/final/gates/gates.log`
| look · view | sync seen, house / song (regional) | median rise · peak lag | flicker (dense-128, Punchy): swings · max 1-frame step | fine share house / song | background step p99 |
|---|---|---|---|---|---|
| Glow · Flat | 100 / 100 (100 / 100) → 100 / 100 (100 / 100) | 27.4 / 61.2% · 62 / 54 ms → 24.0 / 56.7% · 62 / 70 ms | 2.08/s · 0.102 → 2.00/s · 0.066 | 43 / 43 → 44 / 44% | 0.0044 / 0.0040 → 0.0028 / 0.0025 |
| Glow · Depth | 100 / 100 (100 / 100) → 100 / 100 (100 / 100) | 20.1 / 45.0% · 64 / 70 ms → 28.2 / 67.3% · 70 / 96 ms | 2.42/s · **0.121 FAIL** → 2.33/s · 0.081 | 48 / 45 → 47 / 46% | 0.0054 / 0.0040 → 0.0042 / 0.0040 |
| Marble · Flat | 100 / 96 (100 / 100) → 100 / 96 (100 / 100) | 16.0 / 31.0% · 54 / 66 ms → 14.5 / 26.4% · 62 / 77 ms | 0.00/s · 0.062 → 0.00/s · 0.051 | 75 / 74 → 71 / 71% | 0.0299 / 0.0153 → 0.0212 / 0.0070 |
| Marble · Depth | 100 / 96 (100 / 100) → 100 / 96 (100 / 100) | 15.9 / 35.8% · 56 / 64 ms → 13.0 / 30.8% · 67 / 101 ms | 1.00/s · 0.101 → 1.17/s · 0.041 | 71 / 71 → 67 / 68% | 0.0029 / 0.0031 → 0.0025 / 0.0028 |
| Sumi · Flat | regional 100 / 100 → 100 / 100 | — | 0.00/s · 0.043 → 0.00/s · 0.014 | 48 / 53 → 52 / 57% | 0.0099 / 0.0075 → 0.0028 / 0.0026 |
| Sumi · Depth | regional 96 / 96 → 100 / 100 | — | 0.00/s · 0.055 → 0.00/s · 0.025 | 42 / 54 → 50 / 60% | 0.0097 / 0.0063 → 0.0039 / 0.0036 |

Sync ≥ 90% everywhere (Sumi regional). Flicker passes everywhere (it failed once at baseline). Fine share: Glow ±1, Marble 3-4 points better, Sumi 4-8 points worse (see "Unsure"). Peak lag grows by up to 37 ms in two cases (the spread delays the peak; kicks are still seen within the 133 ms window on the frame of the hit).

### dt sweep (165 fps vs 60 fps, same passage). `verify/ink-fix/dt-sweep/*/dt-sweep.json`
Fix → previous behaviour (165 fps vs its own 60 fps run):
- Marble Depth: **PASS**, drift 3.0%, pop p99 0.09 vs 0.10, step 0.023 vs 0.018 → previous FAIL: drift 22.9%, pop p99 1.33 vs 0.15 (9×), step 0.069 vs 0.035.
- Glow Depth: rise 44.7 vs 47.5%, swings 1.25 vs 1.50, step 0.035 vs 0.034, fine share 51 vs 51, drift 7.8%; **pop p99 1.63 vs 0.75 (2.2×, gate ≤2×)** → previous: pop 7.29 vs 1.43 (5×), step 0.066 vs 0.035, swings 1.75 vs 0.75, drift 22.8%.
- Sumi Depth: **PASS**, drift 1.0% → previous drift 6.2%, pop p99 4.79 vs 2.87, step 0.041 vs 0.023.
- Flat (fix): Marble **PASS** (drift 5.8%), Sumi **PASS** (1.0%), Glow pop p99 3.65 vs 1.68 (2.2×), everything else within tolerance (drift 10.9%).
- Glow's remaining pop gap is mostly sampling phase: at 60 fps the 1/60 s window ends exactly on the hit frame (the seed appearing); at 165 fps the 18 ms window can include 12 ms of Glow's 50 ms spread. The landing curve is the same in time.
- Still comparison (`verify/ink-fix/stills/marble-depth-60-vs-165.png`): previous @60 vs @165 pixel difference 17.5 (darker, smoother at 165); fix @60 vs @165: 5.0.

### Pop score at 165 fps (p99 / peak, % of the frame per 1/60 s; your song at 20 s, Depth, Planet, Ember; final code vs previous behaviour)
Glow 7.29 / 11.46 → 1.63 / 4.87 · Marble 1.33 / 2.55 → 0.09 / 0.15 · Sumi 4.79 / 6.13 → 1.92 / 2.28. (Earlier 2 s passage, before the advection fix: Glow 5.57 → 2.10, Marble 4.03 → 2.48, Sumi 4.80 → 1.84.)

### Frame cost (interleaved, 3 rounds, Medium 1080p, median): unchanged within ±0.05 ms (1.2-1.6 ms every look and view). Pacing: PASS (above).

### Unsure / for your eyes
- **Sumi's fine-share number rises** (42-54% → 50-60%; it already failed the ≤45% gate at baseline). Two causes, both measured: ink no longer smeared by the ghosted landing (crisper bands, +3 points), and drops spreading as a moving rim (+5). Its absolute fine change stays tiny (≈2% vs Glow's ≈5%) and spread evenly, no spikes at hits. Judge with the A/B switch.
- **The look at 165 fps changes**: the previous behaviour was blurrier at 165 fps than at the 60 fps you tuned and approved in earlier rounds; the fix restores the 60 fps look at any refresh, so Marble at 165 is crisper than what you saw with the cap at max.
- A small 165-vs-60 difference remains from Glow's 50 ms seed spread (drift 7.8% Depth / 10.9% Flat; 0.2% brightness and 1.6% difference with the spread off; Marble and Sumi 1-6%). I couldn't pin it down further; Glow's sync, flicker and motion numbers agree, its pop p99 is 2.2× (gate 2×, likely sampling phase, explained above).
- The analyser reads the latest window whenever a hop is pending, so its frames depend on how audio is chunked (harness only — the live app's audio callback doesn't depend on the render rate). Worth knowing for future DSP work.
- Disk: C: hit 0 bytes mid-run; scratch renders now go outside OneDrive. 2.1 GB of older output in `verify/frame-seq/` left alone.

## Checklist
- [x] Read CLAUDE.md, D46/D47, rounds 6-7, Ink code + shaders, renderer; slow-motion evidence (`DOCS/reference/ink-bugs/`); originals moved to git-ignored `local-reference/ink-bugs/`
- [x] Baseline worktree pinned at the pre-fix commit (`../sonora-baseline`, eec9f5c); baseline gates `verify/ink-fix/baseline/gates/gates.log`
- [x] Tooling: `frame-seq.mjs` any render rate + debug flags + JPEG; `ink-metrics.py` (pop, jag, motion at 1/60 s, compare); `ink-gates.sh`; `ink-exp.sh`; `ink-cost.mjs`; `find-hits.mjs`; `ink-ab-video.sh`
- [x] Legacy switch reproduces the baseline (max 1/255 per pixel)
- [x] P1 frame cap: match display default, divisor caps, settings v7 + migration test, (i) text, refresh probe on the menu, FPS readout (P), UI shots at 3 sizes
- [x] P1 frame-rate independence: landing/push in seconds, fixed-step advection + display warp, hits per analysis frame, flash guard; harness audio fixes
- [x] P2 pops: seed spread carried by the flow (additive stages), Marble highlight in its own colours; pop score per look
- [x] P3 jagged lines: one-factor experiments; Marble vein anti-aliasing
- [x] Permanent harness checks: `--dt-sweep`, `--pacing`, pop score, jaggedness (`ink-metrics.py`)
- [x] All gates re-run, 3 looks × Flat/Depth (table above); dt sweeps; pacing; cost
- [x] Videos `verify/ink-fix/videos/` + stills; desktop build (`npm run tauri build`, updater artifacts off) runs: audio capture started, settings migrated to v7 (backup `%APPDATA%\com.abdul.sonora\settings.backup-before-v7.json`)
- [x] Abdul reviewed and signed off; the switch and legacy path were removed in the palette overhaul (D72); release with 1.0.1


---


# Prompt 3 summary — sonora 1.0.0 shipped

**Release:** https://github.com/abdulaz06/sonora/releases/tag/v1.0.0 (NSIS + MSI, signed updater artifacts, `latest.json`). CI and release workflows green.

**What shipped**
- Home menu as the front door: film-strip style cards with hover loops, style detail (big preview, looks and views as labelled thumbnails, Start), Continue, Set Mode card, live audio status with plain guidance, now playing, and the thumbnail-expands-into-the-visual transition. The engine stops rendering on the menu; analysis keeps meters live.
- First run (once): what sonora is, an audio check with a "got it" moment and troubleshooting, style / look / view / palette defined, the keys that matter.
- In-visual bar that hides itself (Menu, quick switcher with look / view / palette thumbnails, Set Mode, palette, fullscreen, settings); H clean mode; D signals.
- Settings rebuilt: sections, every control with an (i) card (pictures or loops for Responsiveness, Depth vs Flat, camera presets, Light/Dark, Quality), palettes shown on the current style, per-style vs global labelled. Settings v6 with migration tests.
- Set Mode (autopilot), now playing from the Windows media session (overlay, controls, real `trackChange`), tray (Show, Menu, Set Mode, Fullscreen, Quit), fullscreen display choice, devices pinned by endpoint id, strict CSP and minimal capabilities, GPU fallback screen, brand icons, updater with a one-click notice.
- Design system with bundled fonts and a UI kit (`kit.html`); media pipeline `npm run media` (13.3 MB shipped, manifest for the landing page).
- Tests: DSP on synthetic signals (cargo), settings v1 to v6, Set Mode, event layer on generated tracks (vitest), Playwright smoke test. README rewritten. Decisions D50–D60.

**Screenshots:** `verify/ui/` (`npm run ui:shots`, 17 states at 3 sizes); media contact sheets in `media/sheets/`.

**Try first:** install from the release, let the intro run with music playing; on the menu hover each card, open Voyage and compare Void / City / Ocean, press Start; in the visual press M (Set Mode) and leave it running through a few tracks in Spotify (watch the song card on each change).

**By hand**
- Install the published NSIS build (it asks for admin, which this session can't approve) and give it a quick run. The update notice can only be seen once a newer release exists.
- Sonora 0.1.0 is still installed in Program Files; the 1.0 installer installs into the same folder.
- Decide on a LICENSE (none in the repo).
- Back up the updater signing key and password in `~/.tauri/` (also in the repo's Actions secrets): losing them means installed copies can't update.

**Known issues**
- Ink Glow's largest one-frame luminance step on dense-128 is 0.121 (gate 0.12) and Silk's drop inversion cut is 0.76. Both are identical on the engine from before this sprint (measured), so not regressions, but Ink Glow sits on the gate's edge.
- Now playing was not seen live (no media session was open during the desktop check); the reader builds clean and is covered by review only.
- Physical device plug/unplug and multi-monitor fullscreen weren't testable here (one display).
- `C:/Users/abdul/sonora-media` is a git worktree pinned to the pre-UI engine, used for media renders; remove it with `git worktree remove C:/Users/abdul/sonora-media` when no longer needed.

---

# Prompt 3: the product (menu, onboarding, UI, Set Mode, now playing) → v1.0.0

> Resume rule: read this section and `git log`, continue from the first unchecked item. Never redo checked work.

## Checklist

### 0. Ground rules
- [x] 0.1 Caught up (local working notes, sprint log, decisions, DOCS/16, brand, registry, UI, controller, settings, scripts); commit attribution disabled in the local tool settings

### 1. Design system
- [x] 1.1 Fonts bundled locally (Inter, Inter Display, IBM Plex Mono) with OFL licences
- [x] 1.2 Tokens (colour, type, spacing, motion) + components: button, segmented, slider, toggle, select, card, thumbnail card, sheet, toast, kbd hint, info (i)
- [x] 1.3 Motion language (one easing family, reduced motion)
- [x] 1.4 UI kit page (`kit.html`), screenshot-reviewed at 1920×1080 / 1366×768 / 2560×1440

### 2. Media
- [x] 2.1 `npm run media` pipeline (masters in git-ignored `media/`, shipped WebP 1280/640 + WebM loops in `public/media/`, manifest)
- [x] 2.2 Candidates rendered, contact sheets reviewed, picks curated (styles, looks, views, classic)
- [x] 2.3 Voyage hero (inside the fractal) + vistas per backdrop (Void / City / Ocean)
- [x] 2.4 Settings explainer media (responsiveness, quality, light/dark, camera presets)
- [x] 2.5 Budget checked (≤ 25 MB) and logged

### 3. Home menu
- [x] 3.1 Launch moment (glint lines extend, lockup settles; skippable, shorter on later launches)
- [x] 3.2 Style cards (hero), classic row, hover loops
- [x] 3.3 Style detail (big preview, looks, views, Start)
- [x] 3.4 Resume, Set Mode card, audio status (device, live meter, guidance), settings/about/shortcuts
- [x] 3.5 Expand-into-visual transition; Esc/Menu back; keyboard + arrow navigation
- [x] 3.6 Engine paused on the menu (no rAF), analysis keeps running; "Open straight into my last visual" setting

### 4. First run
- [x] 4.1 Onboarding (what it is / audio check / styles-looks-views / shortcuts), skippable, first launch only

### 5. Visuals screen and settings
- [x] 5.1 Auto-hiding in-visual bar (menu, quick switcher, Set Mode, fullscreen, settings); H clean; D debug
- [x] 5.2 Settings rebuilt: sections, (i) cards with copy + media where useful, palette swatches on a thumbnail, per-style vs global labels
- [x] 5.3 Settings v6 migration + test (keeps every per-style value)

### 6. Now playing
- [x] 6.1 Rust GSMTC reader (title/artist/album/art/state, change events) + transport controls
- [x] 6.2 Overlay (settings: on/off, position) + menu display
- [x] 6.3 `trackChange` from real media info (gap detection fallback)

### 7. Set Mode
- [x] 7.1 Autopilot: switches on trackChange / long-build drops, min interval, music-suited choice, no repeats, hard cut on the drop beat or crossfade, flash-guarded
- [x] 7.2 Settings (include list with thumbnails, interval, palettes), menu card, in-visual button, M key, tray item, corner label

### 8. Brand and hardening
- [x] 8.1 Icons (tauri icon + hand-tuned .ico), window title "sonora", tray 32 px
- [x] 8.2 Tray: Show, Menu, Set Mode, Fullscreen, Quit
- [x] 8.3 Multi-monitor fullscreen display choice (remembered)
- [x] 8.4 Strict CSP; opener removed; minimal capabilities
- [x] 8.5 Output devices pinned by endpoint ID (name fallback)
- [x] 8.6 GPU fallback message
- [x] 8.7 Shortcuts consolidated (F/F11, Esc, H, M, S, V, 1–9, D) and listed
- [x] 8.8 Regression checks (device switching, capture recovery, off-screen net, persistence, fps cap, quality presets)
- [x] 8.9 Engine gates re-run: verify-art, flicker-art, perf-art, sync — unchanged

### 9. Updater, CI, tests
- [x] 9.1 tauri-plugin-updater + signing keys (secrets) + in-app update notice
- [x] 9.2 CI workflow (typecheck, clippy, cargo test, build, migration tests)
- [x] 9.3 Release workflow (v* tag → NSIS + MSI, signed updater artifacts, latest.json, Release)
- [x] 9.4 Tests: DSP synthetic, event layer on generated tracks, settings v1→v6, Playwright smoke (menu → detail → visual → menu)

### 10. README and release
- [x] 10.1 README rewritten (portfolio grade)
- [x] 10.2 Version 1.0.0, tag, Release with both installers + latest.json
- [ ] 10.3 Installed NSIS build smoke-tested (needs you: the per-machine installer asks for admin, which this session cannot approve; the same commit's release build was smoke-tested by hand, and the published installer was downloaded and its signing key checked)
- [x] 10.4 Summary at the top of this log

## Notes (Prompt 3)
- Design system in `src/ui/ds/`, screens in `src/ui/screens/`, shell in `src/app/shell.ts` (D50, D51). Fonts bundled (Inter variable with opsz = Inter Display, IBM Plex Mono). UI kit: `kit.html`.
- Screenshots: `npm run ui:shots` → `verify/ui/<state>-<w>x<h>.png` (17 states × 1920×1080 / 1366×768 / 2560×1440), all reviewed; fixes from review: CSS reset specificity (grey cards, oversized buttons), hidden labels showing, source chooser auto-opening over the menu, palette swatch collapsed, stage layout, nav wrapping, card caption height on short windows.
- Media (D52): 35 named assets + 55 palette thumbnails, 15 loops; total shipped 13.3 MB (budget 25). Picks from contact sheets in `media/sheets/`. Voyage vistas are the breakdown wide shots. Loops at 1024×576: 960×540 showed a green stripe from this GPU's VP9 decoder padding (also in WebView2).
- Desktop app (release build) checked by hand on this machine with a fresh settings file: launch → intro → audio check heard a test track ("got it") → menu → detail → live Ink → Esc → menu; settings persisted (onboarded, v6); your settings were backed up and restored.
- Tests: `cargo test` (DSP synthetic: silence, bands, 124 BPM kick train, loudness), `npm test` 13 tests (settings v1→v6, Set Mode, events on generated tracks), `npm run test:smoke` 14 checks pass.
- Updater keys: generated with the Tauri CLI, private key + password in `~/.tauri/` and in Actions secrets `TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)`; public key in tauri.conf.json.
- Tagline changed mid-run to "see your music" (D60): About, first intro screen, README, brand doc.
- Engine gates re-run after all engine-side changes (transition(), requestFlash(), float-target check): sync house-124 Ink Glow/Marble 100%, Sumi 96% regional, Silk 91%, Wisp Ground/Tunnel, Warp, Voyage 100%; flicker on dense-128 (palette 0, resp 0.6 and 1) swings 0.5–2.42/s, blown-out ≤ 4%; perf 1.05–3.41 ms (Low/Medium). Two one-frame steps sit at/over 0.12 (Ink Glow 0.121, Silk 0.76 = its flash-guarded drop inversion): the pre-Prompt-3 engine (8bddd7a, worktree) measures exactly the same, so nothing moved.
- Regressions: default-device capture, persistence (v6), fps cap and quality presets checked in the release build; capture recovery, device auto-switch and the off-screen safety net are untouched code paths (no physical plug/unplug test).
- No LICENSE file exists in the repo (left alone as asked).

---


# Feedback round 7 — done (awaiting review)

Notes: Ink still did not hit like v0.1: the background "wave" movement constantly moves and pushes hits away; shapes were blobs; Sumi lost its black-on-bone look and flickered; Marble's hits teleported. Abdul recorded current Ink on the same song as his v0.1 clip. Also: Silk's Planet preset; settings per style with an option to share colours; Wisp Depth flames going off screen; embers not reactive and always the same pattern.

- [x] Measured both recordings aligned by audio: fine-detail share of motion 73% (round 6) vs 34% (v0.1); difference images show v0.1's change in big areas
- [x] Harness: `motion-check.py` (fine share, background step), flicker gates both directions, regional sync, frame sequences, private local tracks (your song) (D47)
- [x] Engine: flash guard counts darkening; exposure hold smoothed and bounded (it rang white/grey on paper) (D47)
- [x] Ink: v0.1 motion model for all looks; per-look drops; Glow fine share 42% (D46)
- [x] Settings per style + same-colours option; Silk Planet preset (D48)
- [x] Wisp Depth: flames kept in view; embers drift on their own, swirl in wakes, ride rings (D49)
- [x] Verified: Ink sync 96-100% (Glow, Marble), Sumi 100% regional; flicker gates pass for all Ink looks and Wisp Ground/Tunnel; Flat Wisp and Flat Silk pixel-identical; frame cost Ink Glow 1.3 / 1.6 ms, Wisp Ground 1.75 ms, Tunnel 1.4 ms (Low / Medium); live desktop app with your song (all Ink looks, Wisp Ground/Tunnel, per-style palettes)

---

# Feedback round 6 — done (awaiting review)

Notes: Ink doesn't hit like the original Flat Flow Ink (shapes pop and immediately spread, clashing pumps); Silk Depth is good (the dust shows the planet), Planet preset should look further down with full curve; Wisp Depth lacks depth cues; Depth height seemed to carry into Flat. Decided with Abdul after studying a v0.1 recording frame by frame against its audio: kicks in a focus zone near the centre at random spots; all Ink looks and views at once; Wisp Depth gets two looks, Ground (light pools + embers, calm camera) and Tunnel (chase camera, endless tunnel, own camera); Flat zoom kept apart and saved, default marked on the slider.

- [x] Ink: one kick per beat as a solid shape + beat light that streams off with the ink (one-beat fade on the tempo) + brief flow hold; no outward blasts; quasi-steady flow (standing sheets) and v0.1-style ambient drizzle; anchors removed (D43)
- [x] Flat Zoom slider (saved, default in the middle, double-click resets), wheel drives it; Planet preset 0.6 / 0.75 / 1 (D44)
- [x] Wisp Depth Ground: flame-lit ground (ray-traced pools), floating embers (D45)
- [x] Wisp Depth Tunnel: chase camera, stateless lane/ring tunnel, flame-path trails, beat rings, pace follows the song (D45)
- [x] Flat Wisp and Flat Silk pixel-identical to before
- [x] `scripts/beat-strip.mjs` (50 ms frame strip across two beats); `snapshots.mjs` takes `SNAP_DEPTH`
- [x] Verified: Ink sync Glow 96-100% (Flat 100%), Marble 100%, Sumi 100% on all tracks; Wisp Ground and Tunnel 100%; flicker Ink Glow 0.5-0.8, Marble/Sumi 0, Wisp Ground 0.75, Tunnel 1.5 swings/s, blown-out ≤5.3%; frame cost (Low / Medium) Ink Glow 1.6 / 3.0 ms, Marble 1.5 / 2.8, Wisp Ground 1.2 / 1.7, Tunnel 1.05 / 1.4; Planet preset on Ink and Silk; live desktop app (Ink Flat/Depth, Wisp Ground/Tunnel, Punchy, Ocean, dense track)

---

# Phase 2 — Silk and Wisp Depth views — done (awaiting review)

Rules from round 2: Depth/Flat toggle with Flat as the default; the 2D path untouched; Silk and Wisp assessed separately.

- [x] Silk Depth: ribbons float as thin sheets whose height rolls with position, dust as stars above, under the shared 3D camera (presets, drag, scroll, curvature, fog) (D42)
- [x] Wisp Depth: flames at changing heights circling a point near the camera; smoke keeps its shedding height and rises; projected flames (D42)
- [x] Flat unchanged: Flat renders pixel-identical to before on house-124
- [x] Close-up particles spread the same light as they grow (Silk blown-out max 6.8% → 2.0%, Wisp 10.2% → 5.2%)
- [x] Verified: both views × five tracks; sync Silk Depth 91–100%, Wisp Depth 100% (Flat unchanged); flicker 0.83 / 1.0 swings/s; Silk 1.8 / 4.6 ms, Wisp 1.1–1.7 ms Low/Medium; presets Planet and Overhead; Silk paper look; live desktop app (Depth and Flat, Punchy, Ocean, dense track)

---

# Feedback round 5 — done

Notes: Voyage backdrop too low-res and flat (needs 3D grass, buildings, proper cities; buildings stood on water); show a city hanging upside down; wide shots too long, sometimes covering main sections; add backdrop choices (Void with stars, Ocean with huge waves, the City world). Decided with Abdul: Void / City / Ocean looks with Void as default; City alternates axis and look-up shots; return when the music picks up (cap ~12 s); fast dive on drops; Void wide shots show the fractal in the stars; no low flyovers, but high-quality 3D at viewing distance.

- [x] Looks Void / City / Ocean (D40)
- [x] City rebuilt: baked layout texture, 3D terrain and crags, tree canopies, street-grid cities with setback towers and parks, never on water, axis lighting, radius 30 (D40)
- [x] Ocean: four swell trains rolling down the axis, chop, crests, foam (D40)
- [x] Wide shots per backdrop incl. the upside-down city; music-driven return retracing the exit; sharper wide shots (D41)
- [x] Verified: three looks × five tracks, sync 100% each, flicker ≤1.1 swings/s, 3.3–3.5 ms Medium (wide shots ≤5.8 ms), live desktop app

## Phase 2 (next, unchanged)
- [x] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [x] Wisp Depth view (same rules)

---

# Feedback round 4 — done

Notes: "stable world" in Voyage meant only the backdrop; the backdrop looked like low-res pastel blocks; add wide shots so the curve can be seen, with buildings hanging off it; Warp needs slow-motion sections. Decided with Abdul: fractal fold breath + corkscrew back; wide shots in breakdowns (or after ~60 s at a calm moment) with a dive back on the drop; natural textures + modern clustered cities; Warp slow-mo in breakdowns and quiet intros.

- [x] Warp slow-motion sections (D39)
- [x] Voyage fractal beat reactions restored, backdrop stays still (D37)
- [x] Voyage wide shots: planner-steered exit, vista drift, dive back on the drop (D38)
- [x] Voyage land: fields, grass, forests, rock/snow, shores, water, clustered 3D cities (D38)
- [x] Verified: Voyage and Warp on five tracks, sync 100%, flicker 0.6 / 1.3 swings/s, vista cost 4–8 ms Medium, live desktop app (Voyage wide shot during the breakdown)

## Phase 2 (next, unchanged)
- [x] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [x] Wisp Depth view (same rules)

---

# Feedback round 3 — done

Abdul's notes after Phase 1: Silk's beat ripple/zoom overdid it on bass-heavy songs; Wisp drifted off screen and went blank on a second visit; Ink hit the beats but looked scattered; Voyage's backdrop reacted to beats and read as a thick dome, and the Kaleido drop replaced the best camera moment; Mosh still not good. Decided with him: remove Silk's ripple/zoom; Ink fixed anchors; Voyage thin curved world, stable on beats, drop = dive + barrel roll, beats = roll sway + FOV breath; scrap Mosh.

- [x] Wisp: fixed view (zoom only); second-visit blank fixed — cause was a fresh instance spawning at its world origin while the shared camera had drifted (D33)
- [x] Silk: beat zoom, ripple ring and thread pluck removed (D32)
- [x] Ink: beat anchors, all-anchor bloom every 4th kick, satellites, anchored drop (D34)
- [x] Voyage: world stable on beats, Kaleido drop removed, barrel-roll drop, roll sway + FOV breath, thin analytic cylinder landscape (D35)
- [x] Mosh removed (D36)
- [x] Verified: all styles × five tracks, sync, flicker, perf (1.1–3.3 ms Medium), live desktop app (Punchy, Ocean, dense track)

## Phase 2 (next, unchanged)
- [x] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [x] Wisp Depth view (same rules)

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
- [x] Silk Depth view (Depth/Flat toggle, Flat default; 2D path untouched)
- [x] Wisp Depth view (same rules)

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
