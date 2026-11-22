#version 300 es
precision highp float;
precision highp int;
// Cymatics sand: one texel per grain, on the right half of the plate (the
// renderer mirrors every grain, so the relief is exactly symmetric).
//   A = position.xy (plate units, x >= 0), velocity.xy
//   B = height, vertical speed, seed, kind (0 sand on the plate, 1 a grain thrown off it)
// Grains random-walk with a step proportional to the plate's vibration
// amplitude |u| at their position, plus a small drift down |u|'s slope: they
// jitter on the antinodes and come to rest on the nodal lines (Chladni).
uniform sampler2D u_A;
uniform sampler2D u_B;
uniform float u_dt;
uniform float u_time;
uniform float u_init;
uniform vec4 u_modeA;        // m, n, mix sign, -
uniform vec4 u_modeB;
uniform float u_blend;       // 0 → mode A, 1 → mode B
uniform float u_drive;       // vibration strength (how lively the sand is)
uniform float u_kick;        // kick throw (this frame)
uniform float u_burst;       // drop: a strong throw, some grains fly off
uniform vec2 u_half;         // plate half extents
uniform float u_round;       // corner radius (0 box … half extents: a disc)
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;

const float PI = 3.14159265;

uvec4 pcg4(uvec4 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  v ^= v >> 16u;
  v.x += v.y * v.w; v.y += v.z * v.x; v.z += v.x * v.y; v.w += v.y * v.z;
  return v;
}
vec4 rand4(uvec2 id, uint s) { return vec4(pcg4(uvec4(id, s, s * 7u + 3u))) / 4294967295.0; }

float chladni(vec2 p, vec4 md) {
  vec2 q = p * PI;
  return cos(md.y * q.x) * cos(md.x * q.y) - md.z * cos(md.x * q.x) * cos(md.y * q.y);
}
float field(vec2 p) { return mix(chladni(p, u_modeA), chladni(p, u_modeB), u_blend); }

float sdPlate(vec2 p) {
  vec2 q = abs(p) - u_half + u_round;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_round;
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(u_A, id, 0);
  vec4 B = texelFetch(u_B, id, 0);
  vec4 r = rand4(uvec2(id), uint(u_time * 1009.0) + 11u);
  float dt = u_dt;
  if (u_init > 0.5) {
    vec4 s = rand4(uvec2(id), 3u);
    A = vec4(s.x * u_half.x, (s.y * 2.0 - 1.0) * u_half.y, 0.0, 0.0);
    B = vec4(0.0, 0.0, s.z, 0.0);
  }
  vec2 p = A.xy;
  float z = B.x, vz = B.y, seed = B.z, kind = B.w;

  if (kind > 0.5) {
    // A thrown grain: ballistic outward drift, then it falls back onto the plate.
    p += A.zw * dt;
    A.zw *= exp(-dt * 0.9);
    z = max(0.0, z + vz * dt); vz -= 1.6 * dt;
    if (length(A.zw) < 0.02 || length(p) > 2.6) {
      vec4 s = rand4(uvec2(id), uint(u_time * 37.0) + 5u);
      p = vec2(s.x * u_half.x, (s.y * 2.0 - 1.0) * u_half.y);
      A.zw = vec2(0.0); kind = 0.0; z = 0.0; vz = 0.0;
    }
  } else {
    float u = field(p);
    float amp = abs(u);
    const float e = 0.004;
    vec2 g = vec2(abs(field(p + vec2(e, 0.0))) - abs(field(p - vec2(e, 0.0))), abs(field(p + vec2(0.0, e))) - abs(field(p - vec2(0.0, e)))) / (2.0 * e);
    float ang = r.x * 2.0 * PI;
    float airborne = step(0.0005, z);
    // Random walk ∝ amplitude (bigger hops in the air), drift down the slope.
    // A little agitation everywhere lets grains spread along a nodal line instead of freezing in clumps.
    vec2 hop = vec2(cos(ang), sin(ang)) * (amp + 0.06) * u_drive * (1.0 + 1.5 * airborne) * sqrt(dt * 60.0) * 0.006;
    vec2 drift = -g / (1.0 + length(g)) * u_drive * 0.0016 * dt * 60.0;
    p += hop + drift;
    // Kicks throw the sand up (more on the antinodes); it falls back.
    if (u_kick > 0.0 && z < 0.002) vz = max(vz, u_kick * (0.15 + 0.85 * amp) * (0.4 + 0.6 * r.y) * 0.5);
    if (u_burst > 0.0 && z < 0.01) {
      vz = max(vz, u_burst * (0.5 + 0.5 * r.z) * 0.9);
      if (r.w < 0.05 * u_burst) { kind = 1.0; A.zw = (normalize(p + vec2(0.001, 0.0)) + (r.xy - 0.5) * 0.6) * (0.5 + 0.9 * r.z) * u_burst; }
    }
    z = max(0.0, z + vz * dt);
    vz = z > 0.0 ? vz - 2.4 * dt : 0.0;
    // Stay on the plate (the right half: the left is the mirror image).
    float d = sdPlate(p);
    if (d > 0.0) {
      vec2 n = vec2(sdPlate(p + vec2(0.002, 0.0)) - d, sdPlate(p + vec2(0.0, 0.002)) - d);
      p -= normalize(n + 1e-6) * (d + 0.002);
    }
    p.x = abs(p.x);
  }
  outA = vec4(p, A.zw);
  outB = vec4(z, vz, seed, kind);
}
