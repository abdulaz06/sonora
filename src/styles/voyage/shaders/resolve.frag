#version 300 es
precision highp float;
// Temporal upscale. The raymarch runs at a fraction of the scene resolution
// with a different sub-pixel jitter each frame; here each scene pixel takes
// the current low-res sample, reprojects last frame's resolved image through
// the hit depth and the previous camera, clamps it to the current
// neighbourhood (no ghosting) and blends. Pixels close to this frame's sample
// centre take more of it, so detail builds up to full resolution in a few
// frames.
uniform sampler2D u_cur;      // rgb + hit distance (low res)
uniform sampler2D u_hist;     // resolved last frame (scene res)
uniform vec2 u_res;
uniform vec2 u_low_res;
uniform vec2 u_jitter;        // this frame's jitter (low-res pixels)
uniform vec3 u_cam_pos;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform vec3 u_cam_fwd;
uniform float u_tan_half;
uniform vec3 u_prev_pos;
uniform vec3 u_prev_right;
uniform vec3 u_prev_up;
uniform vec3 u_prev_fwd;
uniform float u_prev_tan_half;
uniform float u_aspect;
uniform float u_reset;
uniform float u_blend;        // base history weight of the current frame
out vec4 frag;

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 lp = uv * u_low_res - u_jitter;          // in low-res texel space
  vec4 cur = texture(u_cur, lp / u_low_res);
  vec2 off = fract(lp) - 0.5;
  float close = exp(-dot(off, off) * 6.0);

  ivec2 ci = ivec2(floor(lp));
  ivec2 lim = ivec2(u_low_res) - 1;
  vec3 mn = vec3(1e9), mx = vec3(-1e9);
  float tmin = 1e9;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec4 s = texelFetch(u_cur, clamp(ci + ivec2(x, y), ivec2(0), lim), 0);
    mn = min(mn, s.rgb);
    mx = max(mx, s.rgb);
    tmin = min(tmin, s.a);
  }
  if (u_reset > 0.5) { frag = vec4(cur.rgb, 1.0); return; }

  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rd = normalize(u_cam_fwd + ndc.x * u_tan_half * u_aspect * u_cam_right + ndc.y * u_tan_half * u_cam_up);
  // Nearest depth in the neighbourhood keeps silhouettes from smearing.
  vec3 wp = u_cam_pos + rd * min(tmin, 200.0);
  vec3 v = wp - u_prev_pos;
  float z = dot(v, u_prev_fwd);
  vec2 pn = vec2(dot(v, u_prev_right) / (u_prev_tan_half * u_aspect), dot(v, u_prev_up) / u_prev_tan_half) / max(z, 1e-5);
  vec2 puv = pn * 0.5 + 0.5;
  bool valid = z > 1e-4 && all(greaterThanEqual(puv, vec2(0.0))) && all(lessThanEqual(puv, vec2(1.0)));
  vec3 h = texture(u_hist, puv).rgb;
  if (any(isnan(h)) || any(isinf(h))) { h = cur.rgb; valid = false; }
  vec3 pad = (mx - mn) * 0.1 + 0.002;
  h = clamp(h, mn - pad, mx + pad);
  float a = valid ? mix(u_blend, 0.6, close) : 1.0;
  // Brightening (beat pulses) is taken at once so hits land on the frame.
  float rise = dot(cur.rgb - h, vec3(0.299, 0.587, 0.114));
  a = max(a, clamp(rise * 6.0, 0.0, 0.9));
  frag = vec4(mix(h, cur.rgb, a), 1.0);
}
