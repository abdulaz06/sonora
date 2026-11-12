#version 300 es
precision highp float;
// Voyage raymarch (Mandelbox). Renders at a reduced resolution with a
// sub-pixel jitter; resolve.frag accumulates the frames to full resolution.
// Output: rgb = shaded colour (HDR), a = hit distance (large for sky).
//
// Space is bent before the fractal is sampled: a slow "melting" sine warp,
// and a corkscrew twist about the view axis that grows with distance from
// the camera (zero at the camera, so the flight never clips). Rays that
// leave the fractal continue into the backdrop: a huge cylinder whose inner
// wall is tiled with mini Mandelboxes, so an endless world curves up and
// over wherever the view opens out, with the sun glowing at the far end.
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
uniform float u_twist;       // corkscrew (rad per world unit ahead of the camera)
uniform float u_lip;         // distance-bound correction for the bending
// Backdrop cylinder world
uniform float u_world_r;     // cylinder radius
uniform float u_world_p;     // tile period (around and along)
uniform float u_world_sc;    // tile scale (mini box size / box size)
uniform int u_world_steps;
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

// Bend space: corkscrew about the view axis (grows with distance ahead),
// then a slow melting warp. Mirrored on the CPU (warp only) for the planner.
vec3 bend(vec3 p) {
  vec3 rel = p - u_cam_pos;
  float along = max(dot(rel, u_cam_fwd), 0.0);
  float ang = u_twist * along;
  float x = dot(rel, u_cam_right), y = dot(rel, u_cam_up);
  float c = cos(ang), s = sin(ang);
  rel += u_cam_right * ((c * x - s * y) - x) + u_cam_up * ((s * x + c * y) - y);
  p = u_cam_pos + rel;
  p += u_warp_amp * sin(p.yzx * u_warp_freq + vec3(u_time * 0.35, u_time * 0.29, u_time * 0.41));
  return p;
}

float de(vec3 p) { return deIt(bend(p), u_iters) * u_lip; }

// Backdrop: inner wall of a cylinder (axis z) tiled with mini Mandelboxes,
// unrolled into flat coordinates (around, depth into the wall, along).
float deWorld(vec3 p) {
  p = bend(p);
  float rho = length(p.xy);
  float th = atan(p.y, p.x);
  // Boxes centred on the wall and sliced flush with it, so what faces the
  // air is their carved interior (cavities, arches), not flat cube faces.
  vec3 q = vec3(th * u_world_r, rho - u_world_r, p.z);
  q.x = mod(q.x + 0.5 * u_world_p, u_world_p) - 0.5 * u_world_p;
  q.z = mod(q.z + 0.5 * u_world_p, u_world_p) - 0.5 * u_world_p;
  float d = deIt(q / u_world_sc, 6) * u_world_sc * 0.8;
  return max(d, (u_world_r - u_world_p * 0.08) - rho);
}

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

vec3 shadeWorld(vec3 ro, vec3 rd, float t0, float pix, out float tHit) {
  float t = t0;
  bool hit = false;
  for (int i = 0; i < 96; i++) {
    if (i >= u_world_steps) break;
    float d = deWorld(ro + rd * t);
    if (d < pix * t * 2.5) { hit = true; break; }
    t += d;
    if (t > u_world_r * 6.0) break;
  }
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = hit ? t : 1000.0;
  if (!hit) return atm;
  vec3 p = ro + rd * t;
  float e = pix * t;
  vec2 k = vec2(1.0, -1.0);
  vec3 n = normalize(k.xyy * deWorld(p + k.xyy * e) + k.yyx * deWorld(p + k.yyx * e)
                   + k.yxy * deWorld(p + k.yxy * e) + k.xxx * deWorld(p + k.xxx * e) + vec3(0.0, 1e-6, 0.0));
  float tile = snoise(floor(p / u_world_p) * 0.7) * 0.5 + 0.5;
  vec3 albedo = mix(vec3(0.6), mix(u_c0, u_c1, tile), 0.5);
  float dif = max(dot(n, u_sun), 0.0);
  vec3 col = albedo * (dif * 1.3 + 0.35) * u_light;
  col += u_c2 * smoothstep(0.6, 1.0, snoise(p * 0.15 + u_time * 0.05)) * (0.2 + 1.2 * u_pulse) * u_light;
  float fog = 1.0 - exp(-(t - t0) * 0.016);
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
    // Out of the fractal: the endless cylinder world beyond.
    col = shadeWorld(ro, rd, t, pix, tOut);
  }
  // Edge halo.
  col += mix(u_c2, u_c3, 0.5) * min(glow * 0.006, 0.6) * (0.08 + 0.6 * u_glow + 1.0 * u_pulse) * u_light;
  frag = vec4(max(col, vec3(0.0)), tOut);
}
