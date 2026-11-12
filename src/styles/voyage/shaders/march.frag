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

// Cheap value noise for fine texture (one octave, smooth).
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i).x, b = cellHash(i + vec2(1, 0)).x, c = cellHash(i + vec2(0, 1)).x, d = cellHash(i + vec2(1, 1)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ── Land layout (unrolled coordinates q: x around the cylinder, y along) ──
// Large-scale terrain classes; everything is in world units.
struct Land { float h; float water; float shore; float forest; float rock; float city; float cityCore; };

Land landAt(vec2 q) {
  Land L;
  float roll = fbm2(q * 0.02);
  float ridge = 1.0 - abs(snoise(vec3(q * 0.008, 9.1)));
  L.h = 0.4 + 0.3 * roll + 0.35 * ridge * ridge * ridge;
  float rv = abs(fbm2(q * 0.006 + 4.0));
  L.water = smoothstep(0.03, 0.018, rv);
  L.shore = smoothstep(0.05, 0.03, rv) * (1.0 - L.water);
  L.rock = smoothstep(0.72, 0.85, L.h);
  L.forest = smoothstep(0.05, 0.3, fbm2(q * 0.035 + 11.0)) * (1.0 - L.water) * (1.0 - L.rock);
  // Clustered cities: districts from a slow noise; cores where it peaks.
  float region = snoise(vec3(q * 0.0055, 2.3));
  L.city = smoothstep(0.35, 0.5, region) * (1.0 - L.water) * (1.0 - L.rock);
  L.cityCore = smoothstep(0.5, 0.8, region);
  L.forest *= 1.0 - L.city;
  return L;
}

// Buildings: a grid of plots (period BP) in the city mask; each plot holds a
// tower whose footprint and height come from its hash (taller in the cores).
// Uses a cheap mask (two noise taps) since it runs inside the march loop.
const float BP = 1.6;
float buildingH(vec2 cell) {
  vec2 c = (cell + 0.5) * BP;
  float region = snoise(vec3(c * 0.0055, 2.3));
  if (region < 0.42) return 0.0;
  if (abs(snoise(vec3(c * 0.006 + 4.0, 0.0))) < 0.06) return 0.0;   // keep rivers clear
  vec2 hh = cellHash(cell * 1.31 + 7.0);
  if (hh.x < 0.18) return 0.0;                      // some empty plots (squares, parks)
  float core = smoothstep(0.5, 0.8, region);
  float h = 0.35 + hh.y * (0.9 + 2.6 * core) * (0.7 + 0.6 * hh.x);
  // Occasional skyscrapers, mostly near the cores, so towers stand out on the curve.
  if (cellHash(cell * 3.7 + 1.0).x > 0.93 - 0.12 * core) h = 2.8 + 2.6 * hh.y * (0.5 + 0.5 * core);
  return h;
}

// Cheap terrain height for slope shading.
float heightAt(vec2 q) {
  float roll = snoise(vec3(q * 0.02, 0.0)) * 0.5 + snoise(vec3(q * 0.041 + 1.3, 3.7)) * 0.25;
  float ridge = 1.0 - abs(snoise(vec3(q * 0.008, 9.1)));
  return 0.4 + 0.3 * roll + 0.35 * ridge * ridge * ridge;
}

// Signed distance to the buildings in unrolled space p = (around, up, along).
float sdBuildings(vec3 p, out vec3 info) {
  vec2 cell = floor(p.xz / BP);
  float d = 1e9;
  info = vec3(0.0);
  for (int j = 0; j <= 1; j++) for (int i = 0; i <= 1; i++) {
    vec2 c = cell + vec2(i, j) - vec2(step(fract(p.x / BP), 0.5), step(fract(p.z / BP), 0.5));
    float h = buildingH(c);
    if (h <= 0.0) continue;
    vec2 hh = cellHash(c * 2.7 + 3.0);
    vec2 halfSz = vec2(0.28 + 0.16 * hh.x, 0.28 + 0.16 * hh.y) * BP;
    vec2 ctr = (c + 0.5) * BP;
    vec3 q = vec3(p.x - ctr.x, p.y - h * 0.5, p.z - ctr.y);
    vec3 b = vec3(halfSz.x, h * 0.5, halfSz.y);
    vec3 dq = abs(q) - b;
    float db = length(max(dq, 0.0)) + min(max(dq.x, max(dq.y, dq.z)), 0.0);
    if (db < d) { d = db; info = vec3(h, hh.x, hh.y); }
  }
  return d;
}

// Surface colour of the ground at q with footprint fp (world units per pixel).
vec3 groundColour(vec2 q, Land L, float fp, out float waterOut) {
  // Detail fades out as a pixel covers more ground (no shimmer far away).
  float d1 = 1.0 - smoothstep(0.08, 0.35, fp);
  float d2 = 1.0 - smoothstep(0.25, 1.2, fp);
  // Fields: rectangular plots aligned with the cylinder, varied sizes.
  // Strips along the cylinder; each strip has its own field width and offset,
  // so plots never line up into a checkerboard.
  float stripW = 2.6;
  float strip = floor(q.y / stripW);
  vec2 sh = cellHash(vec2(strip, 17.0));
  vec2 fsz = vec2(2.4 + 3.2 * sh.x, stripW);
  vec2 qq = vec2(q.x + sh.y * 7.0, q.y);
  vec2 fc = floor(qq / fsz);
  vec2 fh = cellHash(fc + vec2(0.0, strip * 3.1));
  vec2 local = fract(qq / fsz);
  float hedge = smoothstep(0.0, 0.035, min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y)));
  vec3 crops[5] = vec3[5](vec3(0.3, 0.42, 0.16), vec3(0.36, 0.46, 0.18), vec3(0.52, 0.5, 0.24), vec3(0.4, 0.35, 0.21), vec3(0.26, 0.38, 0.15));
  vec3 field = crops[int(fh.x * 4.99)] * (0.92 + 0.16 * fh.y);
  float rows = 0.5 + 0.5 * sin((fh.y > 0.5 ? local.x * fsz.x : local.y * fsz.y) * 22.0);
  field *= 0.86 + 0.14 * mix(1.0, rows, d1);
  // Grass texture: two octaves of fine noise.
  float g = 0.75 + 0.25 * mix(0.5, vnoise(q * 3.1), d1) + 0.12 * (mix(0.5, vnoise(q * 0.7), d2) - 0.5);
  vec3 col = field * g;
  col = mix(col * 0.55 + vec3(0.04, 0.06, 0.03), col, hedge);        // hedgerows
  // Forests: dark clumps with lit treetops.
  float trees = mix(0.5, vnoise(q * 4.3), d1);
  vec3 forest = vec3(0.07, 0.16, 0.07) * (0.7 + 0.6 * trees) + vec3(0.1, 0.16, 0.05) * smoothstep(0.7, 0.9, trees) * d1;
  col = mix(col, forest, L.forest);
  // Rock and snow on high ridges.
  vec3 rock = vec3(0.42, 0.4, 0.37) * (0.8 + 0.3 * mix(0.5, vnoise(q * 2.0 + 9.0), d2));
  col = mix(col, rock, L.rock);
  col = mix(col, vec3(0.86, 0.88, 0.9), smoothstep(0.88, 0.95, L.h) * L.rock);
  // Shores, city ground, water.
  col = mix(col, vec3(0.72, 0.66, 0.5), L.shore);
  col = mix(col, vec3(0.32, 0.31, 0.3) * (0.85 + 0.15 * vnoise(q * 1.7)), L.city * 0.85);
  // A light palette tint keeps it of a piece with the rest of Sonora.
  col = mix(col, col * (0.6 + 0.8 * u_c0), 0.18);
  waterOut = L.water;
  return col;
}

