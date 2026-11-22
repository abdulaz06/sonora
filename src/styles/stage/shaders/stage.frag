#version 300 es
precision highp float;
// Stage: a concert lighting rig in a hazy venue. Everything is analytic per
// pixel: no marching. Moving-head beams are integrated in closed form along
// the view ray (closest approach to the beam axis, Gaussian profile widening
// with distance, forward-scattering phase); laser fans and scanning sheets
// are planes the ray crosses once; the laser tunnel is a hollow cone. The
// floor is wet: it shows gobo spots and reflects the rig (blurred by widening
// the beams). LED bars and fixture lenses glow; crowd silhouettes sit in the
// foreground haze in the crowd shots.

uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_cam_pos;
uniform vec3 u_cam_fwd;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform float u_tan_half;      // tan(vertical fov / 2)
uniform vec4 u_room;           // half width, height, back z, front z
uniform float u_px;            // radians per pixel

#define MAX_BEAMS 18
uniform int u_beam_count;
uniform vec4 u_beam_pos[MAX_BEAMS];   // source xyz, source radius
uniform vec4 u_beam_dir[MAX_BEAMS];   // direction xyz (unit), tan(half angle)
uniform vec4 u_beam_col[MAX_BEAMS];   // rgb × intensity, gobo (0 none, 1 dots, 2 rays, 3 rings)
uniform vec4 u_beam_ext[MAX_BEAMS];   // length (m), forward-scatter g, lens glow, -

#define MAX_FANS 8
uniform int u_fan_count;
uniform vec4 u_fan_pos[MAX_FANS];     // source xyz, reach (m)
uniform vec4 u_fan_dir[MAX_FANS];     // centre direction xyz, half span (rad)
uniform vec4 u_fan_nrm[MAX_FANS];     // plane normal xyz, beam count (0 = continuous sheet)
uniform vec4 u_fan_col[MAX_FANS];     // rgb × intensity, line width (rad)

uniform vec4 u_cone_pos;              // laser tunnel: apex xyz, cos(half angle)
uniform vec4 u_cone_dir;              // axis xyz, beam count
uniform vec4 u_cone_col;              // rgb × intensity, spin (rad)

#define MAX_BARS 8
uniform int u_bar_count;
uniform vec4 u_bar_a[MAX_BARS];       // start xyz, pixel count
uniform vec4 u_bar_b[MAX_BARS];       // end xyz, chase phase
uniform vec4 u_bar_col[MAX_BARS];     // rgb × intensity, sparkle

uniform float u_haze;          // scattering density multiplier
uniform vec3 u_haze_amb;       // ambient haze light (rgb × level): bass pulses it
uniform float u_strobe;        // white blast 0..1 (flash-guarded)
uniform float u_crowd;         // crowd silhouettes 0..1
uniform float u_crowd_bob;     // beat bob 0..1
uniform float u_reflect;       // wet floor reflection (0 = off: Low)
uniform vec3 u_rim;            // silhouette rim light colour
uniform vec3 u_floor_col;
uniform vec4 u_curtain;        // curtain wall: rgb × intensity, z of the wall
uniform vec3 u_curtain2;       // second curtain colour (arch bands)
uniform float u_glitter;       // chandelier glitter at the curtain's top (0..1)
uniform vec3 u_glitter_pos;
uniform vec3 u_glitter_col;
out vec4 frag;

const float PI = 3.14159265;

float hash12(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }

float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1, 0, 0)), n010 = hash13(i + vec3(0, 1, 0)), n110 = hash13(i + vec3(1, 1, 0));
  float n001 = hash13(i + vec3(0, 0, 1)), n101 = hash13(i + vec3(1, 0, 1)), n011 = hash13(i + vec3(0, 1, 1)), n111 = hash13(i + vec3(1, 1, 1));
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}

// Henyey-Greenstein, scaled so side-on (90°) ≈ 1.
float phase(float c, float g) {
  float g2 = g * g;
  float hg = (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5);
  float side = (1.0 - g2) / pow(1.0 + g2, 1.5);
  return hg / side;
}

