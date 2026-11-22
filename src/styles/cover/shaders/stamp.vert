#version 300 es
precision highp float;
// A copy of the cover as a rotated, scaled quad (screen height units from the middle).
layout(location = 0) in vec2 a_position;
uniform vec2 u_center;
uniform float u_size;
uniform float u_rot;
uniform float u_aspect;
uniform float u_cover_aspect;
out vec2 v_uv;
void main() {
  vec2 q = a_position;
  float c = cos(u_rot), s = sin(u_rot);
  vec2 p = u_center + mat2(c, s, -s, c) * q * u_size;
  gl_Position = vec4(p.x / (0.5 * u_aspect), p.y / 0.5, 0.0, 1.0);
  vec2 uv = q * 0.5 + 0.5;
  if (u_cover_aspect > 1.0) uv.x = 0.5 + (uv.x - 0.5) / u_cover_aspect;
  else uv.y = 0.5 + (uv.y - 0.5) * u_cover_aspect;
  v_uv = vec2(uv.x, 1.0 - uv.y);
}