// The landscape on the inside of the cylinder, or the hazy axis / sun.
vec3 landscape(vec3 ro, vec3 rd, float pix, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  vec2 o = ro.xy - vec2(0.0, u_land_cy);
  vec2 d = rd.xy;
  float a = dot(d, d);
  if (a < 1e-5) return atm;
  float b = dot(o, d);
  float c0 = dot(o, o) - u_land_r * u_land_r;
  float disc0 = b * b - a * c0;
  if (disc0 < 0.0) return atm;
  float tGround = (-b + sqrt(disc0)) / a;
  // Buildings live in a thin layer above the ground (inner radius R - HMAX).
  const float HMAX = 5.5;
  float rIn = u_land_r - HMAX;
  float c1 = dot(o, o) - rIn * rIn;
  float disc1 = b * b - a * c1;
  float t = tGround;
  bool building = false;
  vec3 binfo = vec3(0.0);
  vec3 bp = vec3(0.0);
  if (disc1 > 0.0) {
    float tl = max((-b + sqrt(disc1)) / a, 0.0);
    float tt = tl;
    for (int i = 0; i < 48; i++) {
      if (tt >= tGround) break;
      vec3 pw = ro + rd * tt;
      vec2 rel = pw.xy - vec2(0.0, u_land_cy);
      vec3 pu = vec3(atan(rel.x, -rel.y) * u_land_r, u_land_r - length(rel), pw.z);
      vec3 inf;
      float dd = sdBuildings(pu, inf);
      if (dd < max(0.004 * tt, 0.01)) { building = true; binfo = inf; bp = pu; t = tt; break; }
      tt += max(dd * 0.8, 0.03);
    }
  }
  vec3 p = ro + rd * t;
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  float ang = atan(rel.x, -rel.y);               // 0 on the floor, ±π overhead
  vec2 q = vec2(ang * u_land_r, p.z);
  vec3 nIn = normalize(vec3(-rel, 0.0));
  vec3 tA = normalize(vec3(-rel.y, rel.x, 0.0));
  float fp = pix * t;
  vec3 col;
  float dif;
  if (building) {
    // Face normal from the SDF (unrolled → world through the local frame).
    vec3 inf;
    float e = 0.01;
    vec3 gu = vec3(sdBuildings(bp + vec3(e, 0, 0), inf) - sdBuildings(bp - vec3(e, 0, 0), inf),
                   sdBuildings(bp + vec3(0, e, 0), inf) - sdBuildings(bp - vec3(0, e, 0), inf),
                   sdBuildings(bp + vec3(0, 0, e), inf) - sdBuildings(bp - vec3(0, 0, e), inf));
    vec3 nu = normalize(gu + vec3(0.0, 1e-6, 0.0));
    vec3 n = normalize(tA * nu.x + nIn * nu.y + vec3(0.0, 0.0, 1.0) * nu.z);
    bool roof = nu.y > 0.7;
    vec3 wall = mix(vec3(0.5, 0.52, 0.55), vec3(0.62, 0.58, 0.5), binfo.y) * (0.8 + 0.25 * binfo.z);
    // Windows on walls: a grid that fades to an average far away.
    float side = abs(nu.x) > abs(nu.z) ? bp.z : bp.x;
    vec2 wg = vec2(side * 7.0, bp.y * 9.0);
    vec2 wf = fract(wg);
    float win = step(0.25, wf.x) * step(wf.x, 0.75) * step(0.3, wf.y) * step(wf.y, 0.8);
    float dW = 1.0 - smoothstep(0.03, 0.12, fp);
    float lit = step(0.55, cellHash(floor(wg) + binfo.yz * 91.0).x);
    vec3 albedo = roof ? vec3(0.28, 0.29, 0.3) : mix(wall, wall * 0.35, mix(0.3, win, dW));
    dif = max(dot(n, u_sun), 0.0);
    col = albedo * (dif * 1.2 + 0.32);
    col += (u_c3 * 0.6 + vec3(0.6, 0.5, 0.3)) * mix(0.12, win * lit, dW) * (roof ? 0.0 : 0.55);
    // Glass catching the sky on sunlit faces.
    col += atmosphere(reflect(rd, n)) * 0.12 * (roof ? 0.0 : 1.0);
  } else {
    Land L = landAt(q);
    float water;
    vec3 albedo = groundColour(q, L, fp, water);
    // Slope shading from the terrain height.
    float e = 0.9;
    float h0 = heightAt(q);
    float hx = heightAt(q + vec2(e, 0.0)) - h0;
    float hz = heightAt(q + vec2(0.0, e)) - h0;
    vec3 n = normalize(nIn - (tA * hx + vec3(0.0, 0.0, 1.0) * hz) * 2.5);
    dif = max(dot(n, u_sun), 0.0);
    col = albedo * (dif * 1.25 + 0.3);
    if (water > 0.01) {
      // Water: deep colour, moving ripples, gentle sky reflection, sun glint.
      vec2 rq = q * 1.4 + vec2(u_time * 0.25, u_time * 0.18);
      vec3 wn = normalize(nIn + (tA * (vnoise(rq) - 0.5) + vec3(0.0, 0.0, 1.0) * (vnoise(rq + 5.0) - 0.5)) * 0.25 * (1.0 - smoothstep(0.1, 0.6, fp)));
      float fres = pow(1.0 - max(dot(wn, -rd), 0.0), 4.0);
      vec3 wcol = vec3(0.04, 0.12, 0.16) + u_c0 * 0.05;
      wcol = mix(wcol, atmosphere(reflect(rd, wn)) * 0.55, 0.25 + 0.6 * fres);
      wcol += u_c3 * pow(max(dot(reflect(rd, wn), u_sun), 0.0), 120.0) * 1.5;
      col = mix(col, wcol, water);
    }
  }
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
    col = landscape(ro, rd, pix, tOut);
  }
  // Edge halo.
  col += mix(u_c2, u_c3, 0.5) * min(glow * 0.006, 0.6) * (0.08 + 0.6 * u_glow + 1.0 * u_pulse) * u_light;
  // Guard: a NaN here would live on in the temporal history.
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  if (isnan(tOut) || isinf(tOut)) tOut = 1000.0;
  frag = vec4(max(col, vec3(0.0)), tOut);
}
