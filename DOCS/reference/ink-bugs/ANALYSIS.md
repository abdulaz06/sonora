# Ink: slow-motion evidence (Nov 2026)

Source: two iPhone 240 fps slow-motion recordings of the screen (Ink, Marble look, Depth view, Planet-style camera, frame cap at max on a 165 Hz display) and Abdul's v0.1 Flow Ink screen recording (60 fps). The originals are large and kept outside git (`local-reference/ink-bugs/`, gitignored). In the slow-mo exports each frame = 1/240 s of real time. The diagonal stripe pattern in the phone footage is camera moiré against the LCD pixels: ignore it.

## Bug 1: spawn pops ("blobs teleport in")
- `spawn-pop-0058-f339-350.jpg`: 12 consecutive frames (≈50 ms real time). A soft mint-green blob (highlight colour) appears in empty dark space where there was no ink and no flow carrying ink there. Measured green area: 0.0% → 1.2 → 2.2 → 3.3 → 3.9 → 4.3% of the frame over 5 frames ≈ 21 ms, then it slowly decays. Same pattern at IMG_0058 f114–116 and f224–226 and IMG_0057 f30–33 and f46–48.
- It reads as ink teleporting because it doesn't come from anywhere: it's new dye at a random position, in a third colour that contrasts with Marble's duotone, landing almost instantly and then just sitting there while the surrounding marble flows.
- v0.1 (`v01-reference-overview.jpg`) used the same idea (blob per hit) but everything was soft, low-contrast and near-monochrome, so new ink blended into existing ink instead of popping.

## Bug 2: jagged, breaking lines in fast-flow areas
- `jagged-lines-0057-f120-127.jpg`: 8 consecutive frames (≈33 ms), cropped. The orange bands and thin filaments have saw-tooth / stair-step edges, and the teeth change from frame to frame. Abdul describes it as "the fps drops only in the flow spots and the individual lines break and jag". This is spatial aliasing that crawls over time, so it reads as stutter, but the frame rate is fine.
- Strongest in fast, stretching flow (where filaments get thinner than a dye texel) and in Marble and Sumi (sharpened, crisp edges), and close to the Depth camera, where each dye texel covers many screen pixels.

## Separate, confirmed: frame pacing
- The frame cap defaulted to 60 on a 165 Hz display (no offered cap divides 165), giving uneven 3-3-3-2 refresh cadence (judder). Setting the cap to max visibly helped (Abdul).
