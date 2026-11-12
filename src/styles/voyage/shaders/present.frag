#version 300 es
precision highp float;
// Present the resolved image to the scene target with a slight radial
// chromatic split that rides the bass.
uniform sampler2D u_src;
uniform vec2 u_res;
uniform float u_chroma;       // radial RGB split (uv)
out vec4 frag;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 d = uv - 0.5;
  frag = vec4(texture(u_src, uv + d * u_chroma * 2.0).r, texture(u_src, uv).g, texture(u_src, uv - d * u_chroma * 2.0).b, 1.0);
}
