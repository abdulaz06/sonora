#version 300 es
precision highp float;
// Bloom prefilter: 4-tap box downsample + soft-knee threshold so only true
// highlights (HDR luminance above the threshold) feed the bloom chain.
uniform sampler2D u_src;
uniform vec2 u_texel;      // 1 / source size
uniform float u_threshold;
uniform float u_knee;
out vec4 frag;
void main() {
  vec2 uv = gl_FragCoord.xy * 2.0 * u_texel;
  vec3 c = 0.25 * (texture(u_src, uv + u_texel * vec2(-0.5, -0.5)).rgb
                 + texture(u_src, uv + u_texel * vec2( 0.5, -0.5)).rgb
                 + texture(u_src, uv + u_texel * vec2(-0.5,  0.5)).rgb
                 + texture(u_src, uv + u_texel * vec2( 0.5,  0.5)).rgb);
  float l = max(c.r, max(c.g, c.b));
  float soft = clamp(l - u_threshold + u_knee, 0.0, 2.0 * u_knee);
  soft = soft * soft / (4.0 * u_knee + 1e-4);
  float w = max(soft, l - u_threshold) / max(l, 1e-4);
  frag = vec4(c * w, 1.0);
}
