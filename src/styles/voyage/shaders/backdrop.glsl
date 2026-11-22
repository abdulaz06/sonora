// ── Voyage backdrops (injected at //#include backdrop) ─────────────────
// u_backdrop: 0 Void (stars), 1 City (a lived-in world), 2 Ocean.
// City and Ocean live on the inside of a cylinder (axis z through
// (0, u_land_cy), radius u_land_r), unrolled into q = (around, along) and
// "up" = height above the mean surface toward the axis. Backdrops never react
// to beats; only light does.
//
// 1.1 (D89): realistic materials, the palette in the light. Land, rock, snow
// and water keep natural colours; the palette tints the sun, the sky light,
// the haze, the city lights, reflections and glints, like time-of-day grading.
// City farmland, woods and towns are real aerial imagery (USGS NAIP) laid out
// in regions of the baked layout, with tree and hedgerow relief read from the
// imagery; tiled materials (Poly Haven, ambientCG) add detail up close
// (ASSETS.md). Lighting: GGX, soft shadows marched through the heightfield
// (buildings and canopies included), horizon AO, single-scattering haze.
// Water: Gerstner wave bands, Fresnel sky reflection, light through thin
// crests, foam where waves fold or meet the shore, depth colour, sun glints.

// Quality: 0 low, 1 medium, 2 high (shadow and AO taps, hex tiling).
// Sun direction at a point: toward the axis blended with the end-cap sun (~45°: long, soft shadows).
#define SUN_UP 0.72
#define SUN_ALONG 0.72
#define Q u_q

float fbm2(vec2 q) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(vec3(q, 3.7 * float(i))); q = q * 2.07 + 1.3; a *= 0.5; }
  return v;
}

//#include layout

// The baked height field (heightbake.frag; once per City visit, again when the
// textures arrive): r ground + vegetation, g with building tops, b vegetation.
vec4 heightSample(vec2 q) {
  return texture(u_height_tex, vec2(q.x / (6.2831853 * u_land_r), q.y / u_zspan + 0.5));
}
float vegH(vec2 q, vec4 L) { return u_hbaked > 0.5 ? heightSample(q).b : vegHRaw(q, L); }
float groundH(vec2 q, vec4 L) { return u_hbaked > 0.5 ? heightSample(q).r : groundHRaw(q, L); }

// ── Light: the palette lives here ──
vec3 normPeak(vec3 c) { return c / max(max(c.r, max(c.g, c.b)), 1e-3); }
// The sun takes the highlight's hue over a warm white.
vec3 sunColour() { return mix(vec3(1.0, 0.93, 0.82), normPeak(u_c3), 0.5) * 2.6; }
// Sky light (and the haze it fills): the core colours over a pale blue, at a fixed luminance.
vec3 skyColour() {
  vec3 t = keepChroma(u_c0, u_c1, 0.45);
  t = t * clamp(0.5 / max(dot(t, LUMA), 1e-3), 0.0, 3.0);
  return mix(vec3(0.45, 0.56, 0.72), t, 0.62) * 0.62;
}
// City lights: the accent over a sodium-warm white.
vec3 lampColour() { return mix(vec3(1.0, 0.72, 0.42), normPeak(u_c2), 0.45); }

// Air along a view direction: sky light plus forward-scattered sun (Henyey-Greenstein) and the sun itself.
vec3 atmosphere(vec3 rd) {
  float mu = dot(rd, u_sun);
  const float G = 0.7;
  float hg = (1.0 - G * G) / pow(1.0 + G * G - 2.0 * G * mu, 1.5) * 0.035;
  vec3 c = skyColour() * (0.82 + 0.3 * rd.z * sign(u_sun.z));
  c += sunColour() * (hg * 0.55 + pow(max(mu, 0.0), 600.0) * 5.0 + pow(max(mu, 0.0), 24.0) * 0.18);
  return c;
}

// Schlick Fresnel and GGX (D, Smith-Schlick G), for water, glass and wet rock.
float fresnel(float cosT, float f0) { return f0 + (1.0 - f0) * pow(1.0 - clamp(cosT, 0.0, 1.0), 5.0); }
float ggx(vec3 n, vec3 v, vec3 l, float rough) {
  vec3 h = normalize(v + l);
  float a = rough * rough, a2 = a * a;
  float nh = max(dot(n, h), 0.0), nv = max(dot(n, v), 1e-3), nl = max(dot(n, l), 0.0);
  float d = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
  float k = (rough + 1.0) * (rough + 1.0) / 8.0;
  float g = (nv / (nv * (1.0 - k) + k)) * (nl / (nl * (1.0 - k) + k));
  return d * g / (4.0 * nv) ;   // × NL is inside g; caller multiplies by F and the light
}

