#version 300 es
precision highp float;
// Voyage raymarch (Mandelbox). Renders at a reduced resolution with a
// sub-pixel jitter; resolve.frag accumulates the frames to full resolution.
// Output: rgb = shaded colour (HDR), a = hit distance (large for sky).
//
// Space is bent by a slow "melting" sine warp before the fractal is sampled
// (mirrored on the CPU for the flight planner). Rays that leave the fractal
// meet a thin landscape drawn on the inside of a giant cylinder (axis z) whose
// floor lies just below the fractal: fields, ridges and rivers rise on both
// sides into the haze and over the top, with the sun at the far end of the
// axis. The world never reacts to beats; only light (veins) does.
uniform vec2 u_res;
uniform vec2 u_jitter;
uniform vec3 u_cam_pos;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform vec3 u_cam_fwd;
uniform float u_tan_half;
uniform float u_aspect;
// Fractal
uniform float u_scale;
uniform float u_min_r2;
uniform float u_fold;
uniform int u_iters;
// Space bending
uniform float u_warp_amp;    // melt amplitude (world units)
uniform float u_warp_freq;
uniform float u_twist;       // fractal corkscrew (rad per world unit ahead of the camera)
uniform float u_lip;         // distance-bound correction for the bending
// Landscape cylinder
uniform float u_land_r;      // radius
uniform float u_land_cy;     // axis height (axis along z through (0, cy))
// March budget
uniform int u_steps;
uniform float u_detail;      // surface epsilon in pixels
uniform float u_far;
uniform float u_ao_on;
// Look
uniform vec3 u_sun;
uniform vec3 u_bg;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform float u_time;
uniform float u_pulse;       // bass hit envelope: emissive veins
uniform float u_glow;        // energy glow (intensity / build)
uniform float u_shimmer;     // highs: iridescent sheen
uniform float u_fog;
uniform float u_light;       // overall light (fade in/out)
out vec4 frag;
//#include noise

float deIt(vec3 pos, int iters) {
  vec4 p = vec4(pos, 1.0);
  vec4 p0 = p;
  float maxK = 1.0 / u_min_r2;
  vec4 s = vec4(vec3(u_scale), abs(u_scale));
  for (int i = 0; i < 16; i++) {
    if (i >= iters) break;
    p.xyz = clamp(p.xyz, -u_fold, u_fold) * 2.0 - p.xyz;
    float r2 = dot(p.xyz, p.xyz);
    p *= clamp(1.0 / max(r2, 1e-6), 1.0, maxK);
    p = p * s + p0;
  }
  return length(p.xyz) / abs(p.w);
}

// Orbit trap: min |x|,|y|,|z| and min r² over the iterations.
vec4 trap(vec3 pos) {
  vec4 p = vec4(pos, 1.0);
  vec4 p0 = p;
  float maxK = 1.0 / u_min_r2;
  vec4 s = vec4(vec3(u_scale), abs(u_scale));
  vec4 t = vec4(1e9);
  for (int i = 0; i < 16; i++) {
    if (i >= u_iters) break;
    p.xyz = clamp(p.xyz, -u_fold, u_fold) * 2.0 - p.xyz;
    float r2 = dot(p.xyz, p.xyz);
    p *= clamp(1.0 / max(r2, 1e-6), 1.0, maxK);
    if (i > 0) t = min(t, vec4(abs(p.xyz), r2));
    p = p * s + p0;
  }
  return t;
}

// Bend the fractal's space (the landscape is never bent): a corkscrew about
// the view axis that kicks on beats (zero at the camera, so the flight never
// clips), then the slow melting warp (mirrored on the CPU for the planner).
vec3 bend(vec3 p) {
  vec3 rel = p - u_cam_pos;
  float along = max(dot(rel, u_cam_fwd), 0.0);
  float ang = u_twist * along;
  float x = dot(rel, u_cam_right), y = dot(rel, u_cam_up);
  float c = cos(ang), s = sin(ang);
  rel += u_cam_right * ((c * x - s * y) - x) + u_cam_up * ((s * x + c * y) - y);
  p = u_cam_pos + rel;
  return p + u_warp_amp * sin(p.yzx * u_warp_freq + vec3(u_time * 0.35, u_time * 0.29, u_time * 0.41));
}

float de(vec3 p) { return deIt(bend(p), u_iters) * u_lip; }

vec3 sky(vec3 rd) {
  float h = rd.y;
  vec3 c = mix(u_bg * 1.4 + u_c0 * 0.08, u_bg + u_c1 * 0.34, smoothstep(-0.6, 0.9, h));
  float n = snoise(rd * 2.2 + vec3(0.0, 0.0, u_time * 0.01)) * 0.5 + 0.5;
  float n2 = snoise(rd * 6.0 - vec3(u_time * 0.015)) * 0.5 + 0.5;
  c += mix(u_c1, u_c0, n2) * pow(n, 3.0) * 0.26;
  float s = max(dot(rd, u_sun), 0.0);
  c += u_c3 * (pow(s, 90.0) * 3.0 + pow(s, 8.0) * 0.35 + pow(s, 2.0) * 0.06);
  return c;
}

