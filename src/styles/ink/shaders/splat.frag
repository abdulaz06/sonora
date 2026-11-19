#version 300 es
precision highp float;
in vec2 v_d;
flat in vec4 v_dye;
flat in vec4 v_vel;
flat in float v_seed;
flat in float v_detail;
uniform int u_mode; // 0 dye, 1 velocity
out vec4 frag;
//#include common
flat in vec2 v_prev;       // previous stage of a landing: (radius ratio, amount ratio); x = 0: none
// Dye mask at d (in radii): a soft body with a ragged, noise-broken edge
// (detail > 0), a plain gaussian (0) or a solid ink drop (< 0).
float maskAt(vec2 d) {
  float r2 = dot(d, d);
  float g = exp(-r2);
  float r = sqrt(r2);
  // No radial rays: symmetric spikes read as snowflakes, not ink.
  float n = pnoise(vec3(d * 1.8, v_seed * 7.0), vec2(64.0));
  float n2 = pnoise(vec3(d * 4.5, v_seed * 3.0 + 5.0), vec2(64.0));
  float body = g * (0.8 + 0.45 * n + 0.2 * n2);
  float ragged = smoothstep(0.08, 0.55, body) * (0.75 + 0.25 * n2);
  float mask = mix(g, ragged, max(v_detail, 0.0));
  if (v_detail < 0.0) {
    // Ink drop: a solid round body with a soft, slightly uneven rim and no
    // wide faint skirt (a soft gaussian greys the whole page on paper).
    float rr = r * (1.0 + 0.1 * n);
    mask = smoothstep(1.1, 0.65, rr);
  }
  return max(mask, 0.0);
}
void main() {
  float r2 = dot(v_d, v_d);
  float g = exp(-r2);
  if (g < 0.003) discard;
  float r = sqrt(r2);
  if (u_mode == 1) {
    vec2 dir = r > 1e-4 ? v_d / r : vec2(0.0);
    vec2 v = v_vel.xy * g
           + dir * v_vel.z * g * min(r * 1.6, 1.0)
           + vec2(-dir.y, dir.x) * v_vel.w * g * min(r * 1.6, 1.0);
    frag = vec4(v, 0.0, 0.0);
    return;
  }
  float mask = maskAt(v_d);
  // A landing grows in stages: draw only what this stage adds to the previous
  // one (never negative), so deposits stay additive and the dye cap treats
  // them the same at any frame rate.
  if (v_prev.x > 0.0) mask = max(mask - v_prev.y * maskAt(v_d / v_prev.x), 0.0);
  frag = v_dye * mask;
}