// ── Void: a dark sky tinted by the accent, full of stars ──
vec3 voidBase(vec3 rd) {
  float h = rd.y * 0.5 + 0.5;
  vec3 col = mix(u_bg * 0.45 + u_c2 * 0.02, u_bg * 0.7 + u_c2 * 0.09, smoothstep(0.0, 1.0, h));
  float n = snoise(rd * 1.7 + 3.0) * 0.6 + snoise(rd * 3.9 - 1.0) * 0.3;
  float n2 = snoise(rd * 2.6 + 9.0);
  // Nebula in the core colours (an RGB mix of the accent and a distant
  // secondary lands on a hue the palette doesn't have).
  col += keepChroma(u_c1, u_c0, smoothstep(-0.4, 0.4, n2)) * pow(max(n, 0.0), 2.2) * 0.16;
  return col;
}

vec3 starLayer(vec3 rd, float scale, float pix, float density, float bright) {
  vec3 p = rd * scale;
  vec3 c = floor(p);
  vec3 h = cellHash3(c);
  if (h.x > density) return vec3(0.0);
  vec3 sp = c + 0.25 + 0.5 * cellHash3(c + 17.0);
  float d = length(p - sp) / scale;                 // angular distance
  float size = max(0.0012 * (0.4 + h.y), pix * 0.9);
  float tw = 0.75 + 0.25 * sin(u_time * (1.0 + 3.0 * h.z) + h.y * 40.0);
  float b = exp(-(d * d) / (size * size)) * bright * tw * (0.35 + 0.65 * h.y) * min(1.0, 0.0012 / size + 0.3);
  vec3 tint = h.z < 0.3 ? mix(vec3(1.0), u_c2, 0.45) : h.z < 0.85 ? vec3(1.0) : vec3(1.0, 0.85, 0.7);
  return tint * b;
}

vec3 voidSky(vec3 rd, float pix) {
  vec3 col = voidBase(rd);
  col += starLayer(rd, 40.0, pix, 0.05, 3.0);
  col += starLayer(rd, 90.0, pix, 0.06, 1.6);
  col += starLayer(rd, 200.0, pix, 0.035, 0.8);
  return col;
}


// ── Cylinder helpers ──
float cylExit(vec3 ro, vec3 rd, float r) {
  vec2 o = ro.xy - vec2(0.0, u_land_cy);
  vec2 d = rd.xy;
  float a = dot(d, d);
  if (a < 1e-6) return -1.0;
  float b = dot(o, d), c = dot(o, o) - r * r;
  float disc = b * b - a * c;
  if (disc < 0.0) return -1.0;
  return (-b + sqrt(disc)) / a;
}

vec3 unroll(vec3 p) {
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  return vec3(atan(rel.x, -rel.y) * u_land_r, u_land_r - length(rel), p.z);
}

float sdBox(vec3 p, vec3 b) { vec3 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0); }

float sdCity(vec3 pu, out vec4 info) {
  info = vec4(0.0);
  vec2 q = pu.xz;
  vec2 bc = floor(q / BLOCK);
  vec2 bl = q - bc * BLOCK;
  float toBlock = min(min(bl.x, BLOCK - bl.x), min(bl.y, BLOCK - bl.y));
  vec4 Lb = landSample((bc + 0.5) * BLOCK);
  if (Lb.b < 0.6 || Lb.g > 0.04 || cellHash(bc + 3.0).x < 0.09) return toBlock + 0.05;
  float inner = BLOCK - STREET;
  vec2 il = bl - STREET * 0.5;
  if (il.x < 0.0 || il.y < 0.0 || il.x > inner || il.y > inner) {
    vec2 dd = max(max(-il, il - inner), 0.0);
    return max(length(dd), 0.02);
  }
  Lot L = lotAt(q, Lb, bc);
  float lot = inner * 0.5;
  vec2 li = min(floor(il / lot), vec2(1.0));
  vec2 ll = il - li * lot;
  float toLot = min(min(ll.x, lot - ll.x), min(ll.y, lot - ll.y));
  if (!L.ok) return toLot + 0.03;
  vec2 ctr = vec2(lot * 0.5);
  vec3 p1 = vec3(ll.x - ctr.x, pu.y - L.base - L.hb * 0.5, ll.y - ctr.y);
  float db = sdBox(p1, vec3(L.halfSz.x, L.hb * 0.5, L.halfSz.y));
  if (L.kind == 0.0) {
    // Pitched roof: a prism over the house, ridge along its longer side.
    vec3 pr = vec3(p1.x, pu.y - L.base - L.hb, p1.z);
    bool alongX = L.halfSz.x > L.halfSz.y;
    float w = alongX ? L.halfSz.y : L.halfSz.x;
    float across = alongX ? abs(pr.z) : abs(pr.x);
    float len = alongX ? abs(pr.x) - L.halfSz.x : abs(pr.z) - L.halfSz.y;
    float rh = w * 0.75;
    float roof = max(max((across * rh / w + pr.y - rh) * 0.8, -pr.y), len);
    db = min(db, roof);
  } else if (L.kind == 2.0) {
    vec3 p2 = vec3(p1.x, pu.y - L.base - L.h * 0.5, p1.z);
    db = min(db, sdBox(p2, vec3(L.halfSz.x * 0.62, L.h * 0.5, L.halfSz.y * 0.62)));
  } else if (L.hh.y > 0.55) {
    // Rooftop plant room on mid-rises.
    vec3 p3 = vec3(p1.x + L.halfSz.x * 0.3, pu.y - L.base - L.hb - 0.06, p1.z - L.halfSz.y * 0.2);
    db = min(db, sdBox(p3, vec3(L.halfSz.x * 0.25, 0.06, L.halfSz.y * 0.25)));
  }
  info = vec4(L.h, L.hh.x, L.hh.y, L.base + L.kind * 100.0);
  return min(db, toLot + 0.03);
}

