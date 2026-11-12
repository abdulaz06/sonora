#version 300 es
precision highp float;
// Depth view: a grid around the camera, displaced by the blurred ink field.
layout(location = 0) in vec2 a_grid;   // [0,1]^2
uniform mat4 u_view_proj;
uniform vec2 u_grid_origin;            // world xz of grid corner (snapped)
uniform float u_grid_size;             // world units
uniform float u_domain;
uniform sampler2D u_height;
uniform float u_height_scale;
uniform float u_lift_scale;
uniform vec3 u_cam_pos;
uniform float u_curve_k;            // >0 planet (∩), <0 bowl (U)
out vec2 v_world;
out vec3 v_pos;
float inkHeightV(vec4 blur) { return 1.0 - exp(-(blur.r + blur.g) * 0.9); }
void main() {
  vec2 world = u_grid_origin + a_grid * u_grid_size;
  vec4 hb = textureLod(u_height, world / u_domain, 0.0);
  float h = inkHeightV(hb) * u_height_scale + hb.a * u_lift_scale;
  // Far vertices are sparse relative to the field: flatten them so distant
  // ridges don't alias into spikes (fog hides the rest).
  float dist = length(world - u_cam_pos.xz);
  h *= 1.0 - smoothstep(1.4 + u_cam_pos.y, 3.2 + u_cam_pos.y * 1.5, dist);
  // Curvature around the camera: the surface falls away (planet) or rises (bowl).
  h -= u_curve_k * dist * dist;
  vec3 pos = vec3(world.x, h, world.y);
  v_world = world;
  v_pos = pos;
  gl_Position = u_view_proj * vec4(pos, 1.0);
}
