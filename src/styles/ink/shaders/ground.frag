#version 300 es
precision highp float;
// Depth view shading: ink colour + macro normals from the blurred field,
// micro normals from the dye (filaments catch glints), distance fog.
in vec2 v_world;
in vec3 v_pos;
uniform vec3 u_cam_pos;
uniform vec3 u_light_dir;
uniform vec3 u_fog_color;
uniform vec2 u_fog;            // near, far
uniform float u_height_scale;
uniform float u_lift_scale;
uniform float u_spec;
uniform float u_curve_k;
out vec4 frag;
//#include common
//#include ink
void main() {
  vec2 uv = v_world / u_domain;
  vec3 toCam = u_cam_pos - v_pos;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // Footprint of a pixel in dye texels decides bicubic vs bilinear.
  float footprint = length(fwidth(uv)) * u_dye_res;
  InkSample ink = sampleInk(uv, footprint > 1.5 ? 1.0 : 0.0);
  float cover;
  vec3 col = shadeInk(ink, v_world, gl_FragCoord.xy, cover);

  // Macro normal from the displaced height field (world units).
  float e = 1.0 / u_sim_res;
  float ew = e * u_domain;
  vec4 hl = texture(u_height, uv - vec2(e, 0.0)), hr = texture(u_height, uv + vec2(e, 0.0));
  vec4 hd = texture(u_height, uv - vec2(0.0, e)), hu = texture(u_height, uv + vec2(0.0, e));
  float dx = (inkHeight(hr) - inkHeight(hl)) * u_height_scale + (hr.a - hl.a) * u_lift_scale;
  float dz = (inkHeight(hu) - inkHeight(hd)) * u_height_scale + (hu.a - hd.a) * u_lift_scale;
  vec3 n = normalize(vec3(-dx / (2.0 * ew), 1.0, -dz / (2.0 * ew)));

  // Micro normal from the sharp dye: filaments read as fine ridges.
  float de = 1.6 / u_dye_res;
  float fl = dot(texture(u_dye, uv - vec2(de, 0.0)).rg, vec2(1.0));
  float fr = dot(texture(u_dye, uv + vec2(de, 0.0)).rg, vec2(1.0));
  float fd = dot(texture(u_dye, uv - vec2(0.0, de)).rg, vec2(1.0));
  float fu = dot(texture(u_dye, uv + vec2(0.0, de)).rg, vec2(1.0));
  // Fade micro relief out when minified (aliasing) and when strongly magnified (banding).
  float microFade = (1.0 - smoothstep(0.8, 3.0, footprint)) * smoothstep(0.08, 0.45, footprint);
  n = normalize(n + vec3(-(fr - fl), 0.0, -(fu - fd)) * 0.5 * microFade);

  // Curvature tilts the surface normal away from (planet) or toward (bowl) the camera.
  vec2 rel = v_world - u_cam_pos.xz;
  n = normalize(n + vec3(2.0 * u_curve_k * rel.x, 0.0, 2.0 * u_curve_k * rel.y));

  vec3 L = normalize(u_light_dir);
  float diff = max(dot(n, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(n, H), 0.0), 140.0) * u_spec;
  float fres = pow(1.0 - max(dot(n, V), 0.0), 4.0);

  if (u_light == 1) {
    col *= mix(1.0, 0.94 + 0.09 * diff, cover);
    col += vec3(spec * 0.25 * cover);
  } else {
    col *= mix(1.0, 0.82 + 0.3 * diff, cover);
    col += mix(u_spark, u_ink_a, 0.3) * spec * cover * cover * 0.9;
    col += u_ink_a * fres * cover * 0.15;
  }

  float fog = smoothstep(u_fog.x, u_fog.y, dist);
  col = mix(col, u_fog_color, fog);
  frag = vec4(col, 1.0);
}
