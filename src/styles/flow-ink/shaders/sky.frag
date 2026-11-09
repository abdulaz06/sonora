#version 300 es
precision highp float;
// Depth view backdrop: fog colour at the horizon fading to a darker zenith,
// so the ground dissolves into haze instead of ending at a hard edge.
uniform vec2 u_resolution;
uniform vec3 u_forward;
uniform vec3 u_right;
uniform vec3 u_up;
uniform float u_tan;
uniform float u_aspect;
uniform vec3 u_horizon;
uniform vec3 u_zenith;
out vec4 frag;
void main() {
  vec2 p = gl_FragCoord.xy / u_resolution * 2.0 - 1.0;
  vec3 d = normalize(u_forward + (u_right * p.x * u_aspect + u_up * p.y) * u_tan);
  float t = smoothstep(-0.03, 0.45, d.y);
  frag = vec4(mix(u_horizon, u_zenith, t), 1.0);
}
