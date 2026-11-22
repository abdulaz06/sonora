#version 300 es
precision highp float;
// Feedback: the previous sweeps, zoomed and turned about the centre, fading.
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_zoom;
uniform float u_rot;
uniform float u_keep;
uniform vec2 u_center;     // uv
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 d = (uv - u_center) * vec2(aspect, 1.0);
  float c = cos(u_rot), s = sin(u_rot);
  d = mat2(c, s, -s, c) * d / u_zoom;
  vec2 src = u_center + d / vec2(aspect, 1.0);
  vec4 v = (src.x < 0.0 || src.y < 0.0 || src.x > 1.0 || src.y > 1.0) ? vec4(0.0) : texture(u_prev, src);
  frag = v * u_keep;
}
