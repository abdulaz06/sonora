# Palette research (Nov 2026)

## What Abdul wants
- Colours that make the visuals richer. Loves: Ocean, Neon, Crimson, Violet. Hates: Ivory / Black (reads as plain white on black) and dry, washed-out palettes generally.
- Aurora is nice in Ink and Silk but looks wrong in Voyage: it "doesn't change the colour, just does accents".
- Every palette must work in every style and look. This ships in the next release.

## How each style uses the five slots (from the shaders, Nov 2026)
| Style | primary | secondary | accent | highlight | bg / paper |
|---|---|---|---|---|---|
| Silk (strands) | 62% of strands | 24% | 5% | 9% + glow/dust | bg × 0.6 |
| Wisp | flame 1 | – | flame 2 | flame 3 + sparks | bg |
| Warp | streaks (same strand weights) | | | | bg |
| Ink Glow / Marble | ink A (large areas) | ink B only for duotone palettes | **ink B, large areas** | sparks | bg tinted by primary |
| Ink Sumi | ink on paper (primary × 0.55) | | | | paper |
| Voyage | **tint = mix(primary, secondary) at only 42% over grey stone** | ↑ | glowing veins, glow | sunlight tint 30%, specular, iridescence | sky |

## Findings (see `current-palettes-sim.png`, which pushes each palette through the formulas above)
1. **Voyage desaturates every palette, not only Aurora.** Its albedo is 58% fixed grey stone, so palettes only tint it, and the colour mostly lives in thin veins, glints and iridescence. Aurora is the worst case because its primary (green, 150°) and secondary (purple, 280°) are 130° apart: mixing them over grey cancels toward grey. That's the "just accents" effect.
2. **Hue distance between primary and secondary decides whether a palette stays rich when styles blend them.** Mixing distant hues, additively (Silk strands crossing, glow) or in albedo (Voyage), pulls toward grey or white. Palettes Abdul loves keep primary and secondary close (Ocean 220/260, Crimson 350/15, Violet 270/300) and put the contrast in a small accent. Neon is the exception that works because its secondary is used sparingly in most styles.
3. **Low-chroma palettes read as "plain"** (Ivory / Black: saturation 0.28). On black, the eye reads saturated light as brighter and more vivid (Helmholtz–Kohlrausch effect), so low-chroma palettes look flat and white.
4. **Yellows and limes go muddy (olive/brown) when dark.** Gold and similar palettes need their dark tones shifted toward orange, or kept bright.
5. **Duotone palettes carry no hue contrast at all.** They suit Marble's marbling look specifically, but as global palettes they make the other styles monochrome.
6. **Palettes are defined in HSL,** so equal "lightness" values aren't equally bright (HSL yellow at l 0.55 is far brighter than blue at 0.55). Switching palettes can change the perceived brightness and contrast of the same style.

## Design rules for the new set
- **Analogous core + one accent:** primary and secondary within ~20–60° of each other (so blends stay saturated in every style); accent is a contrasting hue (split-complementary or triadic) that works as a small detail and also as Ink's large second ink; highlight is a lighter, slightly hue-shifted version of the core (warm cores shift toward yellow, cool cores toward cyan, as bright light does).
- **High chroma, controlled lightness:** design in OKLCH (perceptual), with primary lightness roughly matched across palettes so switching palettes doesn't change exposure or flicker behaviour. No low-chroma palettes.
- **Dark background tinted with the palette** (never neutral grey); Sumi's paper stays bone.
- **Every palette has to pass in every style and look,** including Voyage's three backdrops and Sumi on paper.

## Proposed starting set (`proposed-palettes-sim.png`); to be validated with real renders
1 Ocean (keep) · 2 Aurora (reworked: teal → cyan core, violet accent, mint highlight) · 3 Ember (keep) · 4 Neon (keep) · 5 Crimson (keep) · 6 Solar (Gold reworked: gold/orange core, rose accent, no olive) · 7 Violet (keep) · 8 Sunset (new: hot pink/purple core, orange accent, peach highlight) · 9 Acid (new: lime/green core, magenta accent). Duotones removed from the global list.

The simulation is a rough proxy (`palette-sim.py`), not the real renderer. Real engine renders decide.

## What the real engine showed (palette matrix, Nov 2026)
Measured with `npm run verify -- --palette-matrix` (every palette × 19 style / look / view combos × 2 tracks, seeded) and `scripts/palette-metrics.py`; numbers in `DOCS/SPRINT-LOG.md` (Palette overhaul + 1.0.1) and decisions D67–D72.
- **The table above was partly wrong.** Silk's display uses only primary + highlight (the strand weights apply to Warp's streaks); Ink Marble draws ink A against the dark background (ink B only darkens it); Wisp's flames are primary / accent / highlight, so a complementary accent is a full-size flame there, and green + magenta flames add up to white.
- **Finding 1 confirmed and fixed at the source:** Voyage's stone albedo was at most 0.06–0.11 chroma for any palette. The stone now takes the core colours at a fixed value (D69): Ocean's content chroma in Voyage 0.055 → 0.094, Aurora's grey share 57% → 8%, at the same exposure.
- **Finding 2 confirmed:** RGB averages of distant primary / secondary hues lost 70% (Aurora) and 35% (Neon) of their chroma; Neon greyed out in Voyage exactly like Aurora (44–48%). Styles now blend hue-preservingly (Voyage `keepChroma`, Wisp's smoke), and new palettes keep an analogous core.
- **Finding 3 confirmed, and wider than expected:** dark yellows read olive from ~75° (not only true yellows): Gold 14–53% olive in every look; even an amber Solar at 76° read mustard in Silk's dim threads and Marble on paper. Solar sits at 68° with a light 80° highlight, and the engine's `shade` slot turns golds' dark tones toward amber.
- **Finding 4 confirmed:** OKLCH L of the old primaries spanned 0.55–0.80; Gold / Aurora rendered up to +0.12 brighter than Ocean in Marble and Warp. New primaries sit at 0.55–0.68 and every palette is within ±0.07 of Ocean in every combo.
- **New:** Ink Glow Depth's flicker swings are palette-sensitive and sat at the 2.5/s gate (Neon already failed in 1.0). Dimming highlights made it worse; a slightly lighter, palette-tinted floor (bg L 0.14–0.16) fixed it without touching the ink.
- **Proposal changes:** Aurora's accent became orchid (315°) and Acid's ultraviolet (280°) so the two stay distinct and Acid's flames don't add to white; Solar's accent became a brighter rose (355°) so it doesn't read as a second Ember.