// Distance to the first room surface and which one (0 floor, 1 back wall, 2 other).
float roomHit(vec3 ro, vec3 rd, out int surf) {
  float t = 1e4; surf = 2;
  if (rd.y < -1e-5) { float tf = -ro.y / rd.y; if (tf < t) { t = tf; surf = 0; } }
  if (rd.y > 1e-5) { float tc = (u_room.y - ro.y) / rd.y; if (tc < t) { t = tc; surf = 2; } }
  if (abs(rd.x) > 1e-5) { float tw = ((rd.x > 0.0 ? u_room.x : -u_room.x) - ro.x) / rd.x; if (tw < t) { t = tw; surf = 2; } }
  if (rd.z < -1e-5) { float tb = (u_room.z - ro.z) / rd.z; if (tb < t) { t = tb; surf = 1; } }
  if (rd.z > 1e-5) { float tfr = (u_room.w - ro.z) / rd.z; if (tfr < t) { t = tfr; surf = 2; } }
  return t;
}

// In-scattering from the moving-head beams along a ray (wMul > 1 blurs, for reflections).
vec3 beams(vec3 ro, vec3 rd, float tMax, float wMul) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_BEAMS; i++) {
    if (i >= u_beam_count) break;
    vec3 P = u_beam_pos[i].xyz, D = u_beam_dir[i].xyz;
    vec3 w0 = ro - P;
    float b = dot(rd, D), dd = dot(rd, w0), e = dot(D, w0);
    float den = max(1.0 - b * b, 1e-5);
    float t = clamp((b * e - dd) / den, 0.0, tMax);
    vec3 X = ro + rd * t;
    float s = dot(X - P, D);
    float len = u_beam_ext[i].x;
    if (s < 0.0 || s > len * 1.05) continue;
    float dist = length(X - (P + D * s));
    float width = (u_beam_pos[i].w + s * u_beam_dir[i].w) * wMul;
    float wEff = max(width, t * u_px * 0.8);
    // Soft core plus a wider scattering skirt (beams in haze are soft-edged cones).
    float prof = exp(-dist * dist / (wEff * wEff)) + 0.12 * exp(-dist * dist / (6.25 * wEff * wEff)) / 2.5;
    // Line density ∝ 1/width, softened near the lens (a narrow source would spike into a glowing rod).
    float wl = 0.04 * u_room.y;
    float k = prof * 1.7725 * (1.0 + wl * 4.0) / ((wEff + wl) * max(sqrt(den), 0.07)) * (width / wEff);
    k *= smoothstep(len, len * 0.94, s) * smoothstep(0.0, 0.25, s);
    // Falls off along the beam (scaled to the room: long beams in the arena).
    float fs = s / (0.55 * u_room.y);
    k *= 1.0 / (1.0 + fs * fs);
    k *= phase(-b, u_beam_ext[i].y);
    acc += u_beam_col[i].rgb * k;
  }
  return acc;
}

// Laser fans (count > 0: discrete beams) and scanning sheets (count 0).
vec3 fans(vec3 ro, vec3 rd, float tMax) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_FANS; i++) {
    if (i >= u_fan_count) break;
    vec3 P = u_fan_pos[i].xyz, C = u_fan_dir[i].xyz, N = u_fan_nrm[i].xyz;
    float dn = dot(rd, N);
    if (abs(dn) < 1e-5) continue;
    float t = dot(P - ro, N) / dn;
    if (t < 0.0 || t > tMax) continue;
    vec3 X = ro + rd * t - P;
    float r = length(X);
    float reach = u_fan_pos[i].w;
    if (r > reach || r < 0.05) continue;
    vec3 B = cross(N, C);
    float ang = atan(dot(X, B), dot(X, C));
    float span = u_fan_dir[i].w;
    float m = smoothstep(span + 0.01, span - 0.01, abs(ang));
    if (m <= 0.0) continue;
    float count = u_fan_nrm[i].w;
    float lw = u_fan_col[i].w;
    float lines;
    if (count < 0.5) {
      lines = 0.5;
    } else {
      float step_ = 2.0 * span / max(count - 1.0, 1.0);
      float k = (ang + span) / step_;
      float dAng = abs(fract(k + 0.5) - 0.5) * step_;
      float angW = max(lw, t * u_px * 0.8 / r);
      lines = exp(-dAng * dAng / (angW * angW)) * (lw / angW);
    }
    float bright = lines * m / max(abs(dn), count < 0.5 ? 0.2 : 0.08);
    bright *= smoothstep(reach, reach * 0.7, r) / (1.0 + r * r * 0.0015);
    bright *= phase(dot(-rd, X / r), 0.5);
    acc += u_fan_col[i].rgb * bright * 0.06;
  }
  return acc;
}

