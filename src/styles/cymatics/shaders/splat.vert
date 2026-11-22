#version 300 es
precision highp float;
precision highp int;
// Every grain is drawn twice (x and -x): the relief is mirror-symmetric.
// Density target: r = sand on the plate, g = sand in the air, b = thrown grains.
uniform sampler2D u_A;
uniform sampler2D u_B;
uniform int u_side;
uniform float u_extent;      // plate units covered by the density target (half width)
uniform float u_point;
out vec3 v_w;
void main() {
  int pid = gl_VertexID >> 1;
  float mirror = (gl_VertexID & 1) == 1 ? -1.0 : 1.0;
  ivec2 id = ivec2(pid % u_side, pid / u_side);
  vec4 A = texelFetch(u_A, id, 0);
  vec4 B = texelFetch(u_B, id, 0);
  vec2 p = vec2(A.x * mirror, A.y);
  gl_Position = vec4(p / u_extent, 0.0, 1.0);
  gl_PointSize = u_point;
  float air = clamp(B.x * 12.0, 0.0, 1.0);
  v_w = B.w > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0 - air * 0.85, air, 0.0);
}
