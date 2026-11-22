#version 300 es
precision highp float;
// Soft capsule: a bright core along the bone with a falloff glow; premultiplied
// colour + coverage (the display pass composites on black or on paper).
in vec2 v_px;
flat in vec4 v_seg;
flat in vec2 v_r;
flat in vec4 v_col;
uniform float u_glow;
uniform float u_light;           // paper: coverage only from the core
out vec4 frag;
void main() {
  vec2 a = v_seg.xy, b = v_seg.zw;
  vec2 pa = v_px - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  float r = mix(v_r.x, v_r.y, h);
  float d = length(pa - ba * h);
  float core = smoothstep(r + 1.0, r - 1.0, d);
  float glow = exp(-max(d - r, 0.0) / max(r * u_glow, 1.0)) * v_col.a;
  // Paper: a_col.a is the copy's opacity (echoes are translucent and blend into trails).
  if (u_light > 0.5) {
    float a = clamp(core * v_col.a + exp(-max(d - r, 0.0) / max(r * 0.8, 1.0)) * v_col.a * 0.12, 0.0, 1.0);
    frag = vec4(v_col.rgb * a, a);
    return;
  }
  float k = core + glow * 0.6;
  frag = vec4(v_col.rgb * k, min(k, 1.0));
}
