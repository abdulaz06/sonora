#version 300 es
precision highp float;
// Glass › Chrome: a universe of mirror-ball planets. Every planet is an exact
// ray–sphere hit, tiled into disco facets (latitude rows, each tile tilted a
// little at random, dark grout between them). Facets reflect the other
// planets (one bounce, exact) and space: a palette nebula, stars and a few
// coloured suns whose glints sparkle across the tiles. Kicks and collisions
// send rings across a planet's surface: the tiles in the ring tilt and flash.
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_cam_pos;
uniform vec3 u_cam_fwd;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform float u_tan_half;
uniform int u_count;
uniform vec4 u_pl[MAX_PL];       // centre xyz, radius
uniform vec4 u_spin[MAX_PL];     // spin angle (rad), tile rows, tint (0–3), seed
uniform vec4 u_rip[MAX_PL];      // ring origin (unit, planet space), seconds since
uniform vec4 u_rip2[MAX_PL];     // second ring (collisions): origin, seconds since
uniform vec2 u_rip_amp[MAX_PL];  // ring strengths
uniform vec3 u_c0;               // palette slots (primary, secondary, accent, highlight)
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_bg;
uniform vec3 u_sun_dir[3];
uniform vec3 u_sun_col[3];
uniform float u_glint;           // glint strength (highs sparkle)
uniform float u_fog;             // distance fog (1/m)
uniform float u_flash;           // collision flash (flash-guarded)
uniform float u_twinkle;         // share of tiles that twinkle (highs and kicks)
out vec4 frag;

const float PI = 3.14159265;
const float RING_SPEED = 2.2;    // rad/s across the surface
const float RING_W = 0.22;       // ring width (rad)

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec3 hash32(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yzz) * p3.zyx); }

vec3 tint(float i) { return i < 0.5 ? u_c0 : i < 1.5 ? u_c1 : i < 2.5 ? u_c2 : u_c3; }

// Space: nebula in the palette, stars, suns.
vec3 space(vec3 d, bool withSuns) {
  float n = 0.5 + 0.5 * sin(d.x * 3.1 + sin(d.y * 2.3 + u_time * 0.02) * 1.7) * sin(d.z * 2.7 + d.y * 1.3);
  float n2 = 0.5 + 0.5 * sin(d.y * 5.3 + d.x * 2.1 - d.z * 3.7);
  vec3 neb = u_bg * 1.6 + u_c1 * 0.16 * n * n + u_c0 * 0.1 * n2 * n2 * n;
  // Stars on a direction grid.
  vec2 g = vec2(atan(d.z, d.x) * 120.0, d.y * 120.0);
  vec2 cell = floor(g);
  float h = hash12(cell);
  vec2 f = fract(g) - 0.5;
  float star = step(0.985, h) * smoothstep(0.12, 0.0, length(f)) * (0.6 + 0.4 * sin(u_time * 2.0 + h * 40.0));
  neb += vec3(0.9, 0.92, 1.0) * star * 0.8;
  if (withSuns) {
    for (int i = 0; i < 3; i++) {
      float c = max(dot(d, u_sun_dir[i]), 0.0);
      neb += u_sun_col[i] * (pow(c, 600.0) * 6.0 + pow(c, 24.0) * 0.5 + pow(c, 4.0) * 0.06);
    }
  }
  return neb;
}

// Nearest planet hit along a ray (exact).
float hitPlanet(vec3 ro, vec3 rd, int skip, out int id) {
  float best = 1e9; id = -1;
  for (int i = 0; i < MAX_PL; i++) {
    if (i >= u_count) break;
    if (i == skip) continue;
    vec3 oc = ro - u_pl[i].xyz;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - u_pl[i].w * u_pl[i].w;
    float disc = b * b - c;
    if (disc < 0.0) continue;
    float t = -b - sqrt(disc);
    if (t > 1e-3 && t < best) { best = t; id = i; }
  }
  return best;
}