// Everything that casts shadows (ground, vegetation, buildings).
float shadowH(vec2 q) {
  if (u_hbaked > 0.5) return heightSample(q).g;
  vec4 L = landSample(q); return max(groundHRaw(q, L), L.b > 0.5 ? buildingH(q) : 0.0);
}

// Soft shadow marched through the heightfield toward the sun (unrolled frame).
float softShadow(vec3 pu, vec3 Lu, float maxT) {
  int n = Q == 2 ? 14 : Q == 1 ? 8 : 0;
  if (n == 0) return 1.0;
  float res = 1.0, t = 0.08;
  for (int i = 0; i < 14; i++) {
    if (i >= n || t > maxT) break;
    vec3 p = pu + Lu * t;
    float d = p.y - shadowH(p.xz);
    res = min(res, clamp(10.0 * d / t, 0.0, 1.0));
    if (res < 0.02) break;
    t *= Q == 2 ? 1.38 : 1.7;
  }
  return res * res * (3.0 - 2.0 * res);
}

// Horizon occlusion from the heightfield around q.
float heightAO(vec2 q, float h0) {
  int n = Q == 2 ? 6 : Q == 1 ? 4 : 0;
  if (n == 0) return 1.0;
  float occ = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    float a = float(i) * 6.2831853 / float(n) + 0.4;
    float r = 0.35 + 0.5 * float(i & 1);
    vec2 d = vec2(cos(a), sin(a)) * r;
    occ += clamp((shadowH(q + d) - h0) / r, 0.0, 1.2);
  }
  return clamp(1.0 - occ / float(n) * 0.9, 0.25, 1.0);
}

// Hex-tiled sampling of a tiled material (three rotated, offset lookups blended),
// so nothing visibly repeats; one lookup on Low / Medium.
vec4 hexTex(vec2 uv, float layer) {
  if (Q < 2) return texture(u_tex_detail, vec3(uv, layer));
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  const mat2 sk = mat2(1.0, 0.0, -0.57735027, 1.15470054);
  vec2 s = sk * uv * 3.4641016;
  vec2 b = floor(s), f = fract(s);
  vec3 w = vec3(f.x, f.y, 1.0 - f.x - f.y);
  vec2 v1, v2, v3;
  if (w.z > 0.0) { v1 = b; v2 = b + vec2(0, 1); v3 = b + vec2(1, 0); w = vec3(w.z, w.y, w.x); }
  else { v1 = b + 1.0; v2 = b + vec2(1, 0); v3 = b + vec2(0, 1); w = vec3(-w.z, 1.0 - w.y, 1.0 - w.x); }
  vec4 acc = vec4(0.0); float wt = 0.0;
  vec2 vs[3] = vec2[3](v1, v2, v3);
  for (int i = 0; i < 3; i++) {
    vec2 h = cellHash(vs[i]);
    float a = h.x * 6.2831853;
    mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
    vec4 c = textureGrad(u_tex_detail, vec3(R * uv + h * 7.0, layer), R * dx, R * dy);
    float wi = pow(w[i], 6.0);
    acc += c * wi; wt += wi;
  }
  return acc / max(wt, 1e-4);
}

// Procedural farmland for when the textures aren't there yet (first moments, or
// they failed to load): irregular plots in muted crop colours.
vec3 fallbackFields(vec2 q) {
  Region r = region(q, 0.0);
  vec2 g = r.uv * 18.0;
  vec2 c = floor(g * vec2(1.0, 0.45));
  vec2 h = cellHash(c);
  vec3 crops[5] = vec3[5](vec3(0.25, 0.3, 0.13), vec3(0.46, 0.41, 0.25), vec3(0.36, 0.28, 0.18), vec3(0.3, 0.36, 0.16), vec3(0.52, 0.48, 0.32));
  return crops[int(h.x * 4.99)] * (0.85 + 0.3 * h.y);
}