// Atmosphere inside the cylinder: hazy, lit toward the sun end of the axis.
vec3 atmosphere(vec3 rd) {
  float s = max(dot(rd, u_sun), 0.0);
  vec3 c = mix(u_bg * 1.6 + u_c1 * 0.18, u_c0 * 0.35 + u_c3 * 0.12, 0.5 + 0.5 * rd.z * sign(u_sun.z));
  c += u_c3 * (pow(s, 40.0) * 2.4 + pow(s, 5.0) * 0.45);
  return c;
}

float fbm2(vec2 q) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(vec3(q, 3.7 * float(i))); q = q * 2.07 + 1.3; a *= 0.5; }
  return v;
}

vec2 cellHash(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }

// Land height (0..1) and type at unrolled coordinates q (world units).
// Small patchwork fields with crop rows over rolling ground, dark forests,
// ridges, rivers, and fractal "cities" (a slice through the Mandelbox).
float landH(vec2 q, out float water, out float city, out float field, out float forest) {
  float roll = fbm2(q * 0.02);
  float ridge = 1.0 - abs(snoise(vec3(q * 0.008, 9.1)));
  float h = 0.4 + 0.3 * roll + 0.3 * ridge * ridge * ridge;
  float rv = abs(fbm2(q * 0.006 + 4.0));
  water = smoothstep(0.03, 0.012, rv);
  forest = smoothstep(0.1, 0.35, fbm2(q * 0.05 + 11.0)) * (1.0 - water);
  // Fields: Voronoi patchwork about two units across, each with crop rows.
  vec2 g = q * 0.45;
  vec2 c = floor(g), f = fract(g);
  float d1 = 9.0, d2 = 9.0;
  vec2 best = c;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 o = vec2(x, y);
    vec2 r = o + cellHash(c + o) - f;
    float dd = dot(r, r);
    if (dd < d1) { d2 = d1; d1 = dd; best = c + o; } else if (dd < d2) d2 = dd;
  }
  vec2 hb = cellHash(best);
  field = hb.x;
  float border = smoothstep(0.0, 0.06, sqrt(d2) - sqrt(d1));
  float rowA = hb.y * 3.14159;
  float rows = 0.5 + 0.5 * sin(dot(q, vec2(cos(rowA), sin(rowA))) * 9.0);
  float region = smoothstep(0.3, 0.6, snoise(vec3(q * 0.006, 2.3)));
  float slice = deIt(vec3(mod(q * 0.22, 8.2) - 4.1, 0.37), 6);
  city = region * smoothstep(0.03, 0.0, slice);
  h += 0.12 * city - 0.2 * water + 0.06 * forest + 0.03 * rows * (1.0 - forest);
  return h * (0.8 + 0.2 * border);
}

// The landscape on the inside of the cylinder, or the hazy axis / sun.
vec3 landscape(vec3 ro, vec3 rd, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  vec2 o = ro.xy - vec2(0.0, u_land_cy);
  vec2 d = rd.xy;
  float a = dot(d, d);
  if (a < 1e-5) return atm;
  float b = dot(o, d), c = dot(o, o) - u_land_r * u_land_r;
  float disc = b * b - a * c;
  if (disc < 0.0) return atm;
  float t = (-b + sqrt(disc)) / a;
  vec3 p = ro + rd * t;
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  float ang = atan(rel.x, -rel.y);               // 0 on the floor, ±π overhead
  vec2 q = vec2(ang * u_land_r, p.z);
  float water, city, field, forest;
  float h = landH(q, water, city, field, forest);
  // Shading normal: inward radial plus the height-field slope.
  vec3 nIn = normalize(vec3(-rel, 0.0));
  vec3 tA = normalize(vec3(-rel.y, rel.x, 0.0));
  float e = 0.8, w0, c0, f0, g0;
  float hx = landH(q + vec2(e, 0.0), w0, c0, f0, g0) - h;
  float hz = landH(q + vec2(0.0, e), w0, c0, f0, g0) - h;
  vec3 n = normalize(nIn - (tA * hx + vec3(0.0, 0.0, 1.0) * hz) * 3.0);
  // Palette-tinted land: fields in primary / secondary / accent, cities in
  // stone with lit windows, rivers reflecting the sky.
  // Earthy base, lightly tinted by the palette so every palette still reads as land.
  vec3 earth = field < 0.33 ? vec3(0.36, 0.38, 0.26) : field < 0.66 ? vec3(0.46, 0.42, 0.3) : vec3(0.3, 0.36, 0.3);
  vec3 tint = field < 0.5 ? u_c0 : u_c1;
  vec3 albedo = mix(earth, tint * 0.75, 0.3) * (0.65 + 0.55 * h);
  albedo = mix(albedo, vec3(0.1, 0.14, 0.11) + u_c1 * 0.05, forest * 0.85);
  albedo = mix(albedo, vec3(0.55, 0.54, 0.52), city * 0.85);
  float dif = max(dot(n, u_sun), 0.0);
  vec3 col = albedo * (dif * 1.25 + 0.3 + 0.25 * max(dot(n, -rd), 0.0));
  col += u_c3 * city * step(0.82, cellHash(floor(q * 1.3)).y) * 0.6;
  vec3 refl = atmosphere(reflect(rd, nIn)) * 0.9;
  col = mix(col, refl, water * 0.85);
  col *= u_light;
  // Aerial perspective: the far side (overhead) fades into the haze.
  float fog = 1.0 - exp(-t * 0.011);
  tHit = t;
  return mix(col, atm, fog);
}