// Laser tunnel: beams on a hollow cone around an axis (the ray crosses it at most twice).
vec3 cone(vec3 ro, vec3 rd, float tMax) {
  if (u_cone_col.r + u_cone_col.g + u_cone_col.b < 1e-4) return vec3(0.0);
  vec3 A = u_cone_pos.xyz, V = u_cone_dir.xyz;
  float c2 = u_cone_pos.w * u_cone_pos.w;
  vec3 co = ro - A;
  float dv = dot(rd, V), cv = dot(co, V);
  float a = dv * dv - c2, b = 2.0 * (dv * cv - dot(rd, co) * c2), c = cv * cv - dot(co, co) * c2;
  float disc = b * b - 4.0 * a * c;
  if (disc < 0.0 || abs(a) < 1e-6) return vec3(0.0);
  float sq = sqrt(disc);
  vec3 acc = vec3(0.0);
  vec3 U = normalize(abs(V.y) < 0.9 ? cross(V, vec3(0, 1, 0)) : cross(V, vec3(1, 0, 0)));
  vec3 W = cross(V, U);
  for (int k = 0; k < 2; k++) {
    float t = (-b + (k == 0 ? -sq : sq)) / (2.0 * a);
    if (t < 0.0 || t > tMax) continue;
    vec3 X = co + rd * t;
    float h = dot(X, V);
    if (h < 0.0 || h > 60.0) continue;
    float ang = atan(dot(X, W), dot(X, U)) + u_cone_col.w;
    float count = u_cone_dir.w;
    float step_ = 2.0 * PI / count;
    float dAng = abs(fract(ang / step_ + 0.5) - 0.5) * step_;
    float rad = h * sqrt(max(1.0 - c2, 0.0)) / max(u_cone_pos.w, 0.05);
    float angW = max(0.004, t * u_px * 0.8 / max(rad, 0.05));
    float lines = exp(-dAng * dAng / (angW * angW)) * (0.004 / angW);
    vec3 n = normalize(X - V * h * (1.0 + (1.0 - c2) / c2));
    float bright = lines / max(abs(dot(rd, n)), 0.1) * smoothstep(60.0, 30.0, h) / (1.0 + h * h * 0.002);
    acc += u_cone_col.rgb * bright * 0.05;
  }
  return acc;
}

// LED bars: rows of pixels with a chase pattern and hat sparkle; core + soft halo.
vec3 bars(vec3 ro, vec3 rd, float tMax, float halo) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_BARS; i++) {
    if (i >= u_bar_count) break;
    vec3 A = u_bar_a[i].xyz, Bp = u_bar_b[i].xyz;
    vec3 ab = Bp - A;
    float L = length(ab);
    vec3 D = ab / L;
    vec3 w0 = ro - A;
    float b = dot(rd, D), dd = dot(rd, w0), e = dot(D, w0);
    float den = max(1.0 - b * b, 1e-5);
    float t = (b * e - dd) / den;
    float s = clamp((e - b * dd) / den, 0.0, L);
    t = max(dot(A + D * s - ro, rd), 0.0);
    if (t > tMax + 0.5) continue;
    float dist = length(ro + rd * t - (A + D * s));
    float n = u_bar_a[i].w;
    float u = s / L;
    float pix = floor(u * n);
    float chase = 0.55 + 0.45 * cos(6.2832 * (pix / n * 2.0 - u_bar_b[i].w));
    float spark = step(1.0 - u_bar_col[i].w * 0.35, hash12(vec2(pix, floor(u_time * 14.0) + float(i) * 17.0)));
    float gap = smoothstep(0.5, 0.36, abs(fract(u * n) - 0.5));
    float rc = max(0.035, t * u_px * 0.9);
    // Pixel gaps show once a pixel is a few screen pixels long.
    float pixOnScreen = (L / n) / max(t * u_px, 1e-5);
    float core = exp(-dist * dist / (rc * rc)) * (0.035 / rc) * mix(1.0, gap, smoothstep(2.0, 6.0, pixOnScreen));
    float glow = exp(-dist / 0.6) * 0.03 * halo;
    acc += u_bar_col[i].rgb * (core * (chase + 2.5 * spark) + glow * chase);
  }
  return acc;
}