// ── City ground: albedo, roughness, and whether it's water ──
struct Ground { vec3 alb; float wet; float water; float depth; float shore; };
Ground cityGround(vec2 q, vec4 L, float fp, vec3 nIn, vec3 nn) {
  Ground G;
  float close = 1.0 - smoothstep(0.03, 0.25, fp);    // detail fades with the pixel footprint
  float city = L.b;
  // Water: g 1 = open water, 0.05-0.5 shore (closeness).
  G.water = smoothstep(0.5, 0.58, L.g);   // the bake: shore 0.05-0.5, water above
  G.depth = clamp((-L.r - 0.1) / 0.6, 0.0, 1.0) * G.water;
  G.shore = smoothstep(0.05, 0.4, L.g) * (1.0 - G.water);
  G.wet = 0.0;
  float slope = 1.0 - clamp(dot(nn, nIn), 0.0, 1.0);
  float hT = L.r;
  vec3 col;
  if (u_tex > 0.01) {
    Region r = region(q, step(0.05, L.g));
    // Aerial photos are exposed for viewing: scaled to real ground albedo (fields ~0.2).
    vec3 farm = texture(u_tex_aerial, vec3(r.uv, r.layer)).rgb * AERIAL_ALBEDO;
    // Parcel borders: a country lane with a hedge (hides where two crops meet).
    float lane = 1.0 - smoothstep(0.1, 0.22, r.edge);
    vec3 laneCol = vec3(0.46, 0.43, 0.38) * (0.9 + 0.2 * vnoise(q * 9.0));
    farm = mix(farm, laneCol, lane * (1.0 - G.shore));
    // Woods: the canopy image.
    float forest = (1.0 - step(0.5, city)) * smoothstep(0.08, 0.5, L.a);
    forest *= smoothstep(0.25, 0.55, vnoise(q * 0.09) + forest * 0.6);
    vec3 wood = texture(u_tex_aerial, vec3(forestUV(q), 4.0)).rgb * AERIAL_ALBEDO;
    col = mix(farm, wood, forest);
    // Up close: the material's own grain (grass on green, soil on brown).
    float green = smoothstep(-0.02, 0.06, col.g - col.r);
    vec4 dg = hexTex(q * 0.55, 0.0), ds = hexTex(q * 0.5, 1.0);
    float rel = mix(ds.a, dg.a, green) - 0.5;
    col *= 1.0 + rel * 0.7 * close;
  } else col = fallbackFields(q);
  // Mountains: grass slopes, rock (triplanar on steep faces), snow on the tops.
  float rock = max(smoothstep(1.6, 2.3, hT), smoothstep(0.35, 0.6, slope) * smoothstep(0.8, 1.4, hT));
  if (rock > 0.01) {
    vec3 rc = u_tex > 0.01 ? mix(texture(u_tex_detail, vec3(q * 0.22, 2.0)).rgb, texture(u_tex_detail, vec3(vec2(q.x, hT * 4.0) * 0.22, 2.0)).rgb, slope) : vec3(0.4, 0.38, 0.35);
    col = mix(col, rc * 1.1, rock);
  }
  float snow = smoothstep(3.0, 3.6, hT + 0.4 * vnoise(q * 0.5)) * (1.0 - smoothstep(0.55, 0.75, slope));
  if (snow > 0.01) col = mix(col, u_tex > 0.01 ? texture(u_tex_detail, vec3(q * 0.3, 3.0)).rgb * 1.05 : vec3(0.85, 0.87, 0.9), snow);
  // Shores: sand, wet near the water line.
  float sand = G.shore * (1.0 - step(0.5, city)) * smoothstep(0.35, 0.55, L.g);
  if (sand > 0.01) {
    vec3 sc = u_tex > 0.01 ? texture(u_tex_detail, vec3(q * 0.4, 4.0)).rgb : vec3(0.72, 0.66, 0.52);
    sc = mix(sc, vec3(dot(sc, LUMA)) * vec3(1.06, 1.0, 0.88), 0.55);   // pale, not orange
    col = mix(col, sc, sand);
    G.wet = sand * smoothstep(0.3, 0.5, L.g);
    col *= 1.0 - 0.35 * G.wet;
  }
  // Towns: streets (asphalt, lane markings, crossings), pavements, parks.
  if (city > 0.5) {
    vec2 bl = mod(q, BLOCK);
    float e = min(min(bl.x, BLOCK - bl.x), min(bl.y, BLOCK - bl.y));
    float street = 1.0 - step(STREET * 0.5, e);
    float walk = step(STREET * 0.5, e) * (1.0 - step(STREET * 0.5 + WALK, e));
    vec3 asph = u_tex > 0.01 ? hexTex(q * 0.7, 5.0).rgb * 0.8 : vec3(0.13);
    vec3 pave = vec3(0.52, 0.51, 0.49) * (0.92 + 0.12 * vnoise(q * 6.0));
    // Centre lines (dashed) and zebra crossings near the junctions.
    vec2 sc = mod(q + BLOCK * 0.5, BLOCK) - BLOCK * 0.5;
    float centre = (step(abs(sc.x), 0.012) * step(0.5, fract(q.y * 1.2)) + step(abs(sc.y), 0.012) * step(0.5, fract(q.x * 1.2))) * close;
    vec2 jd = abs(sc);
    float zebra = step(jd.x, STREET * 0.5) * step(jd.y, STREET * 0.5 + 0.14) * step(STREET * 0.5, jd.y) * step(0.5, fract(q.x * 8.0)) * close
                + step(jd.y, STREET * 0.5) * step(jd.x, STREET * 0.5 + 0.14) * step(STREET * 0.5, jd.x) * step(0.5, fract(q.y * 8.0)) * close;
    vec3 ground = mix(pave, asph + vec3(0.6) * min(1.0, centre + zebra) * 0.8, street);
    ground = mix(ground, pave * 1.08, walk);
    vec2 bc = floor(q / BLOCK);
    if (cellHash(bc + 3.0).x < 0.09) {
      // Park: lawn and trees from the forest image.
      vec3 lawn = (u_tex > 0.01 ? hexTex(q * 0.55, 0.0).rgb : vec3(0.22, 0.32, 0.14)) * vec3(0.85, 1.0, 0.8);
      ground = mix(ground, lawn, (1.0 - street) * (1.0 - walk));
    }
    col = mix(col, ground, smoothstep(0.5, 0.7, city));
  }
  G.alb = col;
  return G;
}

