#version 300 es
precision highp float;
in vec4 v_col;
in vec2 v_uv;
flat in float v_seed;
uniform vec3 u_c0;   // palette slots used by strokes / streaks
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform float u_gain;
out vec4 frag;
//#include noise
void main() {
#if VARIANT == 0 || VARIANT == 2
  frag = v_col;
#elif VARIANT == 4
  // Streak: bright head fading to the tail, soft edges.
  float edge = 1.0 - smoothstep(0.2, 1.0, abs(v_uv.y));
  float body = mix(0.15, 1.0, v_uv.x * v_uv.x);
  float k = v_col.y;
  vec3 col = k < 0.62 ? u_c0 : k < 0.86 ? u_c1 : k < 0.95 ? u_c3 : u_c2;
  frag = vec4(col * edge * body * v_col.x * u_gain, 1.0);
#endif
}
