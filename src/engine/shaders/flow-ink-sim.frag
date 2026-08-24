#version 300 es
precision highp float;

// Flow Field Ink — simulation pass.
// One pass per frame: advect existing density along a curl-noise velocity
// field, dissipate it slightly, then inject any audio-driven impulses.
//
// We don't keep a velocity texture — the velocity is recomputed per-pixel
// from curl noise + audio, which is cheap and avoids a second ping-pong.
//
// State (RGBA): RGB = ink color, A = density. Pre-multiplied so a black
// pixel with high density still advects correctly through tinted areas.

uniform sampler2D u_prev;
uniform vec2  u_resolution;
uniform float u_time;
uniform float u_dt;
uniform float u_intensity;        // 0..1, scales velocity magnitude
uniform float u_dissipation;      // per-frame multiplier (~0.985)
uniform float u_ambient_rate;     // mid-presence × fade — adds gentle ink
uniform vec3  u_ambient_color;
uniform float u_fade_in_out;

// Up to 8 audio-driven impulses (force splats) per frame
const int MAX_IMPULSES = 8;
uniform int   u_impulse_count;
uniform vec2  u_impulse_pos[MAX_IMPULSES];
uniform vec3  u_impulse_color[MAX_IMPULSES];
uniform float u_impulse_strength[MAX_IMPULSES];
uniform float u_impulse_radius[MAX_IMPULSES];
// Initial outward kick direction for each impulse — small offset added to
// the curl velocity at the impulse site so ink scatters outward.
uniform vec2  u_impulse_kick[MAX_IMPULSES];

out vec4 frag_color;

// 2D simplex noise (used for curl)
vec3 mod289_3(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289_2(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute3(vec3 x) { return mod289_3(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289_2(i);
    vec3 p = permute3(permute3(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x  = 2.0 * fract(p * C.www) - 1.0;
    vec3 h  = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

// Curl of a 2D scalar field gives a divergence-free 2D velocity —
// "swirly" without sources or sinks (good for ink-in-water look).
vec2 curl(vec2 p, float t) {
    float eps = 0.01;
    float n1 = snoise(vec2(p.x, p.y + eps) + vec2(0.0, t * 0.07));
    float n2 = snoise(vec2(p.x, p.y - eps) + vec2(0.0, t * 0.07));
    float n3 = snoise(vec2(p.x + eps, p.y) + vec2(t * 0.07, 0.0));
    float n4 = snoise(vec2(p.x - eps, p.y) + vec2(t * 0.07, 0.0));
    return vec2(n1 - n2, -(n3 - n4)) / (2.0 * eps);
}

// Tiny hash for ambient ink jitter
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // ── Velocity field ────────────────────────────────────
    // Centered coords so curl noise looks symmetric on screen.
    vec2 p = (uv - 0.5) * 2.0;
    // Multi-scale: a slow-flowing layer + a finer turbulence layer that
    // intensifies with the music.
    vec2 v = curl(p * 1.2 + vec2(u_time * 0.04, 0.0), u_time);
    v += curl(p * 3.5 + vec2(0.0, u_time * 0.07), u_time * 1.4) * 0.4 * u_intensity;

    // Add a slight outward bias near each recent impulse so kicks "blow"
    // ink away rather than just adding to it.
    for (int i = 0; i < MAX_IMPULSES; i++) {
        if (i >= u_impulse_count) break;
        vec2 d = uv - u_impulse_pos[i];
        float r = u_impulse_radius[i];
        float falloff = exp(-dot(d, d) / (r * r));
        v += u_impulse_kick[i] * falloff * u_impulse_strength[i] * 1.2;
    }

    // Velocity magnitude scales with intensity — quiet sections are
    // calm/slow flowing, drops are chaotic.
    float speed = 0.012 + u_intensity * 0.07;
    v *= speed;

    // ── Advect previous density ───────────────────────────
    // Semi-Lagrangian: sample where this pixel "came from" last frame.
    vec2 srcUV = uv - v * u_dt * 30.0;
    vec4 advected = texture(u_prev, srcUV);

    // Dissipation — ink slowly fades. Stronger fade during silence so the
    // canvas isn't permanently stained.
    float diss = mix(u_dissipation - 0.04, u_dissipation, u_fade_in_out);
    advected *= diss;

    // ── Inject audio impulses ─────────────────────────────
    vec3 addColor = vec3(0.0);
    float addDensity = 0.0;
    for (int i = 0; i < MAX_IMPULSES; i++) {
        if (i >= u_impulse_count) break;
        vec2 d = uv - u_impulse_pos[i];
        float r = u_impulse_radius[i];
        float falloff = exp(-dot(d, d) / (r * r));
        addColor   += u_impulse_color[i] * u_impulse_strength[i] * falloff;
        addDensity += u_impulse_strength[i] * falloff;
    }

    // ── Ambient ink (mid-band-presence drizzle) ───────────
    // Sparse points that flicker on, so we don't paint everything uniformly.
    if (u_ambient_rate > 0.0) {
        float seed = hash(floor(uv * 64.0) + floor(u_time * 12.0));
        if (seed > 1.0 - u_ambient_rate * 0.025) {
            float a = u_ambient_rate * 0.18;
            addColor   += u_ambient_color * a;
            addDensity += a * 0.6;
        }
    }

    advected.rgb += addColor;
    advected.a   += addDensity;

    // Soft cap so the field can't run away to white.
    advected.rgb = min(advected.rgb, vec3(2.5));
    advected.a   = min(advected.a, 1.6);

    frag_color = advected;
}
