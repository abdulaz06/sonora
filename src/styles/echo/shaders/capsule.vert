#version 300 es
precision highp float;
// One bone of the dancer as a soft capsule between two projected points
// (instanced). The quad covers the segment plus its glow.
layout(location = 0) in vec2 a_corner;        // quad corner (-1..1)
layout(location = 1) in vec4 a_seg;           // p0.xy, p1.xy (pixels)
layout(location = 2) in vec2 a_radius;        // core radius at p0, p1 (pixels)
layout(location = 3) in vec4 a_col;           // rgb × intensity, glow amount
uniform vec2 u_res;
uniform float u_glow;                          // glow reach (× radius)
out vec2 v_px;
flat out vec4 v_seg;
flat out vec2 v_r;
flat out vec4 v_col;
void main() {
  vec2 a = a_seg.xy, b = a_seg.zw;
  vec2 d = b - a;
  float L = length(d);
  vec2 t = L > 1e-3 ? d / L : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float R = max(a_radius.x, a_radius.y) * (1.0 + u_glow) + 2.0;
  vec2 p = mix(a, b, a_corner.x * 0.5 + 0.5) + t * a_corner.x * R + n * a_corner.y * R;
  v_px = p;
  v_seg = a_seg;
  v_r = a_radius;
  v_col = a_col;
  gl_Position = vec4(p / u_res * 2.0 - 1.0, 0.0, 1.0);
}
