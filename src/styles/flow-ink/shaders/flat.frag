#version 300 es
precision highp float;
// Flat (2D) view: the world camera pans/zooms/rotates across the periodic
// fluid domain; a gentle top-light relief from the blurred field adds depth.
uniform vec2 u_resolution;
uniform vec2 u_cam_center;
uniform float u_cam_view_h;
uniform float u_cam_rot;
out vec4 frag;
//#include common
//#include ink
void main() {
  vec2 p = (gl_FragCoord.xy - 0.5 * u_resolution) / u_resolution.y;
  float c = cos(u_cam_rot), s = sin(u_cam_rot);
  vec2 world = u_cam_center + mat2(c, s, -s, c) * p * u_cam_view_h;
  vec2 uv = world / u_domain;

  float texelsPerPixel = u_dye_res * u_cam_view_h / (u_domain * u_resolution.y);
  InkSample ink = sampleInk(uv, texelsPerPixel > 1.5 ? 1.0 : 0.0);
  float cover;
  vec3 col = shadeInk(ink, world, gl_FragCoord.xy, cover);

  // Relief from the blurred field, lit from the upper left.
  float e = 1.0 / u_sim_res;
  float hx = inkHeight(texture(u_height, uv + vec2(e, 0.0))) - inkHeight(texture(u_height, uv - vec2(e, 0.0)));
  float hy = inkHeight(texture(u_height, uv + vec2(0.0, e))) - inkHeight(texture(u_height, uv - vec2(0.0, e)));
  vec3 n = normalize(vec3(-hx * 6.0, -hy * 6.0, 1.0));
  float diff = dot(n, normalize(vec3(-0.5, 0.6, 0.65)));
  col *= mix(1.0, 0.8 + 0.35 * diff, cover * (u_light == 1 ? 0.5 : 1.0));

  frag = vec4(col, 1.0);
}
