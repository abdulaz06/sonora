// ── Voyage backdrops (injected at //#include backdrop) ─────────────────
// u_backdrop: 0 Void (stars), 1 City (curved land and cities), 2 Ocean.
// City and Ocean live on the inside of a cylinder (axis z through
// (0, u_land_cy), radius u_land_r), unrolled into q = (around, along) and
// "up" = height above the mean surface toward the axis. Backdrops never react
// to beats; only light does.

float fbm2(vec2 q) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * snoise(vec3(q, 3.7 * float(i))); q = q * 2.07 + 1.3; a *= 0.5; }
  return v;
}

vec2 cellHash(vec2 c) { return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453); }
vec3 cellHash3(vec3 c) {
  return fract(sin(vec3(dot(c, vec3(127.1, 311.7, 74.7)), dot(c, vec3(269.5, 183.3, 246.1)), dot(c, vec3(113.5, 271.9, 124.6)))) * 43758.5453);
}

// Smooth value noise for fine texture.
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cellHash(i).x, b = cellHash(i + vec2(1, 0)).x, c = cellHash(i + vec2(0, 1)).x, d = cellHash(i + vec2(1, 1)).x;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Atmosphere inside the cylinder: hazy, lit toward the sun end of the axis.
vec3 atmosphere(vec3 rd) {
  float s = max(dot(rd, u_sun), 0.0);
  vec3 c = mix(u_bg * 1.6 + u_c1 * 0.18, u_c0 * 0.35 + u_c3 * 0.12, 0.5 + 0.5 * rd.z * sign(u_sun.z));
  c += u_c3 * (pow(s, 40.0) * 2.4 + pow(s, 5.0) * 0.45);
  return c;
}

