#version 300 es
precision highp float;
precision highp sampler2DArray;
// Bakes Voyage City's full height field once (and again when the textures
// arrive), on the same wrap as the layout bake (x = around, y = along):
//   r = ground height (terrain, crags, vegetation from the aerial imagery)
//   g = shadow height (r with building tops)
//   b = vegetation height alone
// The renderer then reads one texel where it would recompute all of it per
// march step, shadow tap and AO tap.
uniform vec2 u_size;
uniform float u_land_r;
uniform float u_zspan;
uniform sampler2D u_land_tex;
uniform sampler2DArray u_tex_aerial;
uniform float u_tex;
out vec4 frag;
//#include layout

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  vec2 q = vec2(uv.x * 6.2831853 * u_land_r, (uv.y - 0.5) * u_zspan);
  vec4 L = landSample(q);
  float veg = vegHRaw(q, L);
  float g = groundHRaw(q, L);
  frag = vec4(g, max(g, L.b > 0.5 ? buildingH(q) : 0.0), veg, 0.0);
}
