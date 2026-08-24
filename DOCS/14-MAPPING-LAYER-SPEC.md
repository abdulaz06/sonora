# Audio-to-visual mapping

Sonora separates audio analysis from visual control. The Rust analysis pipeline produces detailed spectral, energy, onset, tempo, rhythm, element-proxy, and mood data. A second Rust layer turns part of that data into five stable, normalized signal families designed for animation.

This is heuristic signal processing. The layer does not isolate instruments, recognize song sections, or produce a calibrated spectrum.

## Data flow

```text
4,096-sample mono window
        |
        +-- FFT magnitudes and 7 frequency bands
        +-- spectral flux and adaptive per-band onsets
        +-- RMS energy and temporal followers
        +-- beat/tempo and descriptive proxy features
        |
        v
MappingLayer::process
        |
        +-- fade_in_out
        +-- intensity
        +-- presence (7 bands)
        +-- hits (7 bands)
        +-- juiced_fft (96 bins)
        |
        v
AudioFeatureFrame -> Tauri event -> WebGL renderer
```

The seven shared bands are:

| Band | Range |
| --- | ---: |
| Sub-bass | 20–60 Hz |
| Bass | 60–250 Hz |
| Low mid | 250–500 Hz |
| Mid | 500 Hz–2 kHz |
| Upper mid | 2–4 kHz |
| High | 4–8 kHz |
| Air | 8–20 kHz, limited by Nyquist |

## Timing model

The renderer combines signals operating at different time scales:

| Scale | Signals | Role |
| --- | --- | --- |
| Macro | `fade_in_out`, `intensity` | Establish scene visibility, size, density, and motion over seconds |
| Meso | sustained `presence`, beat phase/pulse | Shape ongoing motion and repeated rhythmic modulation |
| Micro | transient `hits`, individual `juiced_fft` bins | Add short accents, bursts, splats, and spectrum detail |

Keeping those layers separate prevents every visual parameter from snapping directly to raw FFT magnitudes.

## Mapping signals

### `fade_in_out`

This is the scene's silence gate. Instant RMS above `0.005` raises an internal state by `0.3` per second; values below that threshold lower it by `0.15` per second. A smoothstep curve shapes the result before it reaches the renderer.

The full linear rise takes about 3.3 seconds and the full fall about 6.7 seconds. Styles multiply visibility-sensitive effects by this value so a stopped track fades instead of cutting abruptly.

### `intensity`

Intensity is a slow activity estimate:

```text
0.55 * normalized short-term RMS
+ 0.25 * motion density
+ 0.20 * active-band fraction
```

Short-term RMS reaches its full contribution at `0.3`. A band counts as active above `0.05` energy. The combined target then passes through a four-second attack and six-second release envelope.

Intensity is not a song-section label. A rising value can accompany a buildup and a high value can accompany a drop, but Sonora does not explicitly detect either event.

### `presence`

Each band's energy is compressed with:

```text
y = x / (x + 0.15)
```

It then passes through an asymmetric envelope with a 200 ms attack and 1.5 second release. Presence represents sustained activity, such as an extended bass line or dense midrange, without pulsing strongly on every transient.

### `hits`

Each band receives a transient envelope. A detected onset uses the greater of its adaptive onset strength and the band's positive flux multiplied by eight. The result receives a `1.5×` boost, is clamped to `0–1`, and decays exponentially with an 80 ms time constant.

Hits are frequency-band transients. A low-band hit is useful as a kick-like visual cue, but it is not proof that a kick drum was isolated.

### `juiced_fft`

The art-facing spectrum contains exactly 96 logarithmically spaced bins from 20 Hz to the lower of Nyquist or 20 kHz. Processing is:

1. Average source FFT bins in linear-magnitude space.
2. Apply a smooth high-frequency gain ramp from 2 kHz to 15 kHz, reaching `1.6×`.
3. Apply per-bin temporal smoothing with `alpha = 0.3`.
4. Apply a three-bin spatial blur.
5. Normalize against a slowly decaying running maximum.

This produces readable motion across quiet and loud material. Because the normalization adapts over time, `juiced_fft` is a relative visual signal rather than a calibrated amplitude measurement.

## Hierarchy Rule

Visuals follow this layering pattern:

```text
macro base * meso modulation + micro accent
```

- Macro signals decide whether the scene exists and how active it should feel.
- Meso signals shape persistent motion and beat-scale change.
- Micro signals add brief detail without replacing the underlying composition.

In practice, styles also clamp, threshold, or smooth individual inputs to protect the scene from noisy frame-to-frame changes.

## Current consumers

| Style | Signal use |
| --- | --- |
| **Aura** | Intensity and fade set the base scene; bass hits/presence drive rings; high presence and band hits feed particle mist/bursts; mid presence/hits shape tendrils; bass presence and intensity control glow orbs. |
| **Halo** | The 96-bin spectrum is shuffled and reduced into 48 radial bar envelopes; intensity sets overall scale/gain, bass hits add a global radius pulse, and high presence adds rim shimmer. |
| **Flow Ink** | Intensity controls simulation motion and dissipation; bass, mid, and high hits inject differently sized splats; mid presence supplies ambient ink; fade controls simulation and final visibility. |

Beat phase, beat confidence, and instant energy bypass the five mapping outputs where a style needs them. The renderer also applies a local responsiveness-controlled envelope to intensity before passing `intensitySmoothed` to a style.

## Boundaries

- The analysis loop uses a fixed `1/60` second time step and targets roughly 60 updates per second.
- The 735-sample minimum hop is fixed rather than derived from the active sample rate.
- Element, rhythm, and mood proxies are included in `AudioFeatureFrame` and the debug overlay, but the current styles primarily consume the mapping outputs, beat data, and energy.
- Mood values do not currently choose a palette.
- No buildup, drop, breakdown, downbeat, or section-state field exists.
- Frequency overlap means transient and element proxies will sometimes respond to the same sound.
