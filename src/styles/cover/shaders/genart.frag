#version 300 es
precision highp float;
// Generated artwork when nothing with a cover plays: a bold composition in the
// palette (a big disc, bands, a half disc, stripes), seeded per track, grain on top.
uniform vec2 u_res;
uniform float u_seed;
uniform float u_time;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec3 u_bg;
out vec4 frag;
float hash(float n) { return fract(sin(n * 12.9898) * 43758.5453); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = gl_FragCoord.xy / u_res;
  float s = u_seed;
  vec3 col = mix(u_bg * 1.4, u_c1 * 0.35, step(0.5, hash(s + 1.0)) * 0.6);
  // diagonal bands
  float a = hash(s + 2.0) * 3.14;
  float band = dot(p - 0.5, vec2(cos(a), sin(a)));
  col = mix(col, u_c1, step(abs(fract(band * 3.0 + hash(s + 3.0)) - 0.5), 0.12) * 0.85);
  // the big disc
  vec2 c = vec2(0.3 + 0.4 * hash(s + 4.0), 0.3 + 0.4 * hash(s + 5.0));
  float r = 0.22 + 0.14 * hash(s + 6.0) + 0.01 * sin(u_time * 0.5);
  col = mix(col, u_c0, smoothstep(r + 0.003, r - 0.003, length(p - c)));
  // a half disc in the accent
  vec2 c2 = vec2(1.0 - c.x, 1.0 - c.y);
  float r2 = 0.16 + 0.08 * hash(s + 7.0);
  float half_ = step(0.0, dot(p - c2, vec2(cos(a + 1.0), sin(a + 1.0))));
  col = mix(col, u_c2, smoothstep(r2 + 0.003, r2 - 0.003, length(p - c2)) * half_);
  // thin stripes across one third
  float k = floor(hash(s + 8.0) * 3.0) / 3.0;
  float stripe = step(k, p.y) * step(p.y, k + 0.33) * step(0.5, fract(p.x * 18.0));
  col = mix(col, mix(u_c3, u_c0, 0.3), stripe * 0.55);   // pale highlights lean to the primary (Aurora read dull)
  // grain
  col += (hash2(gl_FragCoord.xy) - 0.5) * 0.05;
  frag = vec4(col, 1.0);
}