// Gerstner-style waves on the unrolled surface: heights, normal, folding (foam).
// Bands: (direction angle, wavelength, amplitude, steepness).
vec4 waveBand(int i, float scale) {
  // Two swell trains down the axis, then wind waves and chop across.
  vec4 w[8] = vec4[8](vec4(0.08, 34.0, 1.7, 0.55), vec4(-0.28, 19.0, 0.85, 0.6), vec4(0.42, 11.0, 0.42, 0.7), vec4(-0.65, 6.3, 0.2, 0.75),
                      vec4(0.95, 3.7, 0.1, 0.8), vec4(-1.2, 2.2, 0.055, 0.8), vec4(1.6, 1.3, 0.03, 0.8), vec4(-0.4, 0.8, 0.018, 0.8));
  vec4 b = w[i];
  return vec4(b.x, b.y * scale, b.z * scale, b.w);
}
// Height with the horizontal (Gerstner) displacement undone once, so crests sharpen.
float waveH(vec2 q, int n, float scale) {
  vec2 p = q;
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    vec4 b = waveBand(i, scale);
    vec2 d = vec2(sin(b.x), cos(b.x));
    float k = 6.2831853 / b.y, c = sqrt(9.8 * k) * 0.35;
    p -= d * (b.w / k) * cos(k * dot(d, q) - c * u_time) * 0.8;
  }
  float h = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    vec4 b = waveBand(i, scale);
    vec2 d = vec2(sin(b.x), cos(b.x));
    float k = 6.2831853 / b.y, c = sqrt(9.8 * k) * 0.35;
    h += b.z * sin(k * dot(d, p) - c * u_time);
  }
  return h;
}
// Folding: where the horizontal squeeze of the waves exceeds the surface (Jacobian < 1).
float waveFold(vec2 q, int n, float scale) {
  float j = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= n) break;
    vec4 b = waveBand(i, scale);
    vec2 d = vec2(sin(b.x), cos(b.x));
    float k = 6.2831853 / b.y, c = sqrt(9.8 * k) * 0.35;
    j += b.w * sin(k * dot(d, q) - c * u_time) * min(1.0, b.z * k * 1.4);
  }
  return j;
}

