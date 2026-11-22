#version 300 es
precision highp float;
// Gaussian falloff, premultiplied; the colour arrives graded and fogged.
in vec4 v_col;
in vec2 v_g;
in float v_point;
out vec4 frag;
void main() {
  float d2 = dot(v_g, v_g);
  if (d2 > 9.0) discard;
  float a = v_col.a * exp(-0.5 * d2);
  if (a < 0.004) discard;
  frag = vec4(v_col.rgb * a, a);
}
