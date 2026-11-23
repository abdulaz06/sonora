#version 300 es
precision highp float;
// Glass: raymarched forms in a studio. SCENE 0 bubbles (smooth-union glass
// blobs), 1 fins (a twisted ribbon of tinted glass slats), 2 chrome (a field
// of mirror tubes). Glass: Fresnel, refraction through the body (the green
// path is marched; each channel refracts out with its own index, so edges
// fringe like a prism), absorption, up to BOUNCES internal reflections.
// The studio is analytic: a palette gradient with softboxes (the glints).

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_cam_pos;
uniform vec3 u_cam_fwd;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform float u_tan_half;
uniform int u_steps;
// studio
uniform vec3 u_env_lo;
uniform vec3 u_env_mid;
uniform vec3 u_env_hi;
uniform vec3 u_key;          // softbox colour × intensity
uniform vec3 u_rim;          // rim light colour × intensity
uniform float u_sparkle;     // highs: glints flare
uniform float u_studio;      // kick lift of the studio light (seen through and in the glass only)
uniform float u_dust;        // bubbles: tiny glass beads in the studio (0 = none)
uniform float u_dust_kick;   // their glint on the kick
uniform float u_dust_t;      // their slow drift
// forms
uniform vec4 u_balls[10];
uniform int u_ball_count;
uniform float u_blend_k;
uniform vec4 u_ripple;       // centre xyz, amount
uniform float u_ripple_t;    // seconds since the kick
uniform float u_spin;
uniform float u_twist;
uniform float u_count;       // slats / tubes shown
uniform vec3 u_tint;         // glass tint
uniform float u_wave_t;      // chrome: wave phase
uniform float u_wave_amp;
uniform float u_reform;      // drop: 1 → 0 as the arrangement reforms
out vec4 frag;

const float PI = 3.14159265;

mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
float smin(float a, float b, float k) { float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(b, a, h) - k * h * (1.0 - h); }
float sdBox(vec3 p, vec3 b) { vec3 q = abs(p) - b; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }

float ripple(vec3 p) {
  if (u_ripple.w < 0.001) return 0.0;
  float r = length(p - u_ripple.xyz);
  float front = u_ripple_t * 2.2;
  return u_ripple.w * 0.035 * sin(r * 26.0 - u_ripple_t * 30.0) * exp(-pow((r - front) / 0.35, 2.0)) * exp(-u_ripple_t / 0.5);
}

float map(vec3 p) {
#if SCENE == 0
  float d = 1e3;
  for (int i = 0; i < 10; i++) {
    if (i >= u_ball_count) break;
    d = smin(d, length(p - u_balls[i].xyz) - u_balls[i].w, u_blend_k);
  }
  return d + ripple(p);
#elif SCENE == 1
  // A ribbon of slats along x, each turned a little more than the last (a twist), the ribbon waving.
  float w = 0.11;
  float id = floor(p.x / w + 0.5);
  float d = 1e3;
  for (int k = -1; k <= 1; k++) {
    float i = id + float(k);
    vec3 q = p;   // endless: the camera chases along the ribbon
    q.x -= i * w;
    q.y -= sin(i * 0.22 + u_time * 0.4) * 0.22;
    q.z -= cos(i * 0.17 + u_time * 0.3) * 0.15;
    q.yz = rot(u_twist * i + u_spin) * q.yz;
    float bend = 1.0 + 0.6 * u_reform * sin(i * 1.7);
    d = min(d, sdBox(q, vec3(0.012, 0.42 * bend, 0.16)) - 0.006);
  }
  return d + ripple(p) * 0.5;
#else
  // Chrome tubes on a hex grid, their tops riding a travelling wave.
  vec2 s = vec2(1.0, 1.7320508);
  float sc = 0.16;
  vec2 q = p.xz / sc;
  vec2 a = mod(q, s) - s * 0.5, b = mod(q - s * 0.5, s) - s * 0.5;
  vec2 g = dot(a, a) < dot(b, b) ? a : b;
  vec2 cell = q - g;
  float r = length(cell * sc);
  // The field sinks away past its radius (no edge, no platter).
  float sink = smoothstep(u_count * 0.16, u_count * 0.16 + 0.8, r) * 0.9;
  float h = 0.25 - sink + u_wave_amp * sin(r * 6.0 - u_wave_t) * 0.18 + 0.06 * sin(cell.x * 1.3 + cell.y * 0.7 + u_time * 0.5) + ripple(vec3(cell.x * sc, 0.0, cell.y * sc)) * 4.0;
  float tube = length(g * sc) - sc * 0.42;
  float body = max(tube, p.y - h);
  // hollow tube ends: a shallow bore
  body = max(body, -max(length(g * sc) - sc * 0.3, p.y - (h - 0.06)) + 0.0);
  return max(body, -p.y - 0.6) * 0.8;
#endif
}