// Shading for any water surface. n: normal; depth 0 shallow … 1 deep; crest: wave height factor.
vec3 shadeWater(vec3 n, vec3 rd, vec3 Lw, float depth, float crest, float foam, float fp, float shadow) {
  vec3 v = -rd;
  float nv = max(dot(n, v), 0.0);
  float F = fresnel(nv, 0.02);
  vec3 sun = sunColour();
  vec3 sky = skyColour();
  vec3 refl = atmosphere(reflect(rd, n));
  // Body colour: blue-green, lighter and greener in the shallows.
  vec3 deep = vec3(0.01, 0.05, 0.07), shallow = vec3(0.035, 0.17, 0.16);
  vec3 body = mix(shallow, deep, depth);
  body *= sky * 1.3 + sun * max(dot(n, Lw), 0.0) * 0.4 * shadow;
  // Light through thin crests: strongest looking toward the sun.
  float back = pow(clamp(dot(rd, Lw) * 0.5 + 0.5, 0.0, 1.0), 3.0);
  vec3 sss = vec3(0.05, 0.3, 0.25) * sun * crest * (0.25 + 0.75 * back) * shadow * 0.35;
  vec3 col = mix(body + sss, refl, F);
  // Sun glint: GGX, rougher with distance (the ripples average out).
  float rough = clamp(0.13 + fp * 1.6, 0.13, 0.5);
  col += sun * min(ggx(n, v, Lw, rough), 40.0) * fresnel(max(dot(normalize(v + Lw), v), 0.0), 0.02) * shadow * 0.8;
  // Foam: white, lit, slightly see-through at its edges.
  vec3 foamCol = vec3(0.86, 0.89, 0.9) * (sky * 1.1 + sun * max(dot(n, Lw), 0.2) * 0.5 * shadow);
  return mix(col, foamCol, foam);
}

