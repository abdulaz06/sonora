# 17 — Brand (Identity v1.0)

> Dark, cinematic, minimal. The visuals are loud; everything around them is quiet.
> Preview: `sonora-brand-sheet.png`. Do not redraw the logo — use these files.

## Assets (this folder)

| File | Use |
|------|-----|
| `sonora-lockup-bone.svg` / `-night.svg` | Primary logo (glint + wordmark). Bone on dark, night on light |
| `sonora-wordmark-*.svg` | Wordmark alone (outlined paths, no font needed) |
| `sonora-mark-bone.svg` / `-night.svg` | Glint mark alone, large sizes (≥ 64 px) |
| `sonora-mark-small-bone.svg` | Glint with heavier strokes for ≤ 48 px |
| `sonora-icon*.svg` | App icon tiles (large / mid / small optical weights) |
| `icons/icon-{16..1024}.png` | Rasterised icon tiles; 16–32 use small, 48–64 mid, ≥128 large |
| `sonora.ico` | Windows icon with hand-tuned 16/24/32/48/64/128/256 frames |

**Tauri icons:** run `npm run tauri icon DOCS/brand/icons/icon-1024.png`, then overwrite `src-tauri/icons/icon.ico` with `DOCS/brand/sonora.ico` (keeps the hand-tuned small sizes). Tray icon uses the 32 px tile.

## Colour
- **Night** `#08080A` — backgrounds
- **Bone** `#ECE7DF` — text, logo, UI strokes
- Greys only as opacity of Bone on Night (e.g. 60% / 35% / 12%). No brand accent colour: colour comes from the visuals. UI may borrow the active style's palette for one live indicator, nothing else.

## Type (both free/OFL, self-host on the site and bundle in the app)
- **Inter Display SemiBold** — headlines and the wordmark. Tight tracking (−2% to −3%). Lowercase or sentence case, never all-caps headlines.
- **Monospace** (IBM Plex Mono or JetBrains Mono) — labels, metadata, now-playing, BPM, style names, buttons. Uppercase, tracked +10–15%, small.
- Body copy: Inter Regular, Bone at ~70% opacity. Short sentences.

## Rules
- Glint stands alone or left of the wordmark, dot aligned to the x-height centre. Clear space = height of the wordmark's "o" on all sides.
- Never: glow, gradients, drop shadows, outlines, rotating the glint, recolouring outside Night/Bone, stretching.
- Motion: the glint can animate as a brand moment (lines extend from the dot on launch/loading, pulse on a drop in Set Mode). Keep it under 1 s and ease-out.
- Layout: lots of black space, thin 1 px Bone/12% dividers, square corners (icons excepted), hard grid. UI chrome hides itself; the visuals fill the screen.
- Voice: few words, lowercase confidence, no exclamation marks, no "AI-powered" or "ultimate" language. e.g. "sonora — see the music." / "a visual instrument for whatever's playing."