vec3 normal(vec3 p) {
  vec2 e = vec2(0.0015, 0.0);
  return normalize(vec3(map(p + e.xyy) - map(p - e.xyy), map(p + e.yxy) - map(p - e.yxy), map(p + e.yyx) - map(p - e.yyx)));
}

// The studio: a soft palette gradient, a key softbox above-left, a rim light behind.
// Tiny glass beads and soft bokeh scattered around the studio (directions on a sphere, so the
// bubbles refract and reflect them too). Kicks make them glint; they drift slowly.
vec3 dust(vec3 d) {
  if (u_dust <= 0.0) return vec3(0.0);
  vec3 acc = vec3(0.0);
  for (int layer = 0; layer < 2; layer++) {
    float sc = layer == 0 ? 26.0 : 11.0;
    float lon = atan(d.z, d.x) + u_dust_t * (layer == 0 ? 0.02 : 0.035);
    vec2 g = vec2(lon * sc, (d.y + 0.03 * sin(u_dust_t * 0.3 + lon * 3.0)) * sc);
    vec2 cell = floor(g);
    vec2 f = fract(g) - 0.5;
    float h = fract(sin(dot(cell + float(layer) * 17.0, vec2(127.1, 311.7))) * 43758.5453);
    if (h < (layer == 0 ? 0.7 : 0.86)) continue;
    vec2 o = vec2(fract(h * 13.7), fract(h * 71.3)) - 0.5;
    float r = layer == 0 ? 0.06 + 0.06 * fract(h * 5.1) : 0.16 + 0.14 * fract(h * 3.3);
    float dd = length(f - o * 0.6);
    // Near beads are crisp rings of light (a lens), far ones soft discs (bokeh).
    float bead = layer == 0 ? smoothstep(r, r * 0.4, dd) * (0.35 + 0.65 * smoothstep(r * 0.35, r * 0.85, dd)) : smoothstep(r, r * 0.2, dd) * 0.35;
    vec3 c = fract(h * 29.0) < 0.5 ? u_rim : u_key * 0.35;
    acc += c * bead * (0.5 + 1.6 * u_dust_kick * fract(h * 41.0));
  }
  return acc * u_dust;
}

vec3 env(vec3 d) {
  float y = d.y;
  vec3 c = mix(u_env_lo, u_env_mid, smoothstep(-0.6, 0.15, y));
  c = mix(c, u_env_hi, smoothstep(0.15, 0.95, y));
  vec3 kd = normalize(vec3(-0.55, 0.65, 0.5));
  float key = smoothstep(0.93, 0.975, dot(d, kd));
  vec3 bd = normalize(vec3(0.6, 0.25, -0.75));
  float rim = smoothstep(0.85, 0.95, dot(d, bd));
  // a long strip light for chrome streaks
  float strip = smoothstep(0.035, 0.0, abs(d.y - 0.55)) * smoothstep(0.2, 0.6, d.x + 0.4);
  return c + u_key * key * (1.0 + 2.0 * u_sparkle) + u_rim * rim + u_key * strip * 0.35 + dust(d);
}

float march(vec3 ro, vec3 rd, float tmax, float sgn) {
  float t = 0.0;
  for (int i = 0; i < 160; i++) {
    if (i >= u_steps) break;
    float d = map(ro + rd * t) * sgn;
    if (d < 0.0008 * (1.0 + t)) return t;
    t += max(d, 0.002);
    if (t > tmax) break;
  }
  return -1.0;
}

