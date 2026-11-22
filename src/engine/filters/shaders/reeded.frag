#version 300 es
precision highp float;
// Reeded glass filter: the frame seen through ribbed glass. Each flute is a
// small cylindrical lens: it shows a compressed, mirrored slice of what's
// behind it (offset across the flute), slightly softer toward its edges, with
// a little dispersion (red and blue bend differently), a thin highlight line
// and a dark groove between flutes. Flutes run vertical, angled or radial.
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_w;           // flute width (px)
uniform int u_mode;          // 0 linear (angle u_angle), 2 radial
uniform float u_angle;       // linear: flute direction (rad from vertical)
uniform vec3 u_tint;         // highlight tint (palette highlight)
uniform float u_light;       // paper looks: softer highlight
out vec4 frag;

const float LENS = 0.62;     // offset across the flute (× flute width) at its edge
const vec3 DISPERSE = vec3(0.94, 1.0, 1.07);

float hash(float n) { return fract(sin(n * 91.345) * 47453.5453); }

// Sample one flute (index i, position t in -1..1) at pixel p; `across` is the
// unit direction across the flutes, `scale` the flute's local width factor.
vec3 flute(vec2 p, float i, float t, vec2 across, float scale) {
  float slope = t * (1.0 + 0.45 * t * t);
  float base = -slope * u_w * LENS * scale + (hash(i) - 0.5) * u_w * 0.18 * scale;
  float spread = u_w * scale * (0.015 + 0.05 * t * t);
  vec3 col = vec3(0.0);
  for (int k = -1; k <= 1; k++) {
    float o = float(k) * spread;
    col.r += texture(u_src, (p + across * (base * DISPERSE.r + o)) / u_res).r;
    col.g += texture(u_src, (p + across * (base * DISPERSE.g + o)) / u_res).g;
    col.b += texture(u_src, (p + across * (base * DISPERSE.b + o)) / u_res).b;
  }
  col /= 3.0;
  // Groove (dark) at the flute's edges, highlight line on one side.
  float groove = smoothstep(0.78, 1.0, abs(t));
  col *= 1.0 - 0.32 * groove;
  float hl = exp(-pow((t + 0.62) / 0.07, 2.0)) * 0.16 + exp(-pow((t - 0.86) / 0.05, 2.0)) * 0.05;
  col += u_tint * hl * (u_light > 0.5 ? 0.5 : 1.0) * (0.35 + 0.65 * dot(col, vec3(0.333)));
  return col;
}

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 c = u_res * 0.5;
  vec2 across;
  float x, scale = 1.0;
  if (u_mode == 2) {
    vec2 d = p - c;
    float r = length(d);
    float R = 0.5 * min(u_res.x, u_res.y);
    float a = atan(d.y, d.x);
    x = a * R;
    across = r > 1e-3 ? vec2(-d.y, d.x) / r : vec2(1.0, 0.0);
    // Flutes narrow toward the centre; the effect fades in from there.
    scale = clamp(r / R, 0.0, 2.5) * smoothstep(0.0, 0.18 * R, r);
  } else {
    across = vec2(cos(u_angle), sin(u_angle));
    x = dot(p - c, across);
  }
  float fx = x / u_w;
  float i = floor(fx);
  float t = (fx - i) * 2.0 - 1.0;
  vec3 col = flute(p, i, t, across, scale);
  // Smooth the flute boundary over a pixel (no stair-steps on angled / radial flutes).
  float edgePx = (1.0 - abs(t)) * 0.5 * u_w * max(scale, 0.05);
  if (edgePx < 1.0) {
    float s = sign(t);
    vec3 n = flute(p, i + s, t - 2.0 * s, across, scale);
    col = mix(n, col, 0.5 + 0.5 * edgePx);
  }
  frag = vec4(col, 1.0);
}
