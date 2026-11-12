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
uniform float u_lum_scale;  // flash guard: holds luminance steady when engaged
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
float acesS(float x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

// Hue-preserving filmic: the ACES curve is applied to the brightest channel
// and the colour is scaled with it, so bright saturated colours stay
// saturated instead of burning to white. A share of per-channel ACES keeps
// the filmic look; only extreme highlights roll toward white.
vec3 filmic(vec3 x) {
  float m = max(max(x.r, x.g), x.b);
  vec3 hue = m > 1e-5 ? x * (acesS(m) / m) : x;
  float white = 0.25 + 0.45 * smoothstep(2.5, 8.0, m);
  return mix(hue, aces(x), white);
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

  if (u_tonemap == 0) col = filmic(col);
  col = clamp(col * u_lum_scale, 0.0, 1.0);

  // Grain: strongest in mid-tones, per-pixel, animated.
  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float g = hash(vec3(gl_FragCoord.xy, floor(u_time * 48.0))) - 0.5;
  col += g * u_grain * (0.35 + 1.3 * lum * (1.0 - lum));

  col *= u_tint;
  col += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
  frag = vec4(col, 1.0);
}
