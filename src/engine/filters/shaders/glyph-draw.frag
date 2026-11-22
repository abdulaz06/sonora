#version 300 es
precision highp float;
// Glyph filter, pass 2: every pixel draws its cell's glyph from the atlas in
// the cell's colour. Glyph ink is brightened by the glyph's coverage (hue
// kept) so the picture's overall level holds; a faint fill of the cell colour
// keeps the image readable between characters. Greys and whites take a little
// of the palette's highlight. Paper looks draw dark characters on paper.
uniform sampler2D u_state;
uniform sampler2D u_colour;
uniform sampler2D u_atlas;
uniform vec2 u_cell;
uniform float u_count;       // glyphs in the atlas
uniform float u_levels;      // density glyphs (the edge glyphs follow)
uniform float u_cov[24];     // ink coverage per glyph
uniform vec3 u_tint;         // palette highlight
uniform vec3 u_paper;
uniform float u_light;
uniform float u_fill;        // share of the cell colour behind the glyphs
uniform float u_pulse;       // bass-hit envelope: the characters answer each kick on the hit frame
out vec4 frag;

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 cellF = floor(p / u_cell);
  ivec2 cell = ivec2(cellF);
  vec2 f = (p - cellF * u_cell) / u_cell;
  vec4 st = texelFetch(u_state, cell, 0);
  vec3 c = texelFetch(u_colour, cell, 0).rgb;
  float idx = st.y > 0.5 ? u_levels + st.z : st.x;
  // Canvas rows run top-down; GL rows bottom-up.
  vec2 auv = vec2((idx + f.x) / u_count, 1.0 - f.y);
  vec2 gx = vec2(1.0 / (u_cell.x * u_count), 0.0), gy = vec2(0.0, 1.0 / u_cell.y);
  float m = textureGrad(u_atlas, auv, gx, gy).r;
  float cov = u_cov[int(idx + 0.5)];
  float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / (mx + 1e-3);
  if (u_light > 0.5) {
    // Ink characters on paper: the cell's own colour, darker, over a paper-lightened ground.
    // The ground keeps half of the cell's own tone, so local changes (a kick's shadow) still read.
    vec3 ground = mix(c, u_paper, 0.45);
    vec3 ink = c * mix(0.45, 0.7, sat) * (1.0 - 0.6 * u_pulse);   // only the ink darkens: the page never pulses
    frag = vec4(mix(ground, ink, m), 1.0);
    return;
  }
  float want = clamp((1.0 - u_fill) / max(cov, 0.06), 1.0, 2.6);
  float k = min(want, 1.0 / max(mx, 1e-3));   // brighten without clipping the hue
  vec3 g = c * k;
  // Past the hue's ceiling, strokes lift toward the palette's highlight (lit characters).
  float over = clamp(1.0 - k / want, 0.0, 1.0);
  vec3 hi = u_tint / max(max(u_tint.r, max(u_tint.g, u_tint.b)), 1e-3);
  g = mix(g, hi * max(g.r, max(g.g, g.b)), max(over * 0.55 * smoothstep(0.05, 0.4, mx), (1.0 - sat) * 0.35));
  // Dim cells keep more of their own tone (the palette's background stays), lit cells are mostly glyph.
  float fill = mix(u_fill * 3.0, u_fill, smoothstep(0.0, 0.2, cov));
  // Kicks lift dim strokes into fixed headroom (bright strokes stay as they are: no clipping).
  g = mix(g, max(g, min(g * 1.5, vec3(0.9))), u_pulse);
  frag = vec4(g * m + c * fill * (1.0 - m), 1.0);
}
