# Daily reels with the reel studio

The reel studio is a local tool for making Instagram reels from sonora's real engine. It never ships in the app or on the website. Songs, covers and finished reels stay in `local-media/` on this computer (git-ignored).

## Once

1. Put songs in `local-media/songs/`: mp3, m4a, wav, flac, or a video file (the audio is taken from it). Name them `Title - Artist.mp3`, or let the file's tags speak.
2. Put album covers in `local-media/covers/` (jpg or png) with words from the title or artist in the file name, e.g. `kanye-west-graduation-cover.jpg`. A song's embedded artwork works too.

## Every day (about ten minutes plus the render)

1. **Start the studio:** `npm run studio`. It opens http://localhost:5300/studio.html in your browser.
2. **Pick the song** at the top. The first time, it analyses the whole song with the real DSP (a few seconds).
3. **Pick the moment** on the strip. The strip shows the waveform, the intensity line, bar lines (every fourth stronger) and the events: drops (triangles), builds, breakdowns, big hits.
   - Click a drop: the window frames it, a third of the way in.
   - Or drag across the strip. The ends snap to bar lines.
   - Length: 15, 20 or 30 s, or type your own.
   - Or take one of the three suggestions (hover a button to see why it was suggested).
4. **Choose the visual.**
   - *Song:* one style for the whole reel.
   - *Beat switch:* a second style takes over on a bar you pick ("pick the bar", then click the strip). The drop is chosen for you.
   - *Showcase:* the palette, or the look, changes on every bar.
   - *Styles tour:* cuts through the styles you tick, every 1, 2 or 4 bars. A drop always lands on a cut.
   - *Album colours:* the palette comes from the cover, as in the app.

   Then pick the style, look and view, the palette (any of the nine, album colours, a custom hue, or Auto Drift) and, for Depth views, the camera.
5. **House style:**
   - The title line reads `song — artist` in lowercase. Edit it if the tags are messy.
   - Text: *full* keeps the title and style line on screen, *intro* shows them for the first 3.5 s, *none* hides them.
   - Style labels show a small `silk · depth` at each style change.
   - Now playing shows the app's own toast (cover, title, artist) at the start.
6. **Preview:** press Preview. It plays in time with the song in a 9:16 frame. *Safe zones* shades where Instagram puts its own interface (top, bottom, the buttons on the right); the outlined box is the 3:4 crop the profile grid shows. Keep the important part inside it. The preview starts each style fresh at a cut; the render warms every shot up first.
7. **Render:** *Render draft* (half size, 30 fps, a minute or two) to check the timing, then *Render*. You can also *Add to queue* and render later.
8. **Post** from `local-media/reels/out/<date>-<song>-<format>/`:
   - `reel.mp4` (1080×1920, 60 fps, about 18 Mbps, AAC 320k);
   - `reel-silent.mp4`, if you'd rather add the song with Instagram's music picker. `meta.json` has the exact start time (`instagramMusicStart`, m:ss.s) to set it to;
   - `cover.jpg` (the strongest moment, everything important inside the 3:4 crop);
   - `caption.txt` (paste it, then fix the genre tag if needed).

## Overnight

Add several reels to the queue in the studio, then run `npm run reel -- --queue` before bed. Each job's output folder is written into `local-media/reels/queue.json` when it's done.

## Templates

- `node scripts/reel/templates.mjs origin`: the origin-story reel (seven text cards over Silk Depth and Ink Glow on the demo track).
- `node scripts/reel/templates.mjs carousel`: the five-slide 1080×1350 carousel.

## Good to know

- Renders are deterministic: the same plan gives the same video. Analysis always starts at the beginning of the song, and every shot warms up for 8 s before its first frame, so nothing starts cold.
- A plan is plain JSON (studio: *Save plan*, in `local-media/reels/plans/`). You can edit one and render it with `npm run reel -- <plan.json>` (`--draft` for a quick one).
- Check how a reel survives Instagram's compression with `node scripts/reel/ig-check.mjs <reel.mp4>`: it re-encodes it Instagram-style and reports fidelity, banding in dark gradients, and added shimmer.
- Never commit songs, covers or renders. `local-media/` is git-ignored for that reason.