// ── Void: a dark sky tinted by the accent, full of stars ──
vec3 voidBase(vec3 rd) {
  float h = rd.y * 0.5 + 0.5;
  vec3 col = mix(u_bg * 0.45 + u_c2 * 0.02, u_bg * 0.7 + u_c2 * 0.09, smoothstep(0.0, 1.0, h));
  float n = snoise(rd * 1.7 + 3.0) * 0.6 + snoise(rd * 3.9 - 1.0) * 0.3;
  float n2 = snoise(rd * 2.6 + 9.0);
  col += mix(u_c2, u_c1, 0.5 + 0.5 * n2) * pow(max(n, 0.0), 2.2) * 0.16;
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
// Exit distance of a ray (from inside) to the cylinder of radius r.
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

// World point → unrolled (around, up, along); also the local frame.
vec3 unroll(vec3 p) {
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  return vec3(atan(rel.x, -rel.y) * u_land_r, u_land_r - length(rel), p.z);
}

// ── City world ──
vec4 landSample(vec2 q) {
  return texture(u_land_tex, vec2(q.x / (6.2831853 * u_land_r), q.y / u_zspan + 0.5));
}

// Tree canopies: one dome per cell where the forest mask allows.
float treeH(vec2 q, float forest) {
  if (forest < 0.08) return 0.0;
  vec2 g = q / 0.75;
  vec2 c = floor(g), f = fract(g);
  vec2 h = cellHash(c + 31.0);
  if (h.x > 0.35 + 0.65 * forest) return 0.0;
  vec2 ctr = 0.35 + 0.3 * cellHash(c + 7.0);
  float r = 0.24 + 0.08 * h.y;
  float d = length(f - ctr);
  float dome = sqrt(max(r * r - d * d, 0.0)) / r;
  return dome * (0.55 + 0.45 * h.y) * smoothstep(0.08, 0.4, forest);
}

// City blocks on a street grid; each block holds 2x2 lots with one building
// each (some with a setback tower), parks in a few blocks. Distances are
// bounded by the lot / block edge so the march never skips into a neighbour.
const float BLOCK = 4.2;
const float STREET = 0.62;
float sdCity(vec3 pu, out vec4 info) {
  info = vec4(0.0);
  vec2 q = pu.xz;
  vec2 bc = floor(q / BLOCK);
  vec2 bl = q - bc * BLOCK;
  float toBlock = min(min(bl.x, BLOCK - bl.x), min(bl.y, BLOCK - bl.y));
  vec4 Lb = landSample((bc + 0.5) * BLOCK);
  if (Lb.b < 0.6 || Lb.g > 0.04 || cellHash(bc + 3.0).x < 0.09) return toBlock + 0.05;
  float inner = BLOCK - STREET;
  float lot = inner * 0.5;
  vec2 il = bl - STREET * 0.5;
  if (il.x < 0.0 || il.y < 0.0 || il.x > inner || il.y > inner) {
    // On a street: distance to the nearest lot edge.
    vec2 dd = max(max(-il, il - inner), 0.0);
    return max(length(dd), 0.02);
  }
  vec2 li = min(floor(il / lot), vec2(1.0));
  vec2 ll = il - li * lot;
  float toLot = min(min(ll.x, lot - ll.x), min(ll.y, lot - ll.y));
  vec2 hh = cellHash(bc * 2.0 + li + 5.0);
  float core = Lb.a;
  float h = 0.45 + hh.y * (0.8 + 2.8 * core) * (0.65 + 0.55 * hh.x);
  if (cellHash(bc * 3.0 + li).x > 0.9 - 0.18 * core) h = 3.2 + 3.2 * hh.y * (0.5 + 0.5 * core);
  float base = Lb.r;
  vec2 halfSz = vec2(lot * 0.5 - 0.14 - 0.12 * hh.x, lot * 0.5 - 0.14 - 0.12 * hh.y);
  vec2 ctr = vec2(lot * 0.5);
  // Lower block, then a narrower tower on tall buildings.
  float hb = h > 2.4 ? h * 0.45 : h;
  vec3 p1 = vec3(ll.x - ctr.x, pu.y - base - hb * 0.5, ll.y - ctr.y);
  vec3 d1 = abs(p1) - vec3(halfSz.x, hb * 0.5, halfSz.y);
  float db = length(max(d1, 0.0)) + min(max(d1.x, max(d1.y, d1.z)), 0.0);
  if (h > 2.4) {
    vec3 p2 = vec3(p1.x, pu.y - base - h * 0.5, p1.z);
    vec3 d2 = abs(p2) - vec3(halfSz.x * 0.62, h * 0.5, halfSz.y * 0.62);
    db = min(db, length(max(d2, 0.0)) + min(max(d2.x, max(d2.y, d2.z)), 0.0));
  }
  info = vec4(h, hh.x, hh.y, base);
  return min(db, toLot + 0.03);
}

// Ground surface height (terrain, waterline, tree canopies, rock crags).
float groundH(vec2 q, vec4 L) {
  float forest = (1.0 - step(0.5, L.b)) * L.a;
  float crag = smoothstep(1.4, 2.4, L.r) * (vnoise(q * 1.7) * 0.35 + vnoise(q * 4.3) * 0.15);
  return max(L.r, 0.0) + treeH(q, forest) + crag;
}

// Ground colour (fields, grass, forest floor, rock, snow, shores, streets).
vec3 cityGround(vec2 q, vec4 L, float fp, out float water) {
  float d1 = 1.0 - smoothstep(0.06, 0.3, fp);
  float d2 = 1.0 - smoothstep(0.2, 1.0, fp);
  float hT = L.r;
  float city = L.b;
  float forest = (1.0 - step(0.5, city)) * L.a;
  water = smoothstep(0.6, 0.85, L.g);
  // Fields in strips along the axis, each strip with its own widths.
  float stripW = 2.4;
  float strip = floor(q.y / stripW);
  vec2 sh = cellHash(vec2(strip, 17.0));
  vec2 fsz = vec2(2.2 + 3.0 * sh.x, stripW);
  vec2 qq = vec2(q.x + sh.y * 7.0, q.y);
  vec2 fh = cellHash(floor(qq / fsz) + vec2(0.0, strip * 3.1));
  vec2 local = fract(qq / fsz);
  float hedge = smoothstep(0.0, 0.03, min(min(local.x, 1.0 - local.x), min(local.y, 1.0 - local.y)));
  vec3 crops[5] = vec3[5](vec3(0.28, 0.42, 0.15), vec3(0.35, 0.47, 0.17), vec3(0.55, 0.5, 0.24), vec3(0.42, 0.34, 0.2), vec3(0.24, 0.37, 0.14));
  vec3 col = crops[int(fh.x * 4.99)] * (0.9 + 0.2 * fh.y);
  float rows = 0.5 + 0.5 * sin((fh.y > 0.5 ? local.x * fsz.x : local.y * fsz.y) * 24.0);
  col *= 0.85 + 0.15 * mix(1.0, rows, d1);
  // Grass grain: several octaves of fine noise, faded with distance.
  float g = 0.8 + 0.18 * mix(0.5, vnoise(q * 6.0), d1) + 0.12 * (mix(0.5, vnoise(q * 1.3), d2) - 0.5)
          + 0.08 * (mix(0.5, vnoise(q * 14.0), d1 * d1) - 0.5);
  col *= g;
  col = mix(col * 0.5 + vec3(0.03, 0.05, 0.02), col, hedge);
  // Forest floor between canopies.
  col = mix(col, vec3(0.06, 0.12, 0.05), smoothstep(0.1, 0.4, forest));
  // Rock and snow on mountains.
  float rock = smoothstep(1.7, 2.4, hT);
  float strata = 0.5 + 0.5 * sin(hT * 9.0 + vnoise(q * 0.8) * 3.0);
  vec3 rockCol = mix(vec3(0.36, 0.33, 0.3), vec3(0.52, 0.49, 0.44), strata) * (0.75 + 0.4 * mix(0.5, vnoise(q * 3.0 + 9.0), d2));
  col = mix(col, rockCol, rock);
  col = mix(col, vec3(0.88, 0.9, 0.93), smoothstep(3.4, 3.9, hT));
  // Shores: sand where the land meets the water.
  // g holds water (1) and closeness to water (0.05-0.5): sand on the shores only.
  float sand = smoothstep(0.08, 0.3, L.g) * (1.0 - water) * (1.0 - step(0.5, city));
  col = mix(col, vec3(0.74, 0.68, 0.52) * (0.9 + 0.1 * vnoise(q * 5.0)), sand);
  // Streets and pavements inside cities.
  if (city > 0.5) {
    vec2 bl = mod(q, BLOCK);
    float street = 1.0 - step(STREET * 0.5, min(min(bl.x, BLOCK - bl.x), min(bl.y, BLOCK - bl.y)));
    vec3 pave = vec3(0.36, 0.36, 0.35) * (0.9 + 0.1 * vnoise(q * 4.0));
    vec3 road = vec3(0.12, 0.12, 0.13);
    float mark = d1 * step(0.97, fract((bl.x + bl.y) * 2.0)) * street;
    col = mix(pave, road + mark * 0.4, street);
    // Parks: green blocks.
    if (cellHash(floor(q / BLOCK) + 3.0).x < 0.09) col = mix(col, vec3(0.2, 0.36, 0.14) * g, 1.0 - street);
  }
  return col;
}

vec3 cityBuilding(vec3 pu, vec4 info, vec3 n, vec3 nu, vec3 rd, float fp, vec3 Ls) {
  bool roof = nu.y > 0.7;
  float glass = step(0.86, info.y);
  vec3 wall = mix(mix(vec3(0.52, 0.53, 0.55), vec3(0.66, 0.6, 0.5), info.z), vec3(0.32, 0.4, 0.48), glass);
  float side = abs(nu.x) > abs(nu.z) ? pu.z : pu.x;
  vec2 wg = vec2(side * 6.0, (pu.y - info.w) * 8.0);
  vec2 wf = fract(wg);
  float win = step(0.22, wf.x) * step(wf.x, 0.78) * step(0.28, wf.y) * step(wf.y, 0.82);
  float dW = 1.0 - smoothstep(0.025, 0.1, fp);
  float lit = step(0.6, cellHash(floor(wg) + info.yz * 91.0).x);
  // Roofs: varied light materials with darker rooftop plant boxes.
  vec3 roofCol = info.z < 0.33 ? vec3(0.62, 0.6, 0.57) : info.z < 0.66 ? vec3(0.5, 0.44, 0.38) : vec3(0.42, 0.45, 0.47);
  vec2 rp = fract(vec2(pu.x, pu.z) * 1.7 + info.yz * 5.0);
  float plant = step(0.62, rp.x) * step(rp.x, 0.86) * step(0.55, rp.y) * step(rp.y, 0.8) * dW;
  roofCol *= 1.0 - 0.35 * plant;
  vec3 albedo = roof ? roofCol : mix(wall, wall * 0.3, mix(0.32, win, dW) * (1.0 - glass * 0.5));
  float dif = max(dot(n, Ls), 0.0);
  vec3 col = albedo * (dif * 1.2 + 0.32);
  col += (u_c3 * 0.5 + vec3(0.65, 0.52, 0.32)) * mix(0.1, win * lit, dW) * (roof ? 0.0 : 0.45);
  col += atmosphere(reflect(rd, n)) * (roof ? 0.0 : 0.06 + 0.25 * glass);
  return col;
}

vec3 cityWorld(vec3 ro, vec3 rd, float pix, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  float tGround = cylExit(ro, rd, u_land_r + 0.8);
  if (tGround < 0.0) return atm;
  const float HMAX = 7.0;
  float tIn = max(cylExit(ro, rd, u_land_r - HMAX), 0.0);
  float t = tIn;
  int mat = 0;          // 0 none, 1 ground, 2 building
  vec4 binfo = vec4(0.0);
  vec3 pu = vec3(0.0);
  vec4 L = vec4(0.0);
  for (int i = 0; i < 96; i++) {
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
    // Fallback (ran out of steps): shade the ground at the base radius.
    float tg = cylExit(ro, rd, u_land_r);
    if (tg < 0.0) return atm;
    t = tg; pu = unroll(ro + rd * t); L = landSample(pu.xz); mat = 1;
  }
  vec3 p = ro + rd * t;
  vec2 rel = p.xy - vec2(0.0, u_land_cy);
  vec3 nIn = normalize(vec3(-rel, 0.0));
  vec3 tA = normalize(vec3(-rel.y, rel.x, 0.0));
  // Light comes from the axis (as in a habitat) blended with the end-cap sun,
  // so the land overhead is lit as well as the land below.
  vec3 Ls = normalize(nIn * 0.85 + u_sun * 0.5);
  float fp = pix * t;
  vec3 col;
  if (mat == 2) {
    vec4 inf;
    float e = 0.01;
    vec3 gu = vec3(sdCity(pu + vec3(e, 0, 0), inf) - sdCity(pu - vec3(e, 0, 0), inf),
                   sdCity(pu + vec3(0, e, 0), inf) - sdCity(pu - vec3(0, e, 0), inf),
                   sdCity(pu + vec3(0, 0, e), inf) - sdCity(pu - vec3(0, 0, e), inf));
    vec3 nu = normalize(gu + vec3(0.0, 1e-6, 0.0));
    vec3 n = normalize(tA * nu.x + nIn * nu.y + vec3(0.0, 0.0, 1.0) * nu.z);
    col = cityBuilding(pu, binfo, n, nu, rd, fp, Ls);
  } else {
    float water;
    vec3 albedo = cityGround(pu.xz, L, fp, water);
    // Normal from the ground height (terrain + canopies).
    float e = max(0.06, fp * 0.5);
    float h0 = groundH(pu.xz, L);
    float hx = groundH(pu.xz + vec2(e, 0.0), landSample(pu.xz + vec2(e, 0.0))) - h0;
    float hz = groundH(pu.xz + vec2(0.0, e), landSample(pu.xz + vec2(0.0, e))) - h0;
    vec3 n = normalize(nIn - (tA * hx + vec3(0.0, 0.0, 1.0) * hz) / e);
    float forest = (1.0 - step(0.5, L.b)) * L.a;
    float canopy = smoothstep(0.02, 0.15, treeH(pu.xz, forest));
    vec3 leaf = vec3(0.1, 0.22, 0.08) * (0.75 + 0.5 * vnoise(pu.xz * 9.0));
    albedo = mix(albedo, leaf, canopy);
    float dif = max(dot(n, Ls), 0.0);
    // Soft occlusion between canopies and in valleys.
    float occ = 0.75 + 0.25 * smoothstep(-0.2, 0.25, pu.y - max(L.r, 0.0) - 0.3 * canopy);
    col = albedo * (dif * 1.25 + 0.3) * occ;
    if (water > 0.01) {
      vec2 rq = pu.xz * 1.6 + vec2(u_time * 0.3, u_time * 0.2);
      float fd = 1.0 - smoothstep(0.1, 0.6, fp);
      vec3 wn = normalize(nIn + (tA * (vnoise(rq) - 0.5) + vec3(0.0, 0.0, 1.0) * (vnoise(rq + 5.0) - 0.5)) * 0.22 * fd);
      float fres = pow(1.0 - max(dot(wn, -rd), 0.0), 4.0);
      vec3 wcol = vec3(0.03, 0.1, 0.14) + u_c0 * 0.04;
      wcol = mix(wcol, atmosphere(reflect(rd, wn)) * 0.5, 0.2 + 0.6 * fres);
      wcol += u_c3 * pow(max(dot(reflect(rd, wn), u_sun), 0.0), 140.0) * 1.4;
      col = mix(col, wcol, water);
    }
  }
  col = mix(col, col * (0.65 + 0.7 * u_c0), 0.15);   // light palette tint
  col *= u_light;
  float fog = 1.0 - exp(-t * u_land_fog);
  tHit = t;
  return mix(col, atm, fog);
}

// ── Ocean world: huge swells rolling down the axis toward the horizon ──
float swell(vec2 q, vec2 dir, float lambda, float speed, float sharp) {
  float ph = dot(q, normalize(dir)) * 6.2831853 / lambda - u_time * speed;
  return pow(0.5 + 0.5 * sin(ph), sharp);
}

// Height (inward, world units) of the sea surface.
float oceanH(vec2 q) {
  float h = 0.0;
  h += 3.2 * swell(q, vec2(0.1, 1.0), 38.0, 1.05, 2.2);
  h += 1.5 * swell(q, vec2(-0.3, 1.0), 21.0, 1.5, 1.8);
  h += 0.7 * swell(q, vec2(0.45, 1.0), 12.0, 2.0, 1.5);
  h += 0.35 * swell(q, vec2(-0.7, 1.0), 6.5, 2.7, 1.2);
  return h - 1.6;
}

vec3 oceanWorld(vec3 ro, vec3 rd, float pix, out float tHit) {
  vec3 atm = atmosphere(rd) * mix(0.6, 1.0, u_light);
  tHit = 1000.0;
  float tFar = cylExit(ro, rd, u_land_r + 2.0);
  if (tFar < 0.0) return atm;
  const float AMAX = 4.4;
  float t = max(cylExit(ro, rd, u_land_r - AMAX), 0.0);
  bool hit = false;
  vec3 pu;
  for (int i = 0; i < 96; i++) {
    if (i >= u_land_steps || t > tFar) break;
    pu = unroll(ro + rd * t);
    float d = (pu.y - oceanH(pu.xz)) * 0.5;
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
  float fp = pix * t;
  float e = max(0.15, fp * 0.5);
  float h0 = oceanH(pu.xz);
  float hx = oceanH(pu.xz + vec2(e, 0.0)) - h0;
  float hz = oceanH(pu.xz + vec2(0.0, e)) - h0;
  // Fine chop on top (normal only), faded with distance.
  float fd = 1.0 - smoothstep(0.08, 0.5, fp);
  vec2 cq = pu.xz * 1.3 + vec2(0.0, -u_time * 1.2);
  vec2 chop = vec2(vnoise(cq) - 0.5, vnoise(cq + 7.3) - 0.5) * 0.5 * fd
            + vec2(vnoise(cq * 3.1) - 0.5, vnoise(cq * 3.1 + 2.1) - 0.5) * 0.25 * fd;
  vec3 n = normalize(nIn - (tA * (hx / e + chop.x) + vec3(0.0, 0.0, 1.0) * (hz / e + chop.y)));
  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 5.0);
  vec3 deep = vec3(0.01, 0.06, 0.1) + u_c0 * 0.05;
  // Light through the thin crests (backlit teal), foam on steep crests.
  float crest = smoothstep(0.6, 1.7, h0);
  vec3 sss = vec3(0.05, 0.32, 0.34) * crest * (0.5 + 0.5 * max(dot(-u_sun, rd), 0.0) + 0.4);
  vec3 col = deep + sss;
  float dif = max(dot(n, normalize(nIn * 0.85 + u_sun * 0.5)), 0.0);
  col *= 0.6 + 0.6 * dif;
  col = mix(col, atmosphere(reflect(rd, n)) * 0.7, 0.08 + 0.85 * fres);
  float slope = length(vec2(hx, hz)) / e;
  float foamN = vnoise(pu.xz * 2.2 + vec2(0.0, -u_time * 0.8)) * 0.6 + vnoise(pu.xz * 6.0) * 0.4 * fd + 0.2 * (1.0 - fd);
  float foam = smoothstep(0.7, 0.95, crest * 0.75 + slope * 0.3) * smoothstep(0.5, 0.78, foamN);
  col = mix(col, vec3(0.86, 0.9, 0.92) * (0.6 + 0.5 * dif), foam);
  col += u_c3 * pow(max(dot(reflect(rd, n), u_sun), 0.0), 160.0) * 2.0;
  col *= u_light;
  float fog = 1.0 - exp(-t * u_land_fog);
  tHit = t;
  return mix(col, atm, fog);
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
