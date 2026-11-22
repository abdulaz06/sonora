#version 300 es
precision highp float;
precision highp int;
// Cymatics relief: sand density (blurred for shape, raw for grain) on a raised
// plate with a carved medallion, shaded like a bas-relief: grazing light,
// deep shadows (a short march along the light over the heightfield),
// ambient occlusion from a wide blur, fibrous fur on the sand. Edge smoke and
// thrown grains on top. LOOK 0 stone, 1 sand, 2 liquid (standing waves with
// caustics over the sand at the bottom).
uniform sampler2D u_dens;        // blurred density (mipmapped): r plate sand, g airborne, b thrown grains
uniform sampler2D u_raw;         // raw density (grain detail)
uniform sampler2D u_smoke;
uniform vec2 u_res;
uniform float u_time;
uniform float u_extent;
uniform vec2 u_cam;              // plate point at the screen centre
uniform float u_view;            // plate units visible vertically
uniform float u_rot;
uniform vec2 u_half;
uniform float u_round;
uniform float u_med;             // medallion radius (0 = none)
uniform float u_med_rings;       // rings inside the medallion
uniform vec3 u_light_dir;        // toward the light (unit)
uniform vec3 u_light_col;
uniform vec3 u_shadow_col;       // the deepest shadows' tint
uniform vec3 u_amb_col;
uniform vec3 u_bg;
uniform vec3 u_glint_col;
uniform float u_gain;            // sand height gain
uniform float u_shock;           // kick ring: front radius
uniform float u_shock_amp;
uniform int u_shadow_steps;
uniform vec4 u_modeA;            // liquid: the standing wave
uniform vec4 u_modeB;
uniform float u_blend;
uniform float u_wave;            // liquid: wave amplitude × sin(ωt)
uniform float u_flash;           // drop: a brief lift of the light
out vec4 frag;
//#include noise

const float PI = 3.14159265;

float sdPlate(vec2 p) {
  vec2 q = abs(p) - u_half + u_round;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_round;
}
float chladni(vec2 p, vec4 md) {
  vec2 q = p * PI;
  return cos(md.y * q.x) * cos(md.x * q.y) - md.z * cos(md.x * q.x) * cos(md.y * q.y);
}
vec2 duv(vec2 p) { return p / u_extent * 0.5 + 0.5; }
// Outside the density target there's nothing (no clamped edge texels smearing).
float inside(vec2 p) { vec2 q = abs(p) / u_extent; return step(max(q.x, q.y), 0.995); }

// Height of the relief at plate point p.
float height(vec2 p, out float sand) {
  float d = sdPlate(p);
  sand = texture(u_dens, duv(p)).r * inside(p);
#if LOOK == 2
  // Liquid: the standing wave itself (no slab: the water's edge is soft).
  float h = 0.0;
  float u = mix(chladni(p, u_modeA), chladni(p, u_modeB), u_blend);
  h += u * u_wave * 0.06 * smoothstep(0.02, -0.08, d);
  h += 0.004 * (1.0 - exp(-sand * u_gain * 0.5));                   // sand on the bottom shows through
#else
  float h = 0.06 * smoothstep(0.012, -0.012, d);                    // the plate, bevelled
  float s = 1.0 - exp(-sand * u_gain);
  h += 0.07 * s;
  // Fur: fine fibres combed along the slope of the sand.
  float sx2 = texture(u_dens, duv(p + vec2(0.01, 0.0))).r - texture(u_dens, duv(p - vec2(0.01, 0.0))).r;
  float sy2 = texture(u_dens, duv(p + vec2(0.0, 0.01))).r - texture(u_dens, duv(p - vec2(0.0, 0.01))).r;
  vec2 gd = normalize(vec2(sx2, sy2) + 1e-5);
  float fib = snoise(vec3(dot(p, gd) * 26.0, dot(p, vec2(-gd.y, gd.x)) * 520.0, 0.0));
  h += 0.006 * fib * s * (LOOK == 1 ? 0.3 : 1.0);
  // Fibrous fur on the sand: fine strands along the slope.
  float raw = texture(u_raw, duv(p)).r * inside(p);
  h += 0.008 * (1.0 - exp(-raw * u_gain * 0.6)) * (LOOK == 1 ? 1.4 : 0.8);
#endif
  // Medallion: a carved disc with a rim and rings, growing from the centre.
  float r = length(p * vec2(1.0, 0.92));
  if (u_med > 0.01) {
    float disc = smoothstep(u_med + 0.006, u_med - 0.006, r);
    float rim = exp(-pow((r - u_med) / 0.012, 2.0));
    h += disc * 0.012 + rim * 0.016;
    // the eye: a shallow well at the very centre
    h -= 0.012 * smoothstep(0.16 * u_med, 0.08 * u_med, r) * disc;
  }
  // Kick ring: a ripple through the relief on the hit frame.
  if (u_shock_amp > 0.001) h += u_shock_amp * 0.02 * exp(-pow((r - u_shock) / 0.035, 2.0));
  return h;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  vec2 v = vec2(ndc.x * aspect, ndc.y) * u_view * 0.5;
  float c = cos(u_rot), s = sin(u_rot);
  vec2 p = u_cam + vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  float px = u_view / u_res.y;                // plate units per pixel

  float sand;
  float h = height(p, sand);
  float e = max(px, 0.0025);
  float sx, sy;
  float hx = height(p + vec2(e, 0.0), sx), hy = height(p + vec2(0.0, e), sy);
  vec3 N = normalize(vec3(-(hx - h) / e, -(hy - h) / e, 1.0));
  vec3 L = u_light_dir;
  float diff = max(dot(N, L), 0.0);
  // Shadow: march toward the light over the heightfield.
  float shadow = 1.0;
  float t = 0.006;
  for (int i = 0; i < 24; i++) {
    if (i >= u_shadow_steps) break;
    vec3 q = vec3(p, h) + L * t;
    float sd2;
    float hq = height(q.xy, sd2);
    shadow = min(shadow, clamp((q.z - hq) * 35.0 + 0.6, 0.0, 1.0));
    t *= 1.45;
  }
  // Ambient occlusion: how far the wide neighbourhood stands above this point.
  float wide = textureLod(u_dens, duv(p), 4.0).r;
  float ao = clamp(1.0 - (1.0 - exp(-wide * u_gain)) * 0.55 + (1.0 - exp(-sand * u_gain)) * 0.35, 0.25, 1.0);
  float d = sdPlate(p);
  float onPlate = smoothstep(0.02, -0.01, d);

#if LOOK == 2
  // Liquid: dark water, sky reflection by Fresnel, caustics from the surface's curvature.
  float lap = (hx + hy + height(p - vec2(e, 0.0), sx) + height(p - vec2(0.0, e), sy) - 4.0 * h) / (e * e);
  float caustic = clamp(0.45 - lap * 0.02, 0.0, 3.0);
  caustic = pow(caustic, 2.6);
  float raw = texture(u_raw, duv(p)).r * inside(p);
  vec3 bottom = u_shadow_col * 0.55 + u_light_col * (0.05 * (1.0 - exp(-raw * u_gain * 0.4)) + 0.26 * min(caustic, 2.2));
  float fres = pow(1.0 - max(N.z, 0.0), 3.0) * 0.9 + 0.03;
  vec3 sky = mix(u_amb_col, u_light_col, 0.5 + 0.5 * N.x);
  vec3 spec = u_light_col * pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 60.0) * 1.4;
  vec3 col = mix(bottom * (0.6 + 0.4 * shadow), sky * 0.5, fres) + spec * shadow;