// Gobo patterns in the beam's own frame (u: -1..1 across the cone).
float gobo(vec2 u, float id) {
  float r = length(u);
  float a = atan(u.y, u.x);
  float disk = smoothstep(1.0, 0.92, r);
  if (id < 0.5) return disk * (0.7 + 0.3 * smoothstep(1.0, 0.3, r));
  if (id < 1.5) {
    // ring of dots and a centre dot
    float da = (fract(a / (2.0 * PI) * 8.0) - 0.5) * (2.0 * PI / 8.0);
    float dots = smoothstep(0.17, 0.12, length(vec2(r * cos(da), r * sin(da)) - vec2(0.62, 0.0)));
    return disk * max(dots, smoothstep(0.16, 0.1, r));
  }
  if (id < 2.5) {
    // rays
    float rays = smoothstep(0.35, 0.15, abs(fract(a / (2.0 * PI) * 10.0) - 0.5) * 2.0);
    return disk * rays * smoothstep(0.08, 0.2, r) + disk * smoothstep(0.12, 0.05, r);
  }
  float rings = smoothstep(0.25, 0.05, abs(fract(r * 3.5) - 0.5) * 2.0);
  return disk * rings;
}

// Light from the beams landing on a surface point (gobo spots).
vec3 spots(vec3 X, vec3 nrm) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_BEAMS; i++) {
    if (i >= u_beam_count) break;
    vec3 P = u_beam_pos[i].xyz, D = u_beam_dir[i].xyz;
    vec3 q = X - P;
    float s = dot(q, D);
    if (s < 0.2 || s > u_beam_ext[i].x * 1.02) continue;
    float rad = u_beam_pos[i].w + s * u_beam_dir[i].w;
    vec3 radial = q - D * s;
    vec3 Ub = normalize(abs(D.y) < 0.9 ? cross(D, vec3(0, 1, 0)) : cross(D, vec3(1, 0, 0)));
    vec3 Vb = cross(D, Ub);
    vec2 u = vec2(dot(radial, Ub), dot(radial, Vb)) / rad;
    if (dot(u, u) > 1.2) continue;
    float lit = gobo(u, u_beam_col[i].w) * max(dot(nrm, -D), 0.0) / (1.0 + s * s * 0.004) / (rad * rad + 0.02);
    acc += u_beam_col[i].rgb * lit * 0.08;
  }
  return acc;
}

// Lens glows of the fixtures (bright when they face the camera).
vec3 lenses(vec3 ro, vec3 rd, float tMax) {
  vec3 acc = vec3(0.0);
  for (int i = 0; i < MAX_BEAMS; i++) {
    if (i >= u_beam_count) break;
    vec3 P = u_beam_pos[i].xyz;
    float t = dot(P - ro, rd);
    if (t < 0.1 || t > tMax + 0.5) continue;
    float d = length(ro + rd * t - P);
    float r = max(u_beam_pos[i].w * 1.2, t * u_px * 1.2);
    float facing = pow(max(dot(-rd, u_beam_dir[i].xyz), 0.0), 6.0);
    acc += u_beam_col[i].rgb * u_beam_ext[i].z * (exp(-d * d / (r * r)) * (u_beam_pos[i].w / r) * (0.2 + 1.8 * facing) + exp(-d / (r * 6.0)) * 0.012 * facing);
  }
  return acc;
}

