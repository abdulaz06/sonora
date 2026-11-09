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
  // Dye: a broken ring, thin radial tendrils and a small dense core, so the
  // flow has fine structure to stretch into filaments (never a filled disc).
  float ang = atan(v_d.y, v_d.x);
  float n = pnoise(vec3(v_d * 2.0, v_seed * 7.0), vec2(64.0));
  float n2 = pnoise(vec3(v_d * 5.5, v_seed * 3.0 + 5.0), vec2(64.0));
  float k = 5.0 + floor(fract(v_seed * 9.7) * 7.0);
  float ring = exp(-pow((r - 0.8 - n * 0.3) / 0.11, 2.0)) * smoothstep(-0.25, 0.35, n2);
  float rays = pow(0.5 + 0.5 * sin(ang * k + n * 3.0 + v_seed * 40.0), 14.0)
             * smoothstep(1.5, 0.35, r) * smoothstep(0.05, 0.3, r) * (0.6 + 0.8 * max(n2 + 0.2, 0.0));
  float core = exp(-r2 * 6.0) * (0.6 + 0.4 * n);
  float detailMask = ring * 0.9 + rays * 0.8 + core * 0.7;
  float mask = mix(g, detailMask, v_detail);
  frag = v_dye * max(mask, 0.0);
}
