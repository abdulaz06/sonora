#version 300 es
precision highp float;
precision highp int;
// Draws particles. VARIANT 0 (silk), 2 (wisp): points; 4 (warp): instanced
// velocity-stretched streaks. With DEPTH defined (Silk / Wisp Depth views) the
// 2D simulation lies on the ground plane of the 3D camera and each particle
// gets a height, drawn in perspective with fog; the Flat path is unchanged.
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
// Warp
uniform vec2 u_vp;             // vanishing point offset (clip units)
uniform float u_roll;
uniform float u_streak;        // streak length factor
// Wisp colours: agents 0–2 and the ring smoke.
uniform vec4 u_wisp_col[4];
#ifdef DEPTH
uniform mat4 u_view_proj;
uniform vec3 u_cam_pos;
uniform vec2 u_fog;            // near / far
uniform float u_curve_k;       // planet / bowl curvature, as the Ink surface
uniform float u_hspan;         // height of the silk volume / wisp flight band
uniform float u_ring_h;        // wisp: height of the current smoke ring
uniform float u_dscale;        // ground units per simulation unit
#endif
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

#ifdef DEPTH
vec3 worldAt(vec2 p, float h) {
  vec3 w = vec3(p.x * u_dscale, h, p.y * u_dscale);
  float dist = length(w.xz - u_cam_pos.xz);
  w.y -= u_curve_k * dist * dist;
  return w;
}
// Project; returns the fog/visibility factor (0 behind the camera or beyond fog).
float project(vec3 w, float basePx) {
  vec4 clip = u_view_proj * vec4(w, 1.0);
  if (clip.w < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; return 0.0; }
  gl_Position = clip;
  // Nearer = larger, up to a cap; a grown point spreads the same light, so
  // close threads and smoke don't blow out.
  float grow = clamp(1.4 / clip.w, 0.7, 2.0);
  gl_PointSize = basePx * grow;
  float d = distance(w, u_cam_pos);
#if VARIANT == 2
  return (1.0 - smoothstep(u_fog.x, u_fog.y, d)) / max(grow, 1.0);   // soft smoke: half the correction
#else
  return (1.0 - smoothstep(u_fog.x, u_fog.y, d)) / max(grow * grow, 1.0);
#endif
}
// Wisp agent heights (mirrored on the CPU for the flames).
float agentH(float i, float t) {
  return u_hspan * (0.55 + 0.32 * sin(t * 0.37 + i * 2.1) + 0.13 * sin(t * 1.13 + i * 4.0));
}
#endif

void main() {
#if VARIANT == 0 || VARIANT == 2
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
#ifdef DEPTH
  // Ribbons float as thin sheets whose height rolls smoothly with position, so
  // they rise and dip like silk in the air; each thread keeps a small offset of
  // its own for body. Dust sits higher, like stars over the silk.
  float roll = 0.5 + 0.5 * snoise(vec3(A.xy * 1.1, u_time * 0.06));
  float h = kind > 0.5 ? u_hspan * (0.2 + 2.4 * fract(seed * 3.7))
                       : u_hspan * (0.08 + 1.1 * roll * roll + 0.12 * (fract(seed * 7.31) - 0.5));
  w *= project(worldAt(A.xy, h), kind > 0.5 ? 1.0 + step(0.985, fract(seed * 97.0)) : u_point);
#else
  gl_Position = vec4(toClip(A.xy), 0.0, 1.0);
  gl_PointSize = kind > 0.5 ? 1.0 + step(0.985, fract(seed * 97.0)) : u_point;
#endif
  float speed = length(A.zw);
  v_col = kind > 0.5
    ? vec4(0.0, w * (0.15 + 0.85 * u_sparkle) * pow(fract(seed * 31.0), 3.0) * 1.5, 0.0, 0.0)
    : vec4(w * u_gain * (0.6 + 4.0 * speed), 0.0, 0.0, 0.0);
#elif VARIANT == 2
  // Wisp: smoke in its agent's colour; ring smoke brighter.
  int ci = int(clamp(kind, 0.0, 3.0));
#ifdef DEPTH
  // Smoke keeps the height its flame had when it was shed (t - age), and rises.
  float h = (ci == 3 ? u_ring_h : agentH(float(ci), u_time - age)) + age * 0.035;
  w *= project(worldAt(A.xy, h), u_point);
#else
  gl_Position = vec4(toClip(A.xy), 0.0, 1.0);
  gl_PointSize = u_point;
#endif
  v_col = vec4(u_wisp_col[ci].rgb * w * u_gain * (ci == 3 ? 1.5 : 1.0), 1.0);
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
