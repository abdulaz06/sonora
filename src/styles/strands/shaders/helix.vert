#version 300 es
precision highp float;
precision highp int;
// Silk Helix (3D): a twisted column of silk threads ringed like a planet,
// drawn by stateless particles (each one's place comes from its id and the
// shared state, so nothing drifts). Writes the accumulation buffer:
// r = thread density, g = glints, b = rings.
//   threads  two or three strands of hair-thin lanes winding around the axis,
//            flowing along it; kicks pluck a ripple that runs up the column
//   rings    bands around the middle orbiting at their own speeds (inner
//            faster), with a gap; kicks send a density wave outward
//   glints   bright dashes circling the column
uniform mat4 u_view_proj;
uniform vec3 u_cam_pos;
uniform float u_time;
uniform float u_point;
uniform float u_gain;
uniform int u_thread_count;     // particles [0, threads) are threads,
uniform int u_ring_count;       // then rings, the rest glints
uniform float u_len;            // half the column's height
uniform float u_radius;
uniform float u_twist;          // radians per unit of height
uniform float u_phase;
uniform float u_third;          // 0..1: third strand (drops)
uniform float u_burst;          // drop: everything flies out, then re-forms
uniform float u_flow;           // threads travel along their strand (units/s)
uniform vec4 u_pluck[4];        // height, age, strength
uniform int u_pluck_count;
uniform float u_kick;           // bass envelope: the column breathes
uniform vec2 u_ring_r;          // inner / outer ring radius
uniform float u_ring_tilt;      // tilt of the ring plane (rad, about x)
uniform float u_ring_phase;     // orbit phase of the inner edge
uniform vec4 u_waves[4];        // ring waves: radius of the front, age, strength
uniform int u_wave_count;
uniform vec2 u_fog;             // near / far (distance from the camera)
out vec4 v_col;
out vec2 v_uv;
flat out float v_seed;

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float h01(uint x) { return float(hashu(x) & 0xffffffu) / 16777216.0; }

float place(vec3 p, float basePx) {
  vec4 clip = u_view_proj * vec4(p, 1.0);
  if (clip.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return 0.0; }
  gl_Position = clip;
  float grow = clamp(2.2 / clip.w, 0.6, 2.4);
  gl_PointSize = basePx * grow;
  float d = distance(p, u_cam_pos);
  return (1.0 - smoothstep(u_fog.x, u_fog.y, d)) / max(grow, 1.0);
}

void main() {
  const float PI = 3.14159265;
  int id = gl_VertexID;
  uint u = uint(id) * 4u + 29u;
  float h1 = h01(u), h2 = h01(u + 1u), h3 = h01(u + 2u), h4 = h01(u + 3u);
  v_seed = h1;
  v_uv = vec2(0.0);
  vec3 p;
  vec4 col = vec4(0.0);
  float L = u_len;

  if (id < u_thread_count) {
    float k = floor(h1 * 3.0);
    float lane = (floor(h2 * 14.0) + 0.5) / 14.0 - 0.5;
    float s = mod(h3 * 2.0 * L + u_time * u_flow * (0.6 + 0.8 * h4), 2.0 * L) - L;
    float off = k < 0.5 ? 0.0 : k < 1.5 ? mix(PI, 2.0 * PI / 3.0, u_third) : mix(PI, 4.0 * PI / 3.0, u_third);
    float wgt = k > 1.5 ? u_third : 1.0;
    float phi = u_phase + s * u_twist * (1.0 - 0.8 * u_burst) + off + lane * 0.38;
    float R = u_radius * (1.0 + lane * 0.22);
    float pinch = sin(u_phase * 0.13) * 0.25 * L;
    R *= 0.42 + 0.68 * smoothstep(0.0, 0.85 * L, abs(s - pinch));
    for (int i = 0; i < 4; i++) {
      if (i >= u_pluck_count) break;
      vec4 pl = u_pluck[i];
      float d = abs(s - pl.x);
      float front = pl.y * 1.8 * L;
      R *= 1.0 + pl.z * 0.55 * exp(-pow((d - front) / (0.1 * L), 2.0)) * exp(-pl.y / 0.55);
    }
    R *= 1.0 + u_kick * 0.16;
    R *= 1.0 + u_burst * (0.5 + 1.7 * h4);
    wgt *= smoothstep(L, L * 0.75, abs(s));
    p = vec3(R * sin(phi), s, R * cos(phi));
    col.r = wgt * place(p, u_point) * 1.6;
  } else if (id < u_thread_count + u_ring_count) {
    // Rings: radius across the band with a gap (Cassini-like) and a few finer gaps.
    float t = h1;
    if (t > 0.55 && t < 0.63) t = t < 0.59 ? 0.55 - (0.59 - t) * 0.4 : 0.63 + (t - 0.59) * 0.4;
    float rho = mix(u_ring_r.x, u_ring_r.y, t);
    float fine = 0.75 + 0.25 * sin(rho * 61.0) * sin(rho * 23.0 + 1.0);
    // Inner rings orbit faster (Kepler).
    float th = h2 * 2.0 * PI + u_ring_phase * pow(u_ring_r.x / rho, 1.5);
    float wave = 0.0;
    for (int i = 0; i < 4; i++) {
      if (i >= u_wave_count) break;
      vec4 w = u_waves[i];
      wave += w.z * exp(-pow((rho - w.x) / (0.07 * u_ring_r.y), 2.0)) * exp(-w.y / 0.9);
    }
    rho *= 1.0 + 0.03 * wave + u_burst * (0.35 + 0.6 * h3);
    vec3 q = vec3(rho * cos(th), (h4 - 0.5) * 0.012 * u_ring_r.y, rho * sin(th));
    float ct = cos(u_ring_tilt), st = sin(u_ring_tilt);
    p = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct);
    col.b = place(p, u_point) * fine * (0.7 + 2.2 * wave) * (0.55 + 0.45 * h3);
  } else {
    float s = (h3 * 2.0 - 1.0) * L * 0.9;
    float R = u_radius * (1.05 + 1.4 * h1 * h1) * (1.0 + u_burst * (0.5 + 1.7 * h4));
    float phi = h2 * 6.2832 + u_time * (0.7 + 1.3 * h4) * (h1 < 0.5 ? 1.0 : -1.0) + u_phase * 0.6;
    p = vec3(R * sin(phi), s, R * cos(phi));
    col.g = place(p, 1.5) * smoothstep(L, L * 0.75, abs(s)) * (0.3 + 0.7 * pow(fract(h4 * 31.0), 2.0)) * 4.0;
  }
  v_col = col * u_gain;
}
