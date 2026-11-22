#version 300 es
precision highp float;
// Glyph filter, pass 1: one texel per character cell. Averages the cell's
// colour, measures its brightness and edge direction, and picks a glyph with
// hysteresis against the previous choice, so steady pictures never shimmer:
// the glyph only changes once the brightness has moved well past the band
// it was chosen in (and an edge glyph only appears / turns past a margin).
uniform sampler2D u_src;     // composited frame (display-referred)
uniform sampler2D u_prev;    // previous state (x level, y edge on, z edge bin, w brightness)
uniform vec2 u_cell;         // cell size (px)
uniform vec2 u_res;          // frame size (px)
uniform float u_levels;      // density glyphs (space first)
uniform float u_light;       // paper looks: density follows darkness
uniform float u_reset;       // 1: no history (first frame, new grid)
uniform float u_hyst;        // extra band (levels) before a glyph changes
uniform vec2 u_edge;         // edge strength to switch an edge glyph on / off
layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outColour;

float bright(vec3 c) {
  // Vivid colours count as bright (a full blue has little luma but should read).
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(luma, max(c.r, max(c.g, c.b)), 0.5);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 origin = vec2(cell) * u_cell;
  vec3 sum = vec3(0.0);
  float l = 0.0, r = 0.0, b = 0.0, t = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec2 f = (vec2(float(i), float(j)) + 0.5) / 4.0;
      vec3 c = texture(u_src, min(origin + f * u_cell, u_res - 0.5) / u_res).rgb;
      sum += c;
      float y = bright(c);
      if (i < 2) l += y; else r += y;
      if (j < 2) b += y; else t += y;
    }
  }
  vec3 col = sum / 16.0;
  float yb = bright(col);
  // A lifted curve: typical mid-tones reach the denser glyphs.
  float lev = clamp(pow((u_light > 0.5 ? 1.0 - yb : yb) * 1.3, 0.72), 0.0, 1.0);
  // Gradient across the cell (halves), normalised by the local level.
  vec2 g = vec2(r - l, t - b) / 8.0;
  float strength = length(g) / (0.08 + yb);

  vec4 prev = texelFetch(u_prev, cell, 0);
  // A fixed per-cell offset (never changes over time): flat areas mix
  // neighbouring glyphs instead of repeating one character.
  float dither = fract(sin(dot(vec2(cell), vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  float x = clamp(clamp(lev, 0.0, 1.0) * (u_levels - 1.0) + dither * 0.7 * step(0.02, lev), 0.0, u_levels - 1.0);
  float glyph = prev.x;
  if (u_reset > 0.5 || abs(x - glyph) > 0.5 + u_hyst) glyph = floor(x + 0.5);

  // Edge glyph: on above u_edge.x, off below u_edge.y; only where there's light to draw.
  float edgeOn = prev.y;
  if (u_reset > 0.5) edgeOn = 0.0;
  if (strength > u_edge.x && lev > 0.18) edgeOn = 1.0;
  else if (strength < u_edge.y || lev < 0.1) edgeOn = 0.0;
  // Edge line direction (perpendicular to the gradient), in four bins of 45°.
  float a = atan(g.x, -g.y);                 // line angle
  a = mod(a, 3.14159265);
  float binF = a / 0.78539816;               // 0..4
  float bin = prev.z;
  float dist = abs(mod(binF - bin + 2.0, 4.0) - 2.0);
  if (u_reset > 0.5 || prev.y < 0.5 || dist > 0.5 + 0.18) bin = mod(floor(binF + 0.5), 4.0);

  outState = vec4(glyph, edgeOn, bin, yb);
  outColour = vec4(col, 1.0);
}
