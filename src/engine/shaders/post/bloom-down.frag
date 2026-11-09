#version 300 es
precision highp float;
// Dual-filter (Kawase) downsample.
uniform sampler2D u_src;
uniform vec2 u_texel; // 1 / source size
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy * 2.0 * u_texel;
  vec3 s = texture(u_src, uv).rgb * 4.0;
  s += texture(u_src, uv - u_texel).rgb;
  s += texture(u_src, uv + u_texel).rgb;
  s += texture(u_src, uv + vec2(u_texel.x, -u_texel.y)).rgb;
  s += texture(u_src, uv - vec2(u_texel.x, -u_texel.y)).rgb;
  frag = vec4(s / 8.0, 1.0);
}