// Crowd: two rows of heads, shoulders and some raised arms, in screen space.
float crowdMask(vec2 uv, float aspect, out float rim) {
  float m = 0.0; rim = 0.0;
  for (int row = 0; row < 2; row++) {
    float fr = float(row);
    float size = mix(0.055, 0.085, fr);
    float base = mix(0.17, 0.08, fr);
    float x = uv.x * aspect / (size * 1.5);
    float cell = floor(x);
    for (int j = -1; j <= 1; j++) {
      float c = cell + float(j);
      float h1 = hash12(vec2(c, fr * 7.0)), h2 = hash12(vec2(c, fr * 7.0 + 3.0)), h3 = hash12(vec2(c + 11.0, fr));
      float bob = u_crowd_bob * (0.4 + 0.6 * h3) * size * 0.25;
      vec2 head = vec2((c + 0.3 + 0.4 * h1) * size * 1.5 / aspect, base + h2 * size * 0.5 + bob);
      vec2 d = (uv - head) * vec2(aspect, 1.0);
      float hr = size * (0.42 + 0.1 * h3);
      float hd = length(d * vec2(1.0, 0.85)) - hr;
      // shoulders: a wide rounded box under the head
      vec2 sd = d - vec2(0.0, -hr * 2.1);
      float sh = length(max(abs(sd) - vec2(hr * 1.5, hr * 1.2), 0.0)) - hr * 0.5;
      float body = min(hd, sh);
      // a raised arm on some
      if (h1 > 0.62) {
        float side = h2 > 0.5 ? 1.0 : -1.0;
        vec2 a0 = vec2(side * hr * 1.3, -hr * 1.2), a1 = a0 + vec2(side * hr * (0.6 + h3), hr * (3.2 + 1.5 * h2) + bob * 2.0);
        vec2 pa = d - a0, ba = a1 - a0;
        float hh = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        body = min(body, length(pa - ba * hh) - hr * 0.22);
      }
      float px = 1.5 / u_res.y;
      float mm = smoothstep(px, -px, body);
      m = max(m, mm);
      rim = max(rim, smoothstep(px * 3.0, 0.0, abs(body)) * smoothstep(-0.2, 0.6, d.y / hr));
    }
  }
  float below = smoothstep(0.1, 0.0, uv.y);
  return max(m, below);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rd = normalize(u_cam_fwd + (u_cam_right * ndc.x * aspect + u_cam_up * ndc.y) * u_tan_half);
  vec3 ro = u_cam_pos;

  int surf;
  float tMax = roomHit(ro, rd, surf);

  // Haze texture: slow, world-anchored smoke (one noise sample at a mid distance).
  vec3 hp = ro + rd * min(tMax, 9.0);
  float smoke = vnoise(hp * 0.35 + vec3(0.0, -u_time * 0.08, u_time * 0.05)) * 0.65 + vnoise(hp * 1.1 + vec3(u_time * 0.1, 0.0, 0.0)) * 0.35;
  float density = u_haze * (0.2 + 1.6 * smoke * smoke);

  vec3 col = vec3(0.0);
  // Surfaces.
  vec3 X = ro + rd * tMax;
  float trans = exp(-tMax * 0.012 * u_haze);
  if (surf == 0) {
    vec3 lit = spots(X, vec3(0.0, 1.0, 0.0));
    vec3 floorCol = u_floor_col + lit;
    // Wet floor: Fresnel reflection of the rig, blurred by widened beams.
    if (u_reflect > 0.0) {
      vec3 rr = reflect(rd, vec3(0.0, 1.0, 0.0));
      float fres = 0.04 + 0.96 * pow(1.0 - max(-rd.y, 0.0), 5.0);
      int s2;
      float t2 = roomHit(X + rr * 0.01, rr, s2);
      // A little ripple in the wet floor breaks the mirror.
      vec2 rip = vec2(vnoise(vec3(X.xz * 2.5, 1.0)), vnoise(vec3(X.xz * 2.5, 7.0))) - 0.5;
      rr = normalize(rr + vec3(rip.x, 0.0, rip.y) * 0.04);
      vec3 refl = beams(X, rr, t2, 2.2) * density + fans(X, rr, t2) * density + bars(X, rr, t2, 1.0) + lenses(X, rr, t2) * 0.5;
      floorCol += refl * fres * u_reflect;
    }
    col += floorCol * trans;
  } else {
    col += (u_floor_col * 0.5 + spots(X, surf == 1 ? vec3(0, 0, 1) : -rd) * 0.6) * trans;
  }

  // Air: beams, lasers, tunnel, ambient haze.
  col += beams(ro, rd, tMax, 1.0) * density;
  col += fans(ro, rd, tMax) * density;
  col += cone(ro, rd, tMax) * density;
  col += u_haze_amb * (1.0 - exp(-tMax * 0.05)) * (0.6 + 0.8 * smoke);
  col += bars(ro, rd, tMax, 1.0);
  col += lenses(ro, rd, tMax);

  // The curtain: a wall of coloured light behind the stage, with nested arch
  // bands, vertical beam streaks and a glow in the haze in front of it.
  if (u_curtain.r + u_curtain.g + u_curtain.b > 1e-4 && rd.z < -1e-4) {
    float tc = (u_curtain.w - ro.z) / rd.z;
    if (tc > 0.0 && tc < tMax + 0.01) {
      vec3 C = ro + rd * tc;
      float W = u_room.x, H = u_room.y;
      float xn = C.x / W, yn = C.y / H;
      if (abs(xn) < 1.0 && yn > 0.0 && yn < 1.0) {
        // nested pointed arches: level sets of height plus a sharp |x| term
        float f = (1.0 - yn) + 0.9 * pow(abs(xn), 1.4);
        float bands = smoothstep(0.42, 0.0, abs(fract(f * 4.0 + u_time * 0.02) - 0.5)) * smoothstep(1.6, 0.4, f);
        float streak = 0.55 + 0.45 * sin(xn * 90.0 + vnoise(vec3(xn * 6.0, yn * 0.5, u_time * 0.1)) * 6.0);
        streak = pow(streak, 3.0);
        float glow = exp(-f * 1.6);
        // Soft edges: the wall fades out at its sides and top (no hard rectangle).
        float edge = smoothstep(1.0, 0.55, abs(xn)) * smoothstep(1.0, 0.8, yn);
        vec3 wall = (u_curtain.rgb * (glow * (0.6 + 0.8 * streak) + bands * 0.35) + u_curtain2 * bands * glow * 0.6) * edge;
        col += wall * (0.5 + 0.7 * smoke) * exp(-tc * 0.01);
      }
    }
    // haze in front of the wall takes its colour
    col += u_curtain.rgb * 0.035 * (1.0 - exp(-min(tc, tMax) * 0.06)) * (0.5 + smoke);
  }

  // Chandelier glitter at the top of the curtain (Cathedral, breakdowns).
  if (u_glitter > 0.0) {
    float t = dot(u_glitter_pos - ro, rd);
    if (t > 0.0) {
      vec3 q = ro + rd * t - u_glitter_pos;
      float r = length(q);
      vec2 cellP = floor(vec2(atan(q.y, q.x) * 6.0, r * 1.2));
      float tw = hash12(cellP + floor(u_time * 6.0));
      float pts = 0.0;
      for (int k = 0; k < 24; k++) {
        float fk = float(k);
        vec3 p = vec3(sin(fk * 2.4 + u_time * 0.2) * (0.5 + fk * 0.11), cos(fk * 1.7) * (1.2 + fk * 0.12), sin(fk * 5.1) * 0.5) * 1.2;
        float d = length(cross(rd, (u_glitter_pos + p) - ro));
        float rr2 = max(0.05, t * u_px * 1.2);
        pts += exp(-d * d / (rr2 * rr2)) * (0.05 / rr2) * (0.6 + 0.4 * sin(u_time * 3.0 + fk * 7.0));
      }
      col += u_glitter_col * u_glitter * (pts * 1.4 + exp(-r * 0.35) * 0.25);
    }
  }

  // Strobe: the whole room lit white for a moment (flash-guarded on the CPU).
  col += vec3(1.0, 0.98, 0.95) * u_strobe * (0.55 + 0.45 * smoke) * 1.4;

  // Crowd in the foreground haze.
  if (u_crowd > 0.0) {
    float rim;
    float m = crowdMask(uv, aspect, rim);
    // Rim light only where the light behind the crowd is bright (backlit heads).
    float behind = clamp(dot(col, vec3(0.3, 0.5, 0.2)) * 1.5, 0.0, 1.0);
    vec3 sil = u_floor_col * 0.3 + u_rim * rim * behind * 0.8;
    col = mix(col, sil, m * u_crowd);
  }
  frag = vec4(col, 1.0);
}
