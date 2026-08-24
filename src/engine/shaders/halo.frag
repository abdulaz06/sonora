#version 300 es
precision highp float;

// Halo Spectrum — circular bar graph with two layers:
//
//   Layer 1 — BASE RING: a perfectly circular glowing ring whose radius
//     is driven by Intensity (slow) and bass hits (fast kick). Never
//     deforms. Looks like a single Aura ring with soft glow.
//
//   Layer 2 — FREQUENCY BARS: 48 bars radiate OUTWARD from the ring
//     circumference, perpendicular to it. Heights come from the pulse
//     buffer (fast attack, ~200 ms decay) fed from TypeScript. Bars react
//     to every transient and decay back to zero between hits.
//
// Two variants controlled by u_variant:
//   0 = SOFT  — bars are wide, smoothly interpolated and blend into each
//               other; looks like flames / aurora tendrils rising from ring.
//   1 = SHARP — bars are thin crisp radial lines with clear separation;
//               looks like a premium circular equalizer.
//
// Signals (DOCS/14-MAPPING-LAYER-SPEC.md):
//   - u_pulse[48]      → 48 bar heights (attack/decay on JS side)
//   - u_intensity      → ring base radius (slow macro)
//   - u_bass_pulse     → ring radius kick (fast transient)
//   - u_high_presence  → rim shimmer on ring edge
//   - u_fade_in_out    → global alpha multiplier
//   - u_variant        → 0 = soft, 1 = sharp

uniform vec2  u_resolution;
uniform float u_time;

uniform float u_pulse[48];
uniform float u_intensity;
uniform float u_bass_pulse;
uniform float u_high_presence;
uniform float u_fade_in_out;
uniform int   u_variant;

uniform vec3 u_color_inner;
uniform vec3 u_color_mid;
uniform vec3 u_color_outer;
uniform vec3 u_color_accent;

out vec4 frag_color;

const float TAU    = 6.28318530717959;
const int   N_BARS = 48;
const float BAR_SPACING = TAU / float(N_BARS);   // 7.5° in radians

// ── Helpers ──────────────────────────────────────────────────────────

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

// Circularly-interpolated sample from the 48-bar pulse buffer.
// angle01 in [0,1) maps to the full 2π circle.
float samplePulse(float angle01) {
    angle01 = fract(angle01);
    float idx = angle01 * float(N_BARS);
    int   i0  = int(floor(idx));
    int   i1  = i0 + 1;
    if (i1 >= N_BARS) i1 = 0;
    return mix(u_pulse[i0], u_pulse[i1], fract(idx));
}