// A facet's normal, its tile id and how far into the tile (for grout), plus the ring glow there.
vec3 facet(int i, vec3 n, out float grout, out float ringGlow, out float tileH) {
  vec4 sp = u_spin[i];
  // Planet space: spin about the planet's vertical.
  float ca = cos(sp.x), sa = sin(sp.x);
  vec3 q = vec3(ca * n.x - sa * n.z, n.y, sa * n.x + ca * n.z);
  float rows = sp.y;
  float lat = acos(clamp(q.y, -1.0, 1.0));          // 0..PI
  float row = floor(lat / PI * rows);
  float latC = (row + 0.5) / rows * PI;
  float cols = max(4.0, floor(rows * 2.0 * sin(latC) + 0.5));
  float lon = atan(q.z, q.x) + PI;                    // 0..2PI
  float col = floor(lon / (2.0 * PI) * cols);
  float lonC = (col + 0.5) / cols * 2.0 * PI;
  vec2 fr = vec2(fract(lat / PI * rows), fract(lon / (2.0 * PI) * cols));
  grout = min(min(fr.x, 1.0 - fr.x) * 2.0, min(fr.y, 1.0 - fr.y) * 2.0 * sin(latC) + 0.0);
  vec3 tq = vec3(sin(latC) * cos(lonC - PI), cos(latC), sin(latC) * sin(lonC - PI));
  // Tiles are set a little crooked (the shimmer of a real disco ball).
  vec3 jit = hash32(vec2(row + sp.w * 13.0, col)) - 0.5;
  tileH = jit.x + 0.5;
  tq = normalize(tq + jit * 0.13);
  // Rings: tiles inside a travelling ring tilt outward-forward and flash.
  ringGlow = 0.0;
  for (int k = 0; k < 2; k++) {
    vec4 rp = k == 0 ? u_rip[i] : u_rip2[i];
    float amp = k == 0 ? u_rip_amp[i].x : u_rip_amp[i].y;
    if (amp <= 0.0) continue;
    float th = acos(clamp(dot(tq, rp.xyz), -1.0, 1.0));
    float front = rp.w * RING_SPEED;
    float w = exp(-pow((th - front) / RING_W, 2.0)) * amp * exp(-rp.w * 0.9);
    vec3 tang = normalize(tq - rp.xyz * dot(tq, rp.xyz) + 1e-4);
    tq = normalize(tq + tang * w * 0.45);
    ringGlow += w;
  }
  // Back to world space.
  return vec3(ca * tq.x + sa * tq.z, tq.y, -sa * tq.x + ca * tq.z);
}

vec3 shadePlanet(int i, vec3 p, vec3 rd, bool bounce) {
  vec3 n = normalize(p - u_pl[i].xyz);
  float grout, ringGlow, tileH;
  vec3 fn = facet(i, n, grout, ringGlow, tileH);
  vec3 r = reflect(rd, fn);
  vec3 col;
  vec3 tc = tint(u_spin[i].z);
  vec3 env;
  if (bounce) {
    int j;
    float t = hitPlanet(p + n * 1e-3, r, i, j);
    if (j >= 0) {
      vec3 p2 = p + r * t;
      vec3 n2 = normalize(p2 - u_pl[j].xyz);
      float g2, rg2, th2;
      vec3 f2 = facet(j, n2, g2, rg2, th2);
      vec3 r2 = reflect(r, f2);
      env = space(r2, true) * mix(vec3(1.0), tint(u_spin[j].z), 0.55) * 0.8 * smoothstep(0.0, 0.25, g2) + tint(u_spin[j].z) * rg2 * 0.8;
      env = mix(env, space(r, false), 1.0 - exp(-t * u_fog));
    } else env = space(r, true);
  } else env = space(r, true);
  // Mirror tiles take a little of the planet's tint; grout is dark.
  col = env * mix(vec3(1.0), tc, 0.35) * 0.92;
  // Hard glints where a tile throws a sun straight back.
  // Each tile is a flat mirror: it shows one light where it faces it (wide), a hard glint at its centre.
  for (int s = 0; s < 3; s++) {
    float c = max(dot(r, u_sun_dir[s]), 0.0);
    col += u_sun_col[s] * (pow(c, 160.0) * (2.0 + 3.0 * u_glint) + pow(c, 18.0) * 0.35);
  }
  col += tc * ringGlow * 1.5 + mix(tc, vec3(1.0), 0.4) * ringGlow * ringGlow * 0.6;
  // Twinkle: a few tiles catch a light for a moment (more on highs and kicks), on the side facing us.
  float tw = step(1.0 - u_twinkle, hash12(vec2(tileH * 917.0 + float(i) * 31.0, floor(u_time * 9.0 + tileH * 7.0))));
  col += mix(u_c3, vec3(1.0), 0.55) * tw * 1.6 * smoothstep(0.1, 0.6, dot(-rd, n));
  col *= smoothstep(0.0, 0.22, grout) * 0.92 + 0.08;
  // Rim: a thin line of the tint where the ball turns away.
  col += tc * pow(1.0 - max(dot(-rd, n), 0.0), 4.0) * 0.12;
  return col;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  vec3 rd = normalize(u_cam_fwd + (u_cam_right * ndc.x * aspect + u_cam_up * ndc.y) * u_tan_half);
  vec3 ro = u_cam_pos;
  int id;
  float t = hitPlanet(ro, rd, -1, id);
  vec3 col;
  if (id >= 0) {
    vec3 p = ro + rd * t;
    col = shadePlanet(id, p, rd, BOUNCE == 1);
    col = mix(col, space(rd, false) * 0.9, 1.0 - exp(-t * u_fog));
  } else {
    col = space(rd, true);
  }
  col += vec3(1.0) * u_flash * 0.12;
  frag = vec4(col, 1.0);
}
