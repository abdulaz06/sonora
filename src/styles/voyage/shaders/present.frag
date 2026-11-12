#version 300 es
precision highp float;
// Present the resolved image to the scene target. On drops the screen folds
// into mirrored wedges (Kaleido) around a wandering centre; a slight radial
// chromatic split rides the bass.
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_aspect;
uniform float u_kaleido;      // 0 = straight ... 1 = fully folded
uniform float u_chroma;       // radial RGB split (uv)
uniform float u_segments;
uniform float u_rot;          // wedge rotation (rad)
uniform float u_src_rot;      // which slice of the image is mirrored
uniform vec2 u_center;        // fold centre (uv)
uniform float u_zoom;         // how much of the image a wedge shows
out vec4 frag;

vec3 samp(vec2 uv) {
  vec2 d = uv - 0.5;
  return vec3(texture(u_src, uv + d * u_chroma * 2.0).r, texture(u_src, uv).g, texture(u_src, uv - d * u_chroma * 2.0).b);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 straight = samp(uv);
  if (u_kaleido < 0.002) { frag = vec4(straight, 1.0); return; }
  vec2 p = (uv - u_center) * vec2(u_aspect, 1.0);
  float r = length(p);
  float seg = 6.2831853 / u_segments;
  float a = atan(p.y, p.x) + u_rot;
  a = mod(a, seg);
  a = abs(a - 0.5 * seg);
  a += u_src_rot;
  vec2 q = vec2(cos(a), sin(a)) * r * u_zoom;
  vec2 suv = 0.5 + q / vec2(u_aspect, 1.0);
  // Mirror at the image borders instead of clamping.
  suv = 1.0 - abs(1.0 - mod(suv, 2.0));
  vec3 c = samp(suv);
  c += texture(u_src, vec2(0.5)).rgb * 0.2 * exp(-r * r * 40.0);
  frag = vec4(mix(straight, c, u_kaleido), 1.0);
}