void main() {
    // Aspect-corrected UV: shortest axis spans -1..1.
    float scale = min(u_resolution.x, u_resolution.y);
    vec2  uv    = (gl_FragCoord.xy - u_resolution * 0.5) / scale * 2.0;
    float r     = length(uv);
    float ang   = atan(uv.y, uv.x);
    if (ang < 0.0) ang += TAU;
    float ang01 = ang / TAU;

    // ── Layer 1: Base ring (always circular) ─────────────────────
    // Subtle breathing — small intensity drift + small bass-pulse kick.
    // Bars (Layer 2) are the dominant reactive element; the ring only
    // moves enough to feel alive.
    float ringRadius  = (0.22 + u_intensity * 0.03 + u_bass_pulse * 0.04) * u_fade_in_out;
    float dRing       = r - ringRadius;

    // Thin bright core
    float ringThick = 0.011 + u_intensity * 0.004;
    float ringCore  = exp(-dRing * dRing / (ringThick * ringThick));
    // Wider soft glow (bloom-friendly)
    float ringGlow  = exp(-dRing * dRing / (0.075 * 0.075)) * 0.45;
    // Dark inner fill
    float innerFill = smoothstep(ringRadius, max(ringRadius - 0.15, 0.01), r) * 0.13;

    // Ring colour: inner→outer gradient across the band
    float ringMix  = clamp((r - (ringRadius - 0.04)) / 0.09, 0.0, 1.0);
    vec3  ringColor = mix(u_color_inner, u_color_outer, ringMix);

    // Rim shimmer driven by high-band presence
    float rimMask     = exp(-pow(dRing - ringThick * 1.3, 2.0) / 0.0005);
    float shimmer     = hash(vec2(ang * 58.0, floor(u_time * 18.0))) * u_high_presence;
    float shimmerGlow = shimmer * rimMask * 1.5;

    // ── Layer 2: Frequency bars ───────────────────────────────────
    // Bars extend OUTWARD from ringRadius; dBar = 0 at ring surface,
    // positive outside, negative inside (no inward bars). Bars are the
    // primary reactive element — at full pulse and full intensity they
    // can reach the diameter of the ring (≥100 % of ring radius), so
    // a drop literally explodes outward.
    //
    // baseMaxH × (0.5 + 1.0·intensity) → quiet 50 %, loud 150 %.
    float dBar      = r - ringRadius;
    float baseMaxH  = ringRadius * 1.10;
    float maxBarH   = baseMaxH * (0.5 + u_intensity * 1.0);

    float barAlpha      = 0.0;
    float barHeightNorm = 0.0;   // 0 = base, 1 = tip (for colour gradient)
    vec3  barColor      = u_color_mid;

    if (u_variant == 0) {
        // ────────────────────────────────────────────────────────
        // SOFT variant — continuous interpolated surface.
        //
        // samplePulse() interpolates between adjacent bar heights, so
        // the "bars" manifest as a smooth bumpy contour rather than
        // separated spikes. Adjacent active bars merge into flowing arcs.
        // ────────────────────────────────────────────────────────
        float pulseH = samplePulse(ang01);
        float h      = pulseH * maxBarH;

        // Body: bright at base, fades at tip. Wider tip taper + lower
        // bright-bound makes the columns feel like tall flames.
        float body = smoothstep(h + 0.040, h * 0.10, dBar)
                   * smoothstep(-0.012, 0.012, dBar);

        // Sideways Gaussian bloom — much broader so adjacent active bars
        // merge into one continuous crown of flame instead of separate
        // bumps. Sigma raised from 0.06 → 0.11 (≈3× area), amplitude up.
        float glowBody = exp(-dBar * dBar / (0.11 * 0.11)) * pulseH * 1.2
                       * smoothstep(-0.006, 0.008, dBar);

        barAlpha      = (body + glowBody) * clamp(pulseH, 0.0, 2.0);
        barHeightNorm = clamp(dBar / max(h, 0.001), 0.0, 1.0);

        // Colour: ring mid-colour at base, accent at tip
        barColor = mix(u_color_mid, u_color_accent, barHeightNorm * 0.85);

    } else {
        // ────────────────────────────────────────────────────────
        // SHARP variant — thin individual radial bars.
        //
        // For each pixel we find the nearest bar centre and compute
        // a hard-edged line perpendicular to the radial direction.
        // ────────────────────────────────────────────────────────

        // Angular distance to the nearest bar centre. mod trick gives
        // signed value in [-BAR_SPACING/2, BAR_SPACING/2).
        float localAng = mod(ang + BAR_SPACING * 0.5, BAR_SPACING) - BAR_SPACING * 0.5;
        float perpDist = abs(localAng) * r;   // linear distance from bar centre-line

        // Bar index of the nearest bar
        int barIdx = int(floor(ang / BAR_SPACING + 0.5));
        if (barIdx >= N_BARS) barIdx = 0;
        float pulseH = u_pulse[barIdx];
        float h      = pulseH * maxBarH;

        // Half-width: 50 % wider than the previous tuning so each bar
        // reads as a bold needle rather than a thin pin. Stronger height
        // scaling keeps tall bars visually heavier than short ones.
        float hw = 0.0083 + h * 0.015;

        // Hard perpendicular edge with 1-pixel AA
        float perpMask   = 1.0 - smoothstep(hw - 0.001, hw + 0.001, perpDist);
        // Height mask: crisp top, tiny soft base blend onto ring
        float heightMask = smoothstep(h + 0.0015, h - 0.003, dBar)
                         * smoothstep(-0.002, 0.003, dBar);

        barAlpha      = perpMask * heightMask;
        barHeightNorm = clamp(dBar / max(h, 0.001), 0.0, 1.0);

        // Colour: primary at base, brighter accent-tinted at tip
        barColor = mix(u_color_outer * 1.2, u_color_accent * 1.6, barHeightNorm * 0.55);
    }

    // ── Background ───────────────────────────────────────────────
    vec3 bg = u_color_inner * 0.012 * (0.4 + u_intensity * 0.6);
    if (u_variant == 0) {
        // Inner fill only in soft variant — in sharp variant bars stand
        // alone with no ring/disk behind them.
        bg += u_color_inner * innerFill * 0.4;
    }

    // ── Compose ──────────────────────────────────────────────────
    // Soft variant: ring + bars. Sharp variant: bars only (ring is
    // implied by the radial bar alignment, not drawn).
    vec3 color = bg;
    if (u_variant == 0) {
        color += ringColor * ringCore * 1.5
              +  ringColor * ringGlow * 0.9
              +  u_color_accent * shimmerGlow;
        color += barColor * barAlpha * 2.4;
    } else {
        // +30 % brightness vs. previous sharp tuning → bold and punchy.
        color += barColor * barAlpha * 3.6;
    }

    color *= u_fade_in_out;

    frag_color = vec4(color, 1.0);
}
