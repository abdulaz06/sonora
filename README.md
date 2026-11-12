# sonora

A visual instrument for whatever's playing. Sonora listens to your system audio on Windows and paints it, live, in styles built to look like art rather than a spectrum analyser.

Built with Rust, TypeScript, raw WebGL 2 and Tauri 2.

<p align="center">
  <a href="https://www.youtube.com/watch?v=kDKyOMpcxeI" title="Watch Sonora — Flow Ink with sound">
    <img src="DOCS/assets/flow-ink-thumbnail.png" alt="Sonora Flow Ink audio-reactive visualization — click to watch the demo" width="900" />
  </a>
</p>
<p align="center"><a href="https://www.youtube.com/watch?v=kDKyOMpcxeI"><strong>▶ Flow Ink (v0.1) with sound</strong></a></p>

## Styles

- **Ink** (flagship): a real fluid simulation on a world several screens wide. Kicks bloom from a few stable anchor points, so you see the same spots pulse in time; mids feed a drizzle of ink, highs scatter sparkle, drops burst. **Depth** (default) turns the ink into a lit surface with a gliding camera (presets Glide, Horizon, Planet, Valley, Overhead; height, tilt and planet/bowl curvature); **Flat** looks straight down. Looks: **Glow**, **Marble** (two-tone marbling), **Sumi** (black ink on paper).
- **Silk**: millions of particles drawn into flowing threads that light up on every kick; builds gather the threads into a knot and the drop bursts them into a starburst.
- **Wisp**: three coloured flames darting through the dark, trailing smoke; bass hits blow smoke rings.
- **Warp**: hyperspace streaks whose speed follows the song: slow motion in breakdowns and quiet intros, regular pace with the beat, accelerating through builds, jumping at the drop.
- **Voyage**: a flight through a raymarched 3D fractal that breathes and twists on the beat, with three backdrops: **Void** (a dark, star-filled sky in your colours), **City** (a curved world of fields, rivers, mountains and cities that rises around the fractal and hangs overhead) and **Ocean** (a curved sea of huge rolling swells). Calm moments fly out for wide shots; the camera returns as the music picks up, and the drop dives back in with a barrel roll.

Responsiveness (Smooth → Punchy) changes how hard things move, never how much they flash; brightness stays steady and every deliberate flash goes through a limiter (at most three per second). Frame rate is capped at 60 by default (30 – 144 or max in Settings).

Aura and Halo from v0.1 remain available under **Show classic styles** in settings.

## How it works

```text
WASAPI loopback (desktop)        Web Audio + AudioWorklet (browser)
            \                      /
             sonora-dsp (Rust; native or WebAssembly)
             FFT → bands → per-band normalisation → onsets → beat/tempo
             mapping layer: fade, intensity, presence ×7, hits ×7, 96-bin spectrum
                          |
                 AudioFeatureFrame, 60 per second of audio
                          |
   event layer (drop, build, breakdown, big hit, track change)
                          |
   style (world camera, palette, quality) → bloom / tonemap / grain → screen
```

The same analysis crate runs in the desktop app and in the browser; a parity check confirms both produce the same frames. Instrument and section labels are heuristics derived from band energy and onsets, not source separation or machine learning.

## Choosing what Sonora hears

- **Desktop app (recommended):** listens to your speakers directly. Leave Audio on "Whatever Windows is playing on" and it follows device changes by itself: plug in headphones or 3.5 mm speakers and the visuals carry on.
- **Browser (`npm run dev:web`):** click the source chip top-left.
  - **Browser tab** (best): share the tab playing music with "Also share tab audio" on. Keeps working when you change speakers or headphones.
  - **Whole computer:** Entire screen with "Also share system audio" on; hears any app, including the Spotify desktop app. Browsers keep this tied to the speakers active when you started, so after a device change Sonora shows a one-click Reconnect.
  - **Microphone / line-in**, **audio file** (or drop one on the page), **test tracks**.

## Controls

| Key | Action |
| --- | --- |
| `F11` / `F` | Fullscreen |
| `H` | Clean mode (hide all UI) |
| `D` | Debug overlay (signals, events, fps) |
| `S` | Next style |
| `V` | Depth / Flat |
| `C` | Next camera preset (Depth) |
| Drag / scroll | Depth: look around / change height. Flat: move / zoom. Double-click resets the camera |
| `1`–`0` | Palette |
| `Esc` | Leave fullscreen / clean mode, close panels |

Settings (each with a one-line explanation): style and look, view, background, camera, palette (Ocean, Aurora, Ember, Neon, Crimson, Gold, Violet, four two-tone palettes, or any custom colour), colour drift (off by default), responsiveness (how hard visuals snap to each beat), quality (Low / Medium / High / Auto), audio source. The tray menu offers Show, Hide, Fullscreen and Quit.

Quality presets change real work, not only post effects: render resolution, simulation and ink resolution, solver iterations and mesh density. Auto watches frame time and steps down or up.

## Build from source

Windows, with:

- Node.js 20+ and npm
- stable Rust (MSVC) with the WebAssembly target: `rustup target add wasm32-unknown-unknown`
- `wasm-pack`: `cargo install wasm-pack`
- Microsoft C++ Build Tools (Desktop development with C++), WebView2
- the VBSCRIPT optional feature for MSI packaging

See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
npm ci
npm run tauri dev        # desktop app with system audio
npm run dev:web          # renderer in a browser: test tracks, audio files, mic, tab audio
npm run tauri build      # installers in target/release/bundle/
```

### Verification

```powershell
npm run gen:audio                                   # procedural test tracks (no copyrighted music)
npm run check:parity -- house-124                   # desktop vs browser analysis frames
npm run verify -- --variant sumi --track all        # screenshots at silence/fade-in/build/drop/breakdown
npm run verify -- --sync --flat --track house-124   # beat sync: share of kicks with a visible response
```

`npm run verify` renders in a real browser on the GPU, in audio time, and writes screenshots, an 8-frame strip across the drop, the detected events and frame timing to `verify/`.

## Audio and privacy

Audio stays in memory and is never saved or uploaded. Only derived feature frames reach the renderer. There is no telemetry or network client in the desktop app. Preferences and window state are stored locally in the app-data directory (the browser build uses localStorage).

## Known limitations

- Devices are pinned by display name, not a stable endpoint id.
- Requires WebGL 2 with float render targets.
- Tempo on half-time music may read at half the notated BPM.
- The Tauri content security policy is unset.

Deeper reading: [visual direction](DOCS/16-VISUAL-DIRECTION.md) · [mapping layer](DOCS/14-MAPPING-LAYER-SPEC.md) · [brand](DOCS/brand/17-BRAND.md) · [decisions](DOCS/DECISIONS.md).
