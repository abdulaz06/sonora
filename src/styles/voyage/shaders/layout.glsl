// ── Voyage City layout, shared by the renderer (backdrop.glsl) and the height
// bake (heightbake.frag): hashes, the baked layout, aerial regions, city lots,
// building tops and the vegetation height read from the aerial imagery.
// Needs: u_land_tex, u_land_r, u_zspan, u_tex_aerial, u_tex.

vec2 cellHash(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 cellHash3(vec3 c) {
  return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}

float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i).x, b = cellHash(i + vec2(1, 0)).x, c = cellHash(i + vec2(0, 1)).x, d = cellHash(i + vec2(1, 1)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// ── City layout ──
vec4 landSample(vec2 q) {
  return texture(u_land_tex, vec2(q.x / (6.2831853 * u_land_r), q.y / u_zspan + 0.5));
}

// Aerial regions: a warped grid of parcels, each a crop of a real aerial tile at
// its own angle and offset (true scale: one tile spans AERIAL_SPAN units).
const float REGION = 30.0;
const float AERIAL_SPAN = 100.0;
const float VEG_H = 0.62;   // tallest trees (world units; a city block is ~4.2)
const float AERIAL_ALBEDO = 0.72;
struct Region { vec2 uv; float layer; float edge; };
Region region(vec2 q, float shore) {
  vec2 w = q + 7.0 * (vec2(vnoise(q * 0.031), vnoise(q * 0.031 + 17.0)) - 0.5);
  vec2 c = floor(w / REGION);
  vec2 f = w / REGION - c;
  vec3 h = cellHash3(vec3(c, 3.0));
  float a = h.x * 6.2831853;
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  Region r;
  r.uv = R * (q / AERIAL_SPAN) + h.yz * 7.3;
  r.layer = shore > 0.5 ? 3.0 : floor(h.y * 2.999);
  vec2 e = min(f, 1.0 - f);
  r.edge = min(e.x, e.y) * REGION;   // distance to the parcel's border (units)
  return r;
}

// Woods: the forest image at its own scale and angle per region.
vec2 forestUV(vec2 q) {
  vec2 c = floor(q / 44.0);
  float a = cellHash(c + 9.0).x * 6.2831853;
  return mat2(cos(a), -sin(a), sin(a), cos(a)) * (q / 70.0) + cellHash(c + 2.0) * 5.0;
}

// City blocks on a street grid; each block holds 2x2 lots, one building each:
// detached houses with pitched roofs at the edges, mid-rises, towers with setbacks in the core.
const float BLOCK = 4.2;
const float STREET = 0.62;
const float WALK = 0.16;    // pavement width inside the block edge
struct Lot { vec2 ll; float lot; float h; float hb; vec2 halfSz; vec2 hh; float base; float kind; bool ok; };
Lot lotAt(vec2 q, vec4 Lb, vec2 bc) {
  Lot L; L.ok = false;
  vec2 bl = q - bc * BLOCK;
  float inner = BLOCK - STREET;
  L.lot = inner * 0.5;
  vec2 il = bl - STREET * 0.5;
  if (Lb.b < 0.6 || Lb.g > 0.04 || cellHash(bc + 3.0).x < 0.09 || il.x < WALK || il.y < WALK || il.x > inner - WALK || il.y > inner - WALK) return L;
  vec2 li = min(floor(il / L.lot), vec2(1.0));
  L.ll = il - li * L.lot;
  L.hh = cellHash(bc * 2.0 + li + 5.0);
  float core = Lb.a;
  // kind: 0 house (pitched roof), 1 mid-rise, 2 tower.
  L.kind = core < 0.25 && L.hh.x < 0.7 ? 0.0 : (cellHash(bc * 3.0 + li).x > 0.9 - 0.2 * core ? 2.0 : 1.0);
  L.h = L.kind == 0.0 ? 0.32 + 0.18 * L.hh.y : L.kind == 1.0 ? 0.6 + L.hh.y * (0.8 + 2.4 * core) : 3.0 + 3.4 * L.hh.y * (0.5 + 0.5 * core);
  L.hb = L.kind == 2.0 ? L.h * 0.45 : L.h;
  L.base = Lb.r;
  float m = L.kind == 0.0 ? 0.28 : 0.14;
  L.halfSz = vec2(L.lot * 0.5 - m - 0.12 * L.hh.x, L.lot * 0.5 - m - 0.12 * L.hh.y);
  L.ok = true;
  return L;
}

// Building top height at q (0 off a building): the shadow and AO heightfield.
float buildingH(vec2 q) {
  vec2 bc = floor(q / BLOCK);
  vec4 Lb = landSample((bc + 0.5) * BLOCK);
  if (Lb.b < 0.6) return 0.0;
  Lot L = lotAt(q, Lb, bc);
  if (!L.ok) return 0.0;
  vec2 p = abs(L.ll - vec2(L.lot * 0.5));
  if (p.x > L.halfSz.x || p.y > L.halfSz.y) return 0.0;
  float top = L.hb;
  if (L.kind == 2.0 && p.x < L.halfSz.x * 0.62 && p.y < L.halfSz.y * 0.62) top = L.h;
  if (L.kind == 0.0) top += (L.halfSz.x > L.halfSz.y ? L.halfSz.y - p.y : L.halfSz.x - p.x) * 0.75;
  return L.base + top;
}

// Vegetation height: trees and hedgerows read from the aerial imagery in farmland,
// the forest canopy in woods (edges thinning, clearings), nothing in towns or water.
float vegHRaw(vec2 q, vec4 L) {
  if (u_tex < 0.01 || L.g > 0.5) return 0.0;
  float city = smoothstep(0.45, 0.6, L.b);
  float forest = (1.0 - city) * smoothstep(0.08, 0.5, L.a) * (1.0 - step(0.5, L.b));
  forest *= smoothstep(0.25, 0.55, vnoise(q * 0.09) + forest * 0.6);   // clearings and ragged edges
  float lift = 1.0 - smoothstep(1.3, 2.0, L.r);                        // trees thin out up the mountains
  Region r = region(q, step(0.05, L.g));
  float farm = textureLod(u_tex_aerial, vec3(r.uv, r.layer), 1.5).a;
  float wood = textureLod(u_tex_aerial, vec3(forestUV(q), 4.0), 1.5).a;
  return mix(farm * (1.0 - city), wood, forest) * VEG_H * lift * u_tex;
}

// Ground surface height (terrain, waterline, rock crags, vegetation), computed.
float groundHRaw(vec2 q, vec4 L) {
  float crag = smoothstep(1.4, 2.4, L.r) * (vnoise(q * 1.7) * 0.35 + vnoise(q * 4.3) * 0.15);
  return max(L.r, 0.0) + crag + vegHRaw(q, L);
}
