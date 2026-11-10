#version 300 es
precision highp float;
// Turing display: the camera looks at a slice of the periodic grid; V is
// thresholded with an anti-aliased edge for crisp, vector-like shapes.
uniform sampler2D u_state;
uniform vec2 u_res;
uniform vec2 u_center;      // camera centre (world)
uniform float u_view;       // world units visible vertically
uniform float u_rot;
uniform float u_domain;     // world units per grid tile
uniform float u_grid;       // grid resolution
uniform int u_variant;      // 0 coral, 1 bioluminescent
uniform int u_light;
uniform int u_invert;
uniform vec3 u_bg;
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform vec3 u_glow;
uniform vec3 u_hot;
uniform float u_pulse;
uniform float u_hit;     // bass-hit envelope: shapes swell on the frame
uniform float u_time;
out vec4 frag;

float grain(vec2 p) {
  return fract(sin(dot(floor(p), vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_res) / u_res.y;
  float c = cos(u_rot), s = sin(u_rot);
  vec2 world = u_center + mat2(c, s, -s, c) * p * u_view;
  vec2 uv = world / u_domain;
  float v = texture(u_state, uv).g;
  float w = max(fwidth(v), 1e-4) * 1.2;
  float th = 0.2 - 0.07 * u_hit;
  float body = smoothstep(th - w, th + w, v);
  vec3 col;
  if (u_variant == 0) {
    // Coral: solid pigment on paper (or paper-coloured shapes on dark).
    vec3 fg = u_ink;
    vec3 bgc = u_light == 1 ? u_paper * (0.97 + 0.03 * grain(gl_FragCoord.xy)) : u_bg;
    if (u_invert == 1) { vec3 t = fg; fg = bgc; bgc = t; }
    col = mix(bgc, fg, body);
  } else {
    // Bioluminescent: glowing edges, dim bodies on black.
    float e = 1.0 - abs(body * 2.0 - 1.0);
    float rim = smoothstep(0.12, 0.2, v) * (1.0 - smoothstep(0.22, 0.34, v));
    vec3 bgc = u_bg * 0.6;
    vec3 inner = u_glow * 0.18 + u_hot * 0.05 * smoothstep(0.3, 0.45, v);
    if (u_invert == 1) { bgc = u_glow * 0.22; inner = u_bg * 0.4; }
    col = mix(bgc, inner, body);
    float pk = max(u_pulse, u_hit);
    col += u_glow * (e * 0.9 + rim * 1.3) * (1.0 + 0.8 * pk);
    col += u_hot * rim * 0.6 * pk;
  }
  frag = vec4(col, 1.0);
}
