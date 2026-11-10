#version 300 es
precision highp float;
precision highp int;
// Draws particles. VARIANT 0–2: points, 3: instanced brushstrokes,
// 4: instanced velocity-stretched streaks.
uniform sampler2D u_stateA;
uniform sampler2D u_stateB;
uniform int u_side;
uniform vec2 u_center;
uniform float u_view;
uniform float u_aspect;
uniform float u_rot;
uniform float u_point;
uniform float u_gain;
uniform float u_active;
uniform float u_time;
uniform float u_sparkle;       // high-hit sparkle boost
uniform vec2 u_res;            // target size in pixels
// Starry
uniform float u_stroke_len;
uniform float u_stroke_w;
uniform vec4 u_vort[8];
uniform int u_vort_count;
uniform float u_field_t;
uniform vec4 u_stars_w[8];    // star world pos.xy, radius
uniform int u_star_w_count;
// Warp
uniform vec2 u_vp;             // vanishing point offset (clip units)
uniform float u_roll;
uniform float u_streak;        // streak length factor
out vec4 v_col;
out vec2 v_uv;
flat out float v_seed;
//#include noise

vec2 toClip(vec2 w) {
  vec2 rel = w - u_center;
  float c = cos(-u_rot), s = sin(-u_rot);
  rel = mat2(c, s, -s, c) * rel;
  return rel / (vec2(u_aspect, 1.0) * u_view * 0.5);
}

void main() {
#if VARIANT <= 2
  int pid = gl_VertexID;
#else
  int pid = gl_InstanceID;
#endif
  ivec2 id = ivec2(pid % u_side, pid / u_side);
  vec4 A = texelFetch(u_stateA, id, 0);
  vec4 B = texelFetch(u_stateB, id, 0);
  float age = B.x, life = B.y, seed = B.z, kind = B.w;
  float w = smoothstep(0.0, 0.25, age) * smoothstep(life, life - 0.7, age);
  if (age < 0.0 || seed > u_active) w = 0.0;
  v_seed = seed;
  v_uv = vec2(0.0);

#if VARIANT == 0
  // Silk: r = ribbon density, g = dust.
  gl_Position = vec4(toClip(A.xy), 0.0, 1.0);
  gl_PointSize = kind > 0.5 ? 1.0 + step(0.985, fract(seed * 97.0)) : u_point;
  float speed = length(A.zw);
  v_col = kind > 0.5
    ? vec4(0.0, w * (0.15 + 0.85 * u_sparkle) * pow(fract(seed * 31.0), 3.0) * 1.5, 0.0, 0.0)
    : vec4(w * u_gain * (0.6 + 4.0 * speed), 0.0, 0.0, 0.0);
#elif VARIANT == 1
  // Lumen: hair-thin filaments, iridescent tint carried in rgb.
  gl_Position = vec4(toClip(A.xy), 0.0, 1.0);
  gl_PointSize = u_point;
  float t = age / max(life, 1e-3);
  float hue = fract(kind + atan(A.w, A.z) / 6.2832 + u_time * 0.03);
  vec3 irid = 0.55 + 0.45 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
  irid = 0.5 + 0.5 * cos(6.2832 * (hue + vec3(0.0, 0.33, 0.67)));
  // White near the source, iridescent toward the tips.
  irid = mix(vec3(1.0), irid * 1.7, smoothstep(0.0, 0.35, t) * 0.9);
  v_col = vec4(irid * w * u_gain * (1.0 - t * 0.6), 1.0);
#elif VARIANT == 2
  // Wisp: r = smoke, g = ring smoke.
  gl_Position = vec4(toClip(A.xy), 0.0, 1.0);
  gl_PointSize = u_point;
  v_col = kind > 0.5 ? vec4(0.0, w * u_gain * 1.4, 0.0, 0.0) : vec4(w * u_gain, 0.0, 0.0, 0.0);
#elif VARIANT == 3
  // Starry: a short thick stroke oriented along the swirl.
  int corner = gl_VertexID;
  vec2 q = corner == 0 ? vec2(-1, -1) : corner == 1 ? vec2(1, -1) : corner == 2 ? vec2(-1, 1)
         : corner == 3 ? vec2(1, -1) : corner == 4 ? vec2(1, 1) : vec2(-1, 1);
  vec2 dir = length(A.zw) > 1e-5 ? normalize(A.zw) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float len = u_stroke_len * (0.7 + 0.6 * fract(seed * 17.0));
  float wid = u_stroke_w * (0.7 + 0.6 * fract(seed * 29.0));
  vec2 wp = A.xy + dir * q.x * len + nrm * q.y * wid;
  gl_Position = vec4(toClip(wp), 0.0, 1.0);
  v_uv = q;
  float spd = length(A.zw);
  // Strokes near a star turn warm.
  float nearStar = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_star_w_count) break;
    float dd = length(A.xy - u_stars_w[i].xy) / max(u_stars_w[i].z, 1e-4);
    nearStar = max(nearStar, smoothstep(2.6, 0.9, dd));
  }
  v_col = vec4(spd, kind, w * (0.35 + 0.65 * u_active), nearStar);
#elif VARIANT == 4
  // Warp: head at the particle, tail further down the tunnel.
  int corner = gl_VertexID;
  vec2 q = corner == 0 ? vec2(0, -1) : corner == 1 ? vec2(1, -1) : corner == 2 ? vec2(0, 1)
         : corner == 3 ? vec2(1, -1) : corner == 4 ? vec2(1, 1) : vec2(0, 1);
  float f = 1.25; // focal length
  vec3 head = A.xyz;
  vec3 tail = head - vec3(0.0, 0.0, max(A.w, 0.5) * u_streak);
  float cr = cos(u_roll), sr = sin(u_roll);
  mat2 roll = mat2(cr, sr, -sr, cr);
  vec2 ph = roll * (head.xy * f / -head.z) + u_vp;
  vec2 pt = roll * (tail.xy * f / -min(tail.z, -0.05)) + u_vp;
  ph.x /= u_aspect; pt.x /= u_aspect;
  vec2 along = ph - pt;
  vec2 dirc = length(along) > 1e-6 ? normalize(along * u_res) : vec2(1.0, 0.0);
  vec2 side = vec2(-dirc.y, dirc.x) / u_res * 2.0;
  float px = clamp(4.0 / -head.z, 0.9, 5.0);
  vec2 pos = mix(pt, ph, q.x) + side * q.y * px;
  gl_Position = vec4(pos, 0.0, 1.0);
  v_uv = q;
  float fadeIn = smoothstep(-48.0, -30.0, head.z);
  v_col = vec4(fadeIn, fract(seed * 7.13), fract(seed * 3.77), q.x);
#endif
}
