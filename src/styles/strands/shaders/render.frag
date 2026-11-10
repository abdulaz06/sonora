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
uniform float u_warm_shift;   // stars keep most of their warmth when recoloured
uniform float u_gain;
out vec4 frag;
//#include noise
void main() {
#if VARIANT == 0 || VARIANT == 2
  frag = v_col;
#elif VARIANT == 1
  // Filament: brightest at the head, thin soft edge.
  float edge = 1.0 - smoothstep(0.3, 1.0, abs(v_uv.y));
  frag = vec4(v_col.rgb * edge * mix(0.25, 1.0, v_uv.x), 1.0);
#elif VARIANT == 3
  // Brushstroke: soft across the width, bristle streaks along the length.
  float across = 1.0 - smoothstep(0.55, 1.0, abs(v_uv.y));
  float along = 1.0 - smoothstep(0.75, 1.0, abs(v_uv.x));
  float bristle = 0.65 + 0.35 * sin(v_uv.y * 9.0 + v_seed * 40.0);
  float a = across * along * v_col.z * 0.95;
  if (a < 0.01) discard;
  // Colour: deep blues to cobalt by speed and seed, light flecks, warm
  // yellow strokes swirling around stars.
  float spd = clamp(v_col.x * 6.0, 0.0, 1.0);
  float k = v_col.y;
  vec3 col = mix(u_c0, u_c1, clamp(spd * 0.8 + k * 0.5, 0.0, 1.0));
  col = mix(col, mix(u_c1, vec3(0.75, 0.85, 0.95), 0.6), smoothstep(0.82, 0.95, k) * 0.7);
  col = hueRotate(col, u_hue_shift);
  vec3 warm = hueRotate(mix(u_c2, u_c3, smoothstep(0.7, 1.0, k)), u_warm_shift);
  col = mix(col, warm, v_col.w * (0.55 + 0.45 * k)) * bristle;
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
