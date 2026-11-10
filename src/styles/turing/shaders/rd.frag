#version 300 es
precision highp float;
// Gray-Scott reaction-diffusion step on a periodic grid.
//   state.r = U (substrate), state.g = V (activator)
uniform sampler2D u_state;
uniform vec2 u_texel;
uniform float u_feed;
uniform float u_kill;
uniform float u_dt;
// Seeds: uv.xy, radius (uv), shape (0 disc, 1 square)
uniform vec4 u_seeds[8];
uniform int u_seed_count;
// Text mask seeding: mask texture placed in a uv rectangle (x0, y0, w, h).
uniform sampler2D u_mask;
uniform vec4 u_mask_rect;
uniform float u_mask_on;
out vec4 frag;

void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec2 c = texture(u_state, uv).rg;
  vec2 lap = -c;
  lap += 0.2 * (texture(u_state, uv + vec2(u_texel.x, 0.0)).rg + texture(u_state, uv - vec2(u_texel.x, 0.0)).rg
              + texture(u_state, uv + vec2(0.0, u_texel.y)).rg + texture(u_state, uv - vec2(0.0, u_texel.y)).rg);
  lap += 0.05 * (texture(u_state, uv + u_texel).rg + texture(u_state, uv - u_texel).rg
               + texture(u_state, uv + vec2(u_texel.x, -u_texel.y)).rg + texture(u_state, uv + vec2(-u_texel.x, u_texel.y)).rg);
  float u = c.r, v = c.g;
  float uvv = u * v * v;
  float du = 1.0 * lap.r - uvv + u_feed * (1.0 - u);
  float dv = 0.5 * lap.g + uvv - (u_feed + u_kill) * v;
  u += du * u_dt;
  v += dv * u_dt;

  for (int i = 0; i < 8; i++) {
    if (i >= u_seed_count) break;
    vec2 d = uv - u_seeds[i].xy;
    d -= floor(d + 0.5);
    float r = u_seeds[i].z;
    float inside = u_seeds[i].w > 0.5 ? step(max(abs(d.x), abs(d.y)), r) : step(length(d), r);
    if (inside > 0.5) { u = 0.5; v = 0.25; }
  }
  if (u_mask_on > 0.5) {
    vec2 dm = uv - u_mask_rect.xy;
    dm -= floor(dm);   // periodic grid
    vec2 m = dm / u_mask_rect.zw;
    if (m.x >= 0.0 && m.y >= 0.0 && m.x <= 1.0 && m.y <= 1.0) {
      // Glyph strokes become stripes; a narrow moat around them is kept
      // clear so the word stays readable inside the maze.
      vec2 e = (5.0 * u_texel) / u_mask_rect.zw;
      float c0 = texture(u_mask, m).r;
      float n = 0.0;
      for (int k = 0; k < 8; k++) {
        float a = float(k) * 0.7854;
        n = max(n, texture(u_mask, m + vec2(cos(a), sin(a)) * e).r);
      }
      if (c0 > 0.5) { u = 0.5; v = 0.25; }
      else if (n > 0.5) { u = 1.0; v = 0.0; }
    }
  }
  frag = vec4(clamp(u, 0.0, 1.0), clamp(v, 0.0, 1.0), 0.0, 1.0);
}
