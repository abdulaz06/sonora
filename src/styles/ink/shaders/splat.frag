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
  // Dye: a soft body with a ragged, noise-broken edge (detail > 0). No radial
  // rays — symmetric spikes read as snowflakes, not ink.
  float n = pnoise(vec3(v_d * 1.8, v_seed * 7.0), vec2(64.0));
  float n2 = pnoise(vec3(v_d * 4.5, v_seed * 3.0 + 5.0), vec2(64.0));
  float body = g * (0.8 + 0.45 * n + 0.2 * n2);
  float ragged = smoothstep(0.08, 0.55, body) * (0.75 + 0.25 * n2);
  float mask = mix(g, ragged, v_detail);
  frag = v_dye * max(mask, 0.0);
}
