#version 300 es
precision highp float;
// Echo body pass: one bone of a dancer's body as a tapered capsule, written as
// a distance field (1 on the bone's axis, 0 at its surface). MAX blending joins
// every capsule into one smooth silhouette per frame; the display pass turns
// the field into a rim of light, a dim fill and a faint inner skeleton.
in vec2 v_px;
flat in vec4 v_seg;
flat in vec2 v_r;
flat in vec4 v_col;
out vec4 frag;
void main() {
  vec2 a = v_seg.xy, b = v_seg.zw;
  vec2 pa = v_px - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float r = max(mix(v_r.x, v_r.y, h), 1.0);
  float d = length(pa - ba * h);
  float f = clamp(1.0 - d / r, 0.0, 1.0);
  // Coverage with a pixel of anti-aliasing at the surface; v_col.a carries the figure's strength.
  float cov = clamp(r - d + 0.5, 0.0, 1.0);
  frag = vec4(f, cov, cov * v_col.a, 0.0);
}
