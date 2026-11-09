#version 300 es
precision highp float;
// Dual-filter upsample; additively blended onto the next larger level.
uniform sampler2D u_src;
uniform vec2 u_texel; // 1 / source size
uniform vec2 u_dst_texel;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy * u_dst_texel;
  vec2 h = u_texel * 0.5;
  vec3 s = texture(u_src, uv + vec2(-h.x * 2.0, 0.0)).rgb;
  s += texture(u_src, uv + vec2(-h.x, h.y)).rgb * 2.0;
  s += texture(u_src, uv + vec2(0.0, h.y * 2.0)).rgb;
  s += texture(u_src, uv + vec2(h.x, h.y)).rgb * 2.0;
  s += texture(u_src, uv + vec2(h.x * 2.0, 0.0)).rgb;
  s += texture(u_src, uv + vec2(h.x, -h.y)).rgb * 2.0;
  s += texture(u_src, uv + vec2(0.0, -h.y * 2.0)).rgb;
  s += texture(u_src, uv + vec2(-h.x, -h.y)).rgb * 2.0;
  frag = vec4(s / 12.0, 1.0);
}
