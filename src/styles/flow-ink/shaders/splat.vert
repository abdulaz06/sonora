#version 300 es
// Instanced splat quad in domain uv space. Periodic copies near the domain
// edge are submitted as separate instances by fluid.ts.
layout(location = 0) in vec2 a_corner;   // quad corners in [-1,1]
layout(location = 1) in vec4 a_geom;     // center.xy, radius, seed
layout(location = 2) in vec4 a_dye;      // dye amount per channel
layout(location = 3) in vec4 a_vel;      // vx, vy, radial, swirl (sim texels/s)
layout(location = 4) in float a_detail;  // 0 soft blob .. 1 tendrils
uniform float u_extent;                  // quad half-size in radii
out vec2 v_d;
flat out vec4 v_dye;
flat out vec4 v_vel;
flat out float v_seed;
flat out float v_detail;
void main() {
  vec2 uv = a_geom.xy + a_corner * a_geom.z * u_extent;
  v_d = a_corner * u_extent;
  v_dye = a_dye;
  v_vel = a_vel;
  v_seed = a_geom.w;
  v_detail = a_detail;
  gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
}