void main() {
  vec2 fc = gl_FragCoord.xy + u_jitter;
  vec2 ndc = fc / u_res * 2.0 - 1.0;
  vec3 rd = normalize(u_cam_fwd + ndc.x * u_tan_half * u_aspect * u_cam_right + ndc.y * u_tan_half * u_cam_up);
  vec3 ro = u_cam_pos;
  float pix = 2.0 * u_tan_half / u_res.y;
  float t = 0.0;
  float d = 1.0;
  float glow = 0.0;
  bool hit = false;
  int i = 0;
  for (; i < 400; i++) {
    if (i >= u_steps) break;
    d = de(ro + rd * t);
    float eps = pix * u_detail * max(t, 0.02);
    // Near misses (rays grazing edges) accumulate a halo.
    glow += exp(-60.0 * d / max(t, 0.02));
    if (d < eps) { hit = true; break; }
    t += d * 0.92;
    if (t > u_far) break;
  }
  // Ran out of steps close to the surface: shade it as a hit.
  if (!hit && t < u_far) hit = true;
  float stepFrac = float(i) / float(u_steps);
  vec3 col;
  float tOut = t;
  if (hit) {
    vec3 p = ro + rd * t;
    float e = max(pix * max(t, 0.02) * 0.5, 1e-5);
    vec2 k = vec2(1.0, -1.0);
    vec3 n = normalize(k.xyy * de(p + k.xyy * e) + k.yyx * de(p + k.yyx * e)
                     + k.yxy * de(p + k.yxy * e) + k.xxx * de(p + k.xxx * e) + vec3(0.0, 1e-6, 0.0));
    // Step-count occlusion, floored: rays that run out of steps on a grazing
    // (warped) surface must not turn into black cracks.
    float ao = max(pow(1.0 - stepFrac, 1.6), 0.3);
    if (u_ao_on > 0.5) {
      float h1 = 0.015 + t * 0.03, h2 = 0.05 + t * 0.1;
      ao *= clamp(0.3 + 0.35 * (de(p + n * h1) / h1 + de(p + n * h2) / h2), 0.0, 1.0);
    }
    vec4 tr = trap(bend(p));
    float edge = min(tr.x, min(tr.y, tr.z));
    float band = clamp(sqrt(tr.w), 0.0, 1.0);
    vec3 tint = mix(u_c0, u_c1, smoothstep(0.2, 0.9, band));
    // Stone-like albedo, tinted by the palette.
    vec3 albedo = mix(vec3(0.66, 0.64, 0.61), tint, 0.42);
    float dif = max(dot(n, u_sun), 0.0);
    float head = max(dot(n, -rd), 0.0);
    vec3 amb = sky(n) * 1.6;
    col = albedo * (dif * 1.5 * mix(vec3(1.0), u_c3, 0.3) + amb * 0.4 + head * 0.18) * ao;
    // Specular glint from the sun.
    vec3 hv = normalize(u_sun - rd);
    col += u_c3 * pow(max(dot(n, hv), 0.0), 40.0) * 0.6 * ao;
    // Iridescent sheen at grazing angles, stronger on the highs.
    float fres = pow(1.0 - head, 3.0);
    vec3 irid = hueRotate(mix(u_c3, u_c1, 0.5), (fres * 1.6 + band * 1.2 + u_time * 0.08) * 70.0 - 35.0);
    col += irid * fres * (0.18 + 0.9 * u_shimmer) * ao;
    // Emissive veins along the fine detail, kicked by bass hits.
    float vein = smoothstep(0.045, 0.0, edge);
    col += u_c2 * vein * (0.04 + 1.4 * u_pulse + 0.5 * u_glow) * ao;
    col *= u_light;
    float fog = 1.0 - exp(-t * u_fog);
    col = mix(col, atmosphere(rd) * mix(0.6, 1.0, u_light), fog);
  } else {
    // Out of the fractal: the landscape curving up around and over us.
    col = landscape(ro, rd, tOut);
  }
  // Edge halo.
  col += mix(u_c2, u_c3, 0.5) * min(glow * 0.006, 0.6) * (0.08 + 0.6 * u_glow + 1.0 * u_pulse) * u_light;
  frag = vec4(max(col, vec3(0.0)), tOut);
}
