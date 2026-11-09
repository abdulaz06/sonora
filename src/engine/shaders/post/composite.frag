#version 300 es
precision highp float;
// Final composite for art styles: scene + bloom, exposure, tonemap, vignette,
// fine luminance-aware grain, crossfade tint and dithering.
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;   // output size
uniform float u_time;
uniform float u_exposure;
uniform float u_bloom_strength;
uniform float u_grain;
uniform float u_vignette;
uniform int u_tonemap;       // 0 filmic, 1 none
uniform float u_flash;
uniform vec3 u_tint;
out vec4 frag;

float hash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_resolution;
  vec3 col = texture(u_scene, uv).rgb;
  col += texture(u_bloom, uv).rgb * u_bloom_strength;
  col *= u_exposure;
  col += u_flash;

  vec2 v = uv * 2.0 - 1.0;
  v.x *= mix(1.0, u_resolution.x / u_resolution.y, 0.5);
  float vig = 1.0 - u_vignette * smoothstep(0.35, 1.45, length(v));
  col *= vig;

  if (u_tonemap == 0) col = aces(col);
  col = clamp(col, 0.0, 1.0);

  // Grain: strongest in mid-tones, per-pixel, animated.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g = hash(vec3(gl_FragCoord.xy, floor(u_time * 48.0))) - 0.5;
  col += g * u_grain * (0.35 + 1.3 * lum * (1.0 - lum));

  col *= u_tint;
  col += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
}