// ── City world ──
vec3 cityWorld(vec3 ro, vec3 rd, float pix, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  float tGround = cylExit(ro, rd, u_land_r + 0.8);
  if (tGround < 0.0) return atm;
  const float HMAX = 7.0;
  float tIn = max(cylExit(ro, rd, u_land_r - HMAX), 0.0);
  float t = tIn;
  int mat = 0;
  vec4 binfo = vec4(0.0);
  vec3 pu = vec3(0.0);
  vec4 L = vec4(0.0);
  for (int i = 0; i < 112; i++) {
    if (i >= u_land_steps || t > tGround) break;
    pu = unroll(ro + rd * t);
    L = landSample(pu.xz);
    float dG = (pu.y - groundH(pu.xz, L)) * 0.45;
    vec4 inf = vec4(0.0);
    float dB = L.b > 0.25 ? sdCity(pu, inf) : 1e3;
    float d = min(dG, dB);
    float eps = max(pix * t * 0.6, 0.004);
    if (d < eps) { mat = dB < dG ? 2 : 1; binfo = inf; break; }
    t += max(d, eps * 0.5);
  }
  if (mat == 0) {
    float tg = cylExit(ro, rd, u_land_r);
    if (tg < 0.0) return atm;
    t = tg; pu = unroll(ro + rd * t); L = landSample(pu.xz); mat = 1;
  }
  vec3 p = ro + rd * t;
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  vec3 nIn = normalize(vec3(-rel, 0.0));
  vec3 tA = normalize(vec3(-rel.y, rel.x, 0.0));
  vec3 zA = vec3(0.0, 0.0, 1.0);
  // Light comes from the axis (as in a habitat) blended with the end-cap sun.
  vec3 Ls = normalize(nIn * SUN_UP + u_sun * SUN_ALONG);
  vec3 Lu = vec3(dot(Ls, tA), dot(Ls, nIn), Ls.z);   // in the unrolled frame
  float fp = pix * t;
  vec3 sun = sunColour(), sky = skyColour();
  vec3 col;
  if (mat == 2) {
    vec4 inf;
    float e = 0.01;
    vec3 gu = vec3(sdCity(pu + vec3(e, 0, 0), inf) - sdCity(pu - vec3(e, 0, 0), inf),
                   sdCity(pu + vec3(0, e, 0), inf) - sdCity(pu - vec3(0, e, 0), inf),
                   sdCity(pu + vec3(0, 0, e), inf) - sdCity(pu - vec3(0, 0, e), inf));
    vec3 nu = normalize(gu + vec3(0.0, 1e-6, 0.0));
    vec3 n = normalize(tA * nu.x + nIn * nu.y + zA * nu.z);
    float kind = floor(binfo.w / 100.0), base = binfo.w - kind * 100.0;
    bool roof = nu.y > 0.6;
    // Materials: concrete, brick, sandstone, white render, glass curtain wall.
    float mh = binfo.y;
    vec3 wall = mh < 0.3 ? vec3(0.5, 0.49, 0.47) : mh < 0.52 ? vec3(0.42, 0.24, 0.17) : mh < 0.72 ? vec3(0.62, 0.53, 0.4) : mh < 0.86 ? vec3(0.74, 0.73, 0.7) : vec3(0.06, 0.08, 0.1);
    float glass = step(0.86, mh) * step(0.5, kind);
    float side = abs(nu.x) > abs(nu.z) ? pu.z : pu.x;
    vec2 wg = vec2(side * (kind == 0.0 ? 4.0 : 6.0), (pu.y - base) * (kind == 0.0 ? 6.0 : 8.0));
    vec2 wf = fract(wg);
    float win = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.28, wf.y) * step(wf.y, 0.82);
    float dW = 1.0 - smoothstep(0.02, 0.09, fp);
    float lit = step(0.72, cellHash(floor(wg) + binfo.yz * 91.0).x);
    vec3 alb;
    float rough = 0.85, f0 = 0.03;
    if (roof) {
      if (kind == 0.0) alb = binfo.z < 0.5 ? vec3(0.42, 0.2, 0.13) : vec3(0.24, 0.25, 0.27);   // terracotta, slate
      else if (u_tex > 0.01) alb = texture(u_tex_aerial, vec3(pu.xz / 40.0 + binfo.yz * 9.0, 5.0)).rgb;   // real rooftops
      else alb = vec3(0.5, 0.49, 0.47);
    } else {
      float winAmt = mix(0.15, win, dW);
      alb = mix(wall, vec3(0.05, 0.06, 0.07), winAmt * (1.0 - glass));
      if (glass > 0.5) { rough = 0.12; f0 = 0.08; } else { rough = mix(0.85, 0.2, winAmt); f0 = mix(0.03, 0.05, winAmt); }
    }
    float dif = max(dot(n, Ls), 0.0);
    vec3 puS = pu + nu * 0.04;
    float sh = dif > 0.0 ? softShadow(puS, Lu, 9.0) : 0.0;
    float ao = 0.55 + 0.45 * smoothstep(0.0, 1.2, pu.y - base);    // darker toward the street
    // Sky light from above, sunlight bounced off the ground onto walls.
    vec3 amb = sky * (0.4 + 0.6 * nu.y) + sun * vec3(0.2, 0.19, 0.16) * (1.0 - nu.y) * 0.5;
    col = alb * (sun * dif * sh + amb * ao);
    vec3 v = -rd;
    float F = fresnel(max(dot(n, v), 0.0), f0);
    // Rough walls don't mirror the sky; glass and window panes do.
    float glossy = (1.0 - rough) * (1.0 - rough);
    col = mix(col, atmosphere(reflect(rd, n)) * ao, F * glossy * (roof ? 0.2 : 1.0));
    col += sun * ggx(n, v, Ls, rough) * F * sh;
    if (!roof) col += lampColour() * win * lit * mix(0.12, 1.0, dW) * 0.9 * (1.0 - glass * 0.6);
  } else {
    // Normal from the ground height (terrain + vegetation).
    float e = max(0.05, fp * 0.5);
    float h0 = groundH(pu.xz, L);
    float hx = groundH(pu.xz + vec2(e, 0.0), landSample(pu.xz + vec2(e, 0.0))) - h0;
    float hz = groundH(pu.xz + vec2(0.0, e), landSample(pu.xz + vec2(0.0, e))) - h0;
    vec3 nn = normalize(nIn - (tA * hx + zA * hz) / e);
    Ground G = cityGround(pu.xz, L, fp, nIn, nn);
    float veg = vegH(pu.xz, L);
    // Canopy: crowns darker in their gaps, a little translucent toward the sun.
    float canopy = smoothstep(0.04, 0.2, veg);
    vec3 alb = G.alb * (1.0 - 0.25 * canopy * (1.0 - smoothstep(0.1, 0.5, veg / VEG_H)));
    float dif = max(dot(nn, Ls), 0.0);
    float sh = softShadow(vec3(pu.xz, h0 + 0.03).xzy * vec3(1, 1, 1), Lu, 12.0);
    float ao = heightAO(pu.xz, h0);
    vec3 amb = sky * (0.5 + 0.5 * dot(nn, nIn)) + G.alb * vec3(0.25) * 0.3;
    col = alb * (sun * dif * sh + amb * ao);
    col += alb * sun * canopy * 0.08 * pow(max(dot(rd, Ls), 0.0), 4.0) * sh;   // leaves lit from behind
    // Wet sand reflects a little.
    if (G.wet > 0.01) col = mix(col, atmosphere(reflect(rd, nn)) * 0.6, G.wet * fresnel(max(dot(nn, -rd), 0.0), 0.04));
    if (G.water > 0.01) {
      // Lakes and rivers: small wind waves and ripples (scaled-down wave bands).
      float fd = 1.0 - smoothstep(0.05, 0.5, fp);
      int nb = Q == 2 ? 8 : Q == 1 ? 6 : 4;
      vec2 wq = pu.xz;
      float we = max(0.03, fp * 0.4);
      float w0 = waveH(wq, nb, 0.06), wx = waveH(wq + vec2(we, 0.0), nb, 0.06), wz = waveH(wq + vec2(0.0, we), nb, 0.06);
      vec3 wn = normalize(nIn - (tA * (wx - w0) + zA * (wz - w0)) / we * fd);
      float shoreFoam = smoothstep(0.5, 0.54, L.g) * (1.0 - smoothstep(0.56, 0.66, L.g)) * smoothstep(0.45, 0.7, vnoise(wq * 3.0 + u_time * 0.3)) * 0.8;
      float wsh = softShadow(vec3(pu.x, 0.0, pu.z), Lu, 10.0);
      vec3 wcol = shadeWater(wn, rd, Ls, G.depth, 0.0, shoreFoam, fp, wsh);
      col = mix(col, wcol, G.water);
    }
  }
  col *= u_light;
  // Aerial perspective: single scattering toward the eye (the scale reads through the haze).
  float T = exp(-t * u_land_fog);
  tHit = t;
  return col * T + atm * (1.0 - T);
}

