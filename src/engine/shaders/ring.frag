#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform float u_time;

// Background
uniform float u_bass_energy;
uniform float u_beat_pulse;
uniform float u_onset_flash;

// Loudness-driven presence (0 = silence, 1 = loud)
uniform float u_loudness;

// Up to 10 rings: [radius, energy, thickness, glow]
uniform vec4  u_ring[10];
uniform vec3  u_ring_color[10];
uniform int   u_ring_count;

// Ring silhouette: 0 = circle, 1 = triangle (rounded), 2 = square
// (sharp 90° corners). The glow band falloff stays smooth in every
// variant — only the shape's outline geometry changes.
uniform int   u_shape;

out vec4 frag_color;

// Screen blend: preserves color saturation better than additive
vec3 screen(vec3 base, vec3 blend) {
    return 1.0 - (1.0 - base) * (1.0 - blend);
}

// SDF: equilateral triangle inscribed in a circle of radius r, pointing up.
// Returns signed distance — negative inside, positive outside.
float sdEquilateralTriangle(vec2 p, float r) {
    const float k = 1.7320508;   // sqrt(3)
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) {
        p = vec2(p.x - k * p.y, -k * p.x - p.y) * 0.5;
    }
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
}

// SDF: axis-aligned box with half-extents b.
float sdBox(vec2 p, vec2 b) {
    vec2 d = abs(p) - b;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

// Radial signed distance to the ring silhouette. Zero on the boundary,
// positive outside, negative inside. The triangle keeps soft corners
// (apex feels organic); the square is sharp 90° corners — the soft
// glow band around it comes entirely from the smoothstep / exp falloff
// downstream, not from rounding the SDF itself.
float shapeDist(vec2 uv, float r) {
    if (u_shape == 1) {
        // Triangle: scale up slightly so its visual size matches the
        // circle's apparent radius, then offset to round corners.
        return sdEquilateralTriangle(uv, r * 1.15) + 0.06;
    } else if (u_shape == 2) {
        // Sharp square: half-extent = r, no corner rounding.
        return sdBox(uv, vec2(r));
    }
    return length(uv) - r;
}

void main() {
    // Aspect-corrected UV: shortest axis = -1..1
    float scale = min(u_resolution.x, u_resolution.y);
    vec2 uv = (gl_FragCoord.xy - u_resolution * 0.5) / scale * 2.0;
    float dist = length(uv);

    // Background: dark, modulated by loudness
    vec3 bg = vec3(0.02, 0.015, 0.035) * (0.3 + u_loudness * 0.7);
    bg += vec3(0.025, 0.012, 0.04) * u_bass_energy * u_loudness;
    // Subtle vignette — uses Chebyshev distance for the square so the
    // dark→light interior follows the square's outline (no soft circular
    // fade inside the geometry). Circle/triangle keep the radial fade.
    float vignetteDist = (u_shape == 2)
        ? max(abs(uv.x), abs(uv.y))
        : dist;
    bg *= 1.0 - vignetteDist * 0.3;

    // Beat flash: full-screen brightness pulse, scaled by loudness
    bg += vec3(0.06, 0.05, 0.10) * u_onset_flash * u_loudness;

    vec3 color = bg;

    // Per-shape ring tightening. The square's wide bands and glow halos
    // would otherwise bleed across each corner and round it visually
    // even though the SDF itself is sharp. We thin the ring band to
    // ~60 % of the circle's thickness and tighten the glow falloff to
    // ~55 %, so the corners stay crisp 90° angles. Applied uniformly
    // to all rings (the loop runs over every active u_ring entry).
    float thickScale = (u_shape == 2) ? 0.60 : 1.0;
    float glowScale  = (u_shape == 2) ? 0.55 : 1.0;

    // Render rings as SDFs
    for (int i = 0; i < 10; i++) {
        if (i >= u_ring_count) break;

        float radius    = u_ring[i].x;
        float energy    = u_ring[i].y;
        float thickness = u_ring[i].z * thickScale;
        float glow      = u_ring[i].w * glowScale;

        // Beat breathing
        float breath = 1.0 + 0.04 * u_beat_pulse;
        float r = radius * breath;

        // Ring SDF — shape varies per variant (circle / triangle / square).
        float ring_dist = abs(shapeDist(uv, r));
        float inner = smoothstep(thickness + glow, thickness, ring_dist);
        float outer_glow = exp(-ring_dist * ring_dist / (glow * glow * 2.0)) * 0.35;

        float alpha = inner + outer_glow;
        alpha *= 0.4 + energy * 0.6;
        // Fade rings with loudness
        alpha *= u_loudness;

        // Screen blend to preserve saturation (avoids white wash)
        vec3 ring_contribution = u_ring_color[i] * alpha;
        color = screen(color, ring_contribution);
    }

    frag_color = vec4(color, 1.0);
}
