#version 300 es
precision highp float;
uniform sampler2D u_cover;
uniform float u_alpha;
uniform float u_gain;
in vec2 v_uv;
out vec4 frag;
void main() {
  vec3 c = texture(u_cover, v_uv).rgb * u_gain;
  frag = vec4(c * u_alpha, u_alpha);
}
