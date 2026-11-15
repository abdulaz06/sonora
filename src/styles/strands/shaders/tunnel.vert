#version 300 es
precision highp float;
precision highp int;
// Wisp Depth "Tunnel": an endless winding tunnel drawn by particles, with the
// chase camera riding behind the three flames. Stateless: each particle's
// place comes from its id and the distance travelled, so the tunnel never
// ends. Walls are smoke and embers laid along the path (they stream past as
// the camera flies); trails are smoke shed by the flames, read back from a
// short history of their positions.
uniform mat4 u_view_proj;
uniform vec3 u_cam_pos;
uniform float u_s;              // camera distance along the tunnel
uniform float u_time;
uniform int u_wall_count;       // particles [0, wall) are walls, the rest trails
uniform float u_point;
uniform float u_gain;
uniform float u_wall_gain;      // walls are spread thin: extra gain over the trails
uniform float u_radius;         // tunnel radius
uniform float u_span;           // length of tunnel kept ahead of the camera
uniform vec4 u_path;            // centre line: x = a*sin(s*f) + b*sin(s*g + 1.3)
uniform vec2 u_path_y;          //              y = a*sin(s*f + 0.7)
uniform vec2 u_fog;             // near / far
uniform vec4 u_wisp_col[4];     // flame colours (0-2) and ring colour (3)
uniform vec4 u_flames[3];       // flame world position and brightness
uniform vec4 u_rings[4];        // beat rings: s along the tunnel, strength
uniform int u_ring_count;
uniform sampler2D u_hist;       // flame history: x = sample (60 Hz ring), y = flame
uniform int u_hist_head;        // next sample to write
uniform int u_hist_len;         // valid samples
uniform float u_trail_life;     // seconds a trail particle lives
out vec4 v_col;
out vec2 v_uv;
flat out float v_seed;

uint hashu(uint x) {
  x ^= x >> 16; x *= 0x7feb352du; x ^= x >> 15; x *= 0x846ca68bu; x ^= x >> 16;
  return x;
}
float h01(uint x) { return float(hashu(x) & 0xffffffu) / 16777216.0; }

vec3 centre(float s) {
  return vec3(u_path.x * sin(s * u_path.y) + u_path.z * sin(s * u_path.w + 1.3),
              u_path_y.x * sin(s * u_path_y.y + 0.7), -s);
}

// Project and size a particle; returns fog visibility (0 = hidden).
float place(vec3 p, float basePx) {
  vec4 clip = u_view_proj * vec4(p, 1.0);
  if (clip.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return 0.0; }
  gl_Position = clip;
  float grow = clamp(1.6 / clip.w, 0.6, 2.5);
  gl_PointSize = basePx * grow;
  float d = distance(p, u_cam_pos);
  return (1.0 - smoothstep(u_fog.x, u_fog.y, d)) / max(grow, 1.0);
}

vec3 flameLight(vec3 p) {
  vec3 c = vec3(0.0);
  for (int i = 0; i < 3; i++) {
    vec3 d = p - u_flames[i].xyz;
    c += u_wisp_col[i].rgb * u_flames[i].w * 0.05 / (dot(d, d) + 0.03);
  }
  return c;
}

void main() {
  int id = gl_VertexID;
  uint u = uint(id) * 4u + 17u;
  float h1 = h01(u), h2 = h01(u + 1u), h3 = h01(u + 2u), h4 = h01(u + 3u);
  v_seed = h1;
  v_uv = vec2(0.0);
  vec3 p;
  vec3 col;
  float vis;

  if (id < u_wall_count) {
    // Wall: a fixed spot on the tunnel's skin; once the camera passes it, it
    // reappears at the far end (hidden in the fog).
    // Structure makes it read as a tunnel: most particles stream along lanes
    // running down it (converging on the far end), the rest form rings.
    float s = u_s - 1.0 + mod(h3 * u_span - u_s, u_span);
    float ang;
    if (h4 < 0.62) {
      float lane = floor(h1 * 18.0);
      ang = (lane + 0.5) / 18.0 * 6.2832 + 0.05 * (h2 - 0.5) + 0.25 * sin(s * 0.2 + lane);
    } else {
      s = floor(s / 0.9) * 0.9 + 0.04 * (h2 - 0.5);
      ang = h1 * 6.2832;
    }
    float rad = u_radius * (0.92 + 0.12 * h2);
    vec3 c = centre(s);
    p = c + vec3(cos(ang), sin(ang), 0.0) * rad;
    int ti = int(fract(h1 * 3.0 + h4) * 3.0);
    vec3 tint = u_wisp_col[min(ti, 2)].rgb;
    col = (tint * 0.35 + flameLight(p) * 2.5) * u_wall_gain;
    // Beat rings race down the walls.
    for (int k = 0; k < 4; k++) {
      if (k >= u_ring_count) break;
      float dr = (s - u_rings[k].x) / 0.35;
      col += mix(u_wisp_col[3].rgb, tint, 0.4) * u_rings[k].y * exp(-dr * dr) * 1.0 * u_wall_gain;
    }
    float farFade = 1.0 - smoothstep(u_span - 8.0, u_span - 1.5, s - u_s);
    vis = place(p, u_point) * farFade;
  } else {
    // Trail: smoke shed by one flame, at the place the flame was `age` ago.
    int j = id - u_wall_count;
    int fi = j % 3;
    float age = fract(h1 + u_time / u_trail_life) * u_trail_life;
    int back = int(age * 60.0);
    if (back >= u_hist_len) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; v_col = vec4(0.0); return; }
    int idx = (u_hist_head - 1 - back + 4096) % 256;
    vec4 hs = texelFetch(u_hist, ivec2(idx, fi), 0);
    p = hs.xyz + (vec3(h2, h3, h4) - 0.5) * (0.015 + 0.11 * age) + vec3(0.0, 0.035 * age, 0.0);
    float life = 1.0 - age / u_trail_life;
    col = u_wisp_col[fi].rgb * life * (0.45 + 0.55 * hs.w) * 2.2 + flameLight(p) * 0.4;
    vis = place(p, u_point);
  }
  v_col = vec4(col * vis * u_gain, 1.0);
}