// ── Ocean world: the cylinder covered by sea, swells rolling down the axis ──
float oceanMarchH(vec2 q) { return waveH(q, 4, 1.0); }

vec3 oceanWorld(vec3 ro, vec3 rd, float pix, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  float tFar = cylExit(ro, rd, u_land_r + 3.0);
  if (tFar < 0.0) return atm;
  const float AMAX = 3.6;
  float t = max(cylExit(ro, rd, u_land_r - AMAX), 0.0);
  bool hit = false;
  vec3 pu;
  for (int i = 0; i < 112; i++) {
    if (i >= u_land_steps || t > tFar) break;
    pu = unroll(ro + rd * t);
    float d = (pu.y - oceanMarchH(pu.xz)) * 0.5;
    float eps = max(pix * t * 0.6, 0.004);
    if (d < eps) { hit = true; break; }
    t += max(d, eps * 0.5);
  }
  if (!hit) {
    t = cylExit(ro, rd, u_land_r);
    if (t < 0.0) return atm;
    pu = unroll(ro + rd * t);
  }
  vec3 p = ro + rd * t;
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  vec3 nIn = normalize(vec3(-rel, 0.0));
  vec3 tA = normalize(vec3(-rel.y, rel.x, 0.0));
  vec3 zA = vec3(0.0, 0.0, 1.0);
  vec3 Ls = normalize(nIn * SUN_UP + u_sun * SUN_ALONG);
  float fp = pix * t;
  // Normal from every band near the eye; the short bands fade out with distance (no shimmer).
  int nb = fp < 0.03 ? 8 : fp < 0.08 ? 6 : fp < 0.2 ? 5 : 4;
  if (Q == 0) nb = min(nb, 5);
  float e = max(0.06, fp * 0.5);
  float h0 = waveH(pu.xz, nb, 1.0);
  float hx = waveH(pu.xz + vec2(e, 0.0), nb, 1.0) - h0;
  float hz = waveH(pu.xz + vec2(0.0, e), nb, 1.0) - h0;
  vec3 n = normalize(nIn - (tA * hx + zA * hz) / e);
  // Fine ripples up close (normal only).
  float fd = 1.0 - smoothstep(0.02, 0.12, fp);
  if (fd > 0.0) {
    vec2 cq = pu.xz * 3.1 + vec2(0.0, -u_time * 0.9);
    vec2 rp = vec2(vnoise(cq) - 0.5, vnoise(cq + 7.3) - 0.5) + 0.5 * vec2(vnoise(cq * 2.7) - 0.5, vnoise(cq * 2.7 + 3.1) - 0.5);
    n = normalize(n + (tA * rp.x + zA * rp.y) * 0.25 * fd);
  }
  float crest = smoothstep(0.2, 1.6, h0);
  // Foam where the waves fold, streaked along the swell, fading as it ages.
  float fold = waveFold(pu.xz, nb, 1.0);
  float streak = vnoise(pu.xz * vec2(1.4, 0.35) + vec2(0.0, -u_time * 0.6)) * 0.6 + vnoise(pu.xz * 3.2) * 0.4;
  float foam = smoothstep(0.5, 0.9, fold * 0.55 + crest * 0.35) * smoothstep(0.35, 0.75, streak);
  foam = mix(foam, foam * 0.6, smoothstep(0.1, 0.5, fp));
  vec3 col = shadeWater(n, rd, Ls, 1.0, crest, foam, fp, 1.0);
  col *= u_light;
  float T = exp(-t * u_land_fog);
  tHit = t;
  return col * T + atm * (1.0 - T);
}

// Colour of whatever lies beyond the fractal, and the fog colour for it.
vec3 backdrop(vec3 ro, vec3 rd, float pix, out float tHit) {
  if (u_backdrop == 0) { tHit = 1000.0; return voidSky(rd, pix) * mix(0.7, 1.0, u_light); }
  if (u_backdrop == 2) return oceanWorld(ro, rd, pix, tHit);
  return cityWorld(ro, rd, pix, tHit);
}

vec3 envColour(vec3 rd) {
  return u_backdrop == 0 ? voidBase(rd) * mix(0.7, 1.0, u_light) : atmosphere(rd) * mix(0.6, 1.0, u_light);
}