#else
  vec3 albedo = LOOK == 1 ? vec3(0.72, 0.64, 0.52) : vec3(0.62, 0.62, 0.64);
  // Fine grain everywhere on the stone/sand (texture over blur).
  // Stone grain at two scales (texture over blur).
  float grain = 0.82 + 0.22 * snoise(vec3(p * 420.0, 0.0)) + 0.12 * snoise(vec3(p * 36.0, 3.0));
  float raw = texture(u_raw, duv(p)).r;
  if (LOOK == 1) grain *= 0.8 + 0.4 * (1.0 - exp(-raw * 2.0));
  // Wrapped diffuse: crests facing the light glow, slopes away from it fall to shadow.
  float wrap = max(dot(N, L) * 0.8 + 0.2, 0.0);
  vec3 lit = u_light_col * wrap * mix(0.25, 1.0, shadow);
  vec3 col = albedo * grain * (lit * 1.25 + u_amb_col * ao * 0.5);
  // Deep shadows keep a tint of the palette.
  vec3 deep = mix(vec3(dot(u_shadow_col, vec3(0.33))), u_shadow_col, 0.55) * 0.3;
  col = mix(deep + col * 0.25, col, smoothstep(0.0, 0.12, diff * shadow + 0.04));
  // Sheen on the sand's crests.
  col += u_light_col * pow(max(dot(reflect(-L, N), vec3(0.0, 0.0, 1.0)), 0.0), 24.0) * 0.12 * shadow * (1.0 - exp(-sand * u_gain));
  col *= mix(0.6, 1.0, ao);
#endif
  col *= onPlate;
  col += u_bg * (1.0 - onPlate);
  col *= 1.0 + u_flash * 0.25;

  // Airborne sand catches the light; thrown grains sparkle in the dark.
  vec3 dd = texture(u_dens, duv(p), 0.0).rgb * inside(p);
  vec3 dr = texture(u_raw, duv(p)).rgb * inside(p);
  col += u_glint_col * (dr.g * 0.04 + dd.g * 0.02);
  col += u_glint_col * min(dr.b * 0.6, 1.5);

  // Edge smoke: mirrored fibrous wisps, lit by the light.
  float sm = texture(u_smoke, duv(vec2(abs(p.x), p.y))).r * inside(p) * smoothstep(u_extent, u_extent * 0.8, length(p));
  // Fibres run outward from the plate (radial), not in screen rows.
  vec2 rp = vec2(atan(p.y, abs(p.x)), length(p));
  float fib = 0.6 + 0.4 * snoise(vec3(rp.x * 40.0, rp.y * 5.0, u_time * 0.2));
  vec3 smokeCol = mix(u_shadow_col * 0.4, u_light_col * 0.6, 0.5 + 0.5 * L.x * sign(p.x + 1e-4) * 0.5);
  col = mix(col, smokeCol * 1.6, clamp(sm * fib * 2.2, 0.0, 0.92) * (1.0 - onPlate * 0.6));
  frag = vec4(col, 1.0);
}
