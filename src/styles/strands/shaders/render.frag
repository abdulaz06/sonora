#version 300 es
precision highp float;
in vec4 v_col;
in vec2 v_uv;
flat in float v_seed;
uniform vec3 u_c0;   // palette slots used by strokes / streaks
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform float u_hue_shift;
uniform float u_gain;
out vec4 frag;
//#include noise
void main() {
#if VARIANT <= 2
  frag = v_col;
#elif VARIANT == 3
  // Brushstroke: soft across the width, bristle streaks along the length.
  float across = 1.0 - smoothstep(0.55, 1.0, abs(v_uv.y));
  float along = 1.0 - smoothstep(0.75, 1.0, abs(v_uv.x));
  float bristle = 0.65 + 0.35 * sin(v_uv.y * 9.0 + v_seed * 40.0);
  float a = across * along * v_col.z * 0.9;
  if (a < 0.01) discard;
  // Colour: slow strokes deep blue, fast strokes cobalt, a few warm yellows.
  float spd = clamp(v_col.x * 7.0, 0.0, 1.0);
  vec3 col = mix(u_c0, u_c1, spd);
  col = mix(col, u_c2, smoothstep(0.86, 1.0, v_col.y));
  col = mix(col, u_c3, smoothstep(0.97, 1.0, v_col.y) * 0.8);
  col = hueRotate(col, u_hue_shift) * bristle;
  frag = vec4(col, a);
#elif VARIANT == 4
  // Streak: bright head fading to the tail, soft edges.
  float edge = 1.0 - smoothstep(0.2, 1.0, abs(v_uv.y));
  float body = mix(0.15, 1.0, v_uv.x * v_uv.x);
  float k = v_col.y;
  vec3 col = k < 0.62 ? u_c0 : k < 0.86 ? u_c1 : k < 0.95 ? u_c3 : u_c2;
  frag = vec4(col * edge * body * v_col.x * u_gain, 1.0);
#endif
}