void main() {
  vec2 ndc = gl_FragCoord.xy / u_res * 2.0 - 1.0;
  float aspect = u_res.x / u_res.y;
  vec3 rd = normalize(u_cam_fwd + (u_cam_right * ndc.x * aspect + u_cam_up * ndc.y) * u_tan_half);
  vec3 ro = u_cam_pos;
  // Background: the studio's gradient only (softboxes show in reflections, not as discs behind).
  float y = rd.y;
  vec3 bg = mix(u_env_lo, u_env_mid, smoothstep(-0.6, 0.15, y));
  bg = mix(bg, u_env_hi, smoothstep(0.15, 0.95, y)) * 0.55 + u_env_lo * 0.25;
  // The backdrop seen directly never pulses: kicks light the glass (refraction, reflections), not the wall.
  bg /= u_studio;
  bg += dust(rd);
  bg += u_rim * 0.05 * exp(-pow(length(ndc * vec2(aspect * 0.5, 1.0)) * 1.2, 2.0));
  float t = march(ro, rd, 12.0, 1.0);
  vec3 col = bg;
  if (t > 0.0) {
    vec3 p = ro + rd * t;
    vec3 n = normal(p);
    float cosi = max(dot(-rd, n), 0.0);
#if SCENE == 2
    // Chrome: a tinted mirror with a touch of roughness from the wave.
    float fres = 0.65 + 0.35 * pow(1.0 - cosi, 5.0);
    vec3 r = reflect(rd, n);
    vec3 refl = env(r);
    // one more bounce between tubes
    float t2 = march(p + n * 0.004, r, 2.0, 1.0);
    if (t2 > 0.0) { vec3 p2 = p + r * t2; vec3 n2 = normal(p2); refl = env(reflect(r, n2)) * mix(vec3(0.9), u_tint, 0.4) * 0.8; }
    col = refl * mix(vec3(0.95), u_tint, 0.35) * fres;
#else
    float F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
    vec3 refl = env(reflect(rd, n));
    // Refraction: march the green path through the body, refract out per channel.
    const vec3 IOR = vec3(1.47, 1.5, 1.535);
    vec3 dirIn = refract(rd, n, 1.0 / IOR.g);
    vec3 q = p - n * 0.004;
    vec3 trans = vec3(0.0);
    vec3 throughput = vec3(1.0);
    float path = 0.0;
    for (int b = 0; b <= BOUNCES; b++) {
      float tin = march(q, dirIn, 3.0, -1.0);
      if (tin < 0.0) { trans += throughput * env(dirIn); break; }
      vec3 pe = q + dirIn * tin;
      path += tin;
      vec3 ne = -normal(pe);
      vec3 outR = refract(dirIn, ne, IOR.r), outG = refract(dirIn, ne, IOR.g), outB = refract(dirIn, ne, IOR.b);
      // Beer: tinted glass absorbs along the path.
      vec3 absorb = exp(-(1.0 - u_tint) * path * 2.2);
      if (dot(outG, outG) > 0.0) {
        vec3 e = vec3(env(outR).r, env(outG).g, env(outB).b);
        float Fo = 0.04 + 0.96 * pow(1.0 - max(dot(dirIn, -ne), 0.0), 5.0);
        trans += throughput * absorb * e * (1.0 - Fo);
        throughput *= absorb * Fo;
      } else {
        throughput *= absorb;
      }
      // Internal reflection (bounded).
      dirIn = reflect(dirIn, ne);
      q = pe + ne * 0.004;
    }
    // Light still inside after the last bounce leaves the way it's heading (no black pockets).
    trans += throughput * env(dirIn) * 0.85;
    col = mix(trans, refl, F);
    // a caustic-like inner glow where the body is thin
    col += u_rim * 0.08 * exp(-path * 6.0);
#endif
#if SCENE == 1
    // The endless ribbon fades into the studio with distance (thin far slats would alias).
    col = mix(col, bg, smoothstep(5.5, 11.5, t));
#endif
  }
  frag = vec4(col, 1.0);
}
