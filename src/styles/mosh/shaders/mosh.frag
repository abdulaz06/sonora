#version 300 es
precision highp float;
// Mosh. A crisp recursive tunnel of nested frames computed analytically each
// frame (Droste mapping: no resampling blur), each level its own patch of the
// seed texture with a slight rotation. On top, a feedback layer adds the
// datamosh: luminance displacement, pixel-sort smear, RGB glitch blocks,
// scanline tears and freeze.
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aspect;
uniform vec2 u_vp;            // vanishing point (uv)
uniform float u_zoom;         // tunnel depth (levels, increases over time and per beat)
uniform float u_level_scale;  // size ratio between nested frames
uniform float u_rot;
uniform float u_disp;         // luminance displacement strength
uniform vec2 u_smear_dir;
uniform float u_smear;        // 0..1
uniform float u_inject;       // 1 on a beat: fill outside the frame with seed
uniform float u_fill;         // 1: replace everything with seed (start / track change)
uniform float u_frame_w;      // border line thickness on injection (uv)
uniform float u_freeze;       // 1 while frozen
uniform vec4 u_blocks[8];     // glitch rects: x, y, w, h (uv)
uniform vec4 u_block_fx[8];   // dx, dy, channel split, seed
uniform int u_block_count;
uniform float u_tear;         // scanline tear strength
uniform float u_decay;
// Seed
uniform int u_variant;        // 0 concrete, 1 signal
uniform vec2 u_seed_off;      // world offset of the seed texture
uniform float u_seed_scale;
uniform vec3 u_c0;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform vec3 u_c3;
uniform vec4 u_fft[8];        // 32 spectrum values (signal)
uniform float u_pulse;
out vec4 frag;
//#include noise

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += a * snoise(vec3(p, 1.7 * float(i))); p *= 2.03; a *= 0.5; }
  return s;
}

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

// Voronoi: x = F1, y = F2 - F1 (edge distance).
vec2 voronoi(vec2 p) {
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 o = hash2(n + g);
    float d = length(g + o - f);
    if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) f2 = d;
  }
  return vec2(f1, f2 - f1);
}

vec3 concrete(vec2 p) {
  float base = 0.5 + 0.1 * fbm(p * 2.5) + 0.06 * fbm(p * 18.0);
  float asphalt = smoothstep(0.1, 0.4, fbm(p * 0.6 + 7.0));
  base = mix(base, 0.26 + 0.1 * fbm(p * 30.0), asphalt * 0.7);
  vec2 ag = voronoi(p * 40.0);
  // Aggregate: pebbles of varied tone with dark gaps between them.
  base += (hash2(floor(p * 40.0) + floor(ag.x * 3.0)).x - 0.5) * 0.28 * smoothstep(0.45, 0.1, ag.x);
  base -= 0.12 * smoothstep(0.06, 0.0, ag.y);
  vec2 cr = voronoi(p * 1.6 + vec2(fbm(p * 3.0), fbm(p * 3.0 + 4.0)) * 0.35);
  float crack = 1.0 - smoothstep(0.0, 0.018, cr.y);
  base *= 1.0 - crack * 0.8;
  base *= 0.85 + 0.15 * smoothstep(-0.3, 0.4, fbm(p * 1.2 + 3.0));
  float grain = fract(sin(dot(floor(p * 900.0), vec2(12.98, 78.23))) * 43758.5) - 0.5;
  vec3 col = vec3(base + grain * 0.1) * vec3(0.98, 0.99, 1.02);
  // Worn paint marks in the palette colours.
  float a = 0.6 + 0.4 * snoise(vec3(floor(p * 0.5), 2.0));
  vec2 rp = mat2(cos(a), sin(a), -sin(a), cos(a)) * p;
  float stripe = smoothstep(0.03, 0.0, abs(fract(rp.y * 0.35) - 0.5) - 0.06);
  float wear = smoothstep(0.0, 0.5, fbm(p * 6.0) + 0.2);
  float paint = stripe * wear * step(0.55, hash2(floor(rp * vec2(0.4, 0.35))).x);
  vec3 pc = hash2(floor(rp * 0.35)).y > 0.5 ? u_c2 : u_c0;
  return mix(col, pc * (0.6 + 0.4 * base), paint * 0.85);
}

vec3 signalSeed(vec2 p, vec2 uv) {
  // Sonora's own geometry: nested squares, rings and spectrum bars.
  vec2 q = fract(p * 0.5) - 0.5;
  float sq = abs(fract(max(abs(q.x), abs(q.y)) * 8.0 - u_time * 0.4) - 0.5);
  float squares = smoothstep(0.06, 0.0, sq - 0.18);
  float rings = smoothstep(0.05, 0.0, abs(fract(length(q) * 10.0 + u_time * 0.2) - 0.5) - 0.2);
  int bin = int(clamp(uv.x * 32.0, 0.0, 31.0));
  float fv = u_fft[bin / 4][bin % 4];
  float bars = step(uv.y, fv * 0.6) * step(0.2, fract(uv.x * 32.0));
  float n = fbm(p * 4.0);
  vec3 col = u_c0 * 0.08 + u_c1 * squares * 0.7 + u_c2 * rings * 0.5;
  col = mix(col, u_c3, bars * 0.9);
  col += vec3(n * 0.06);
  float scan = 0.85 + 0.15 * sin(uv.y * u_res.y * 1.5);
  return col * scan * (0.8 + 0.4 * u_pulse);
}

vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c) * p; }

vec3 seedAt(vec2 p, float level) {
  // A different patch of the seed per nesting level.
  vec2 off = hash2(vec2(level, level * 1.37)) * 40.0;
  vec2 q = p * u_seed_scale + u_seed_off + off;
  return u_variant == 0 ? concrete(q) : signalSeed(q, fract(p * 0.5 + 0.5));
}

// Nested-frame tunnel. Returns colour; `edgeOut` = distance to the frame edge.
vec3 tunnel(vec2 uv, out float edgeOut) {
  vec2 p = (uv - u_vp) * vec2(u_aspect, 1.0);
  p = rot2(p, u_rot);
  float r = max(abs(p.x) / u_aspect, abs(p.y));
  float lr = log(max(r, 1e-4)) / log(u_level_scale);
  float t = lr + u_zoom;
  float level = floor(t);
  float f = t - level;                       // 0 at the inner edge of this frame
  // Map into a canonical frame: radius in [1/S, 1] * 0.5.
  float k = pow(u_level_scale, -(level - u_zoom));
  vec2 lp = p * k;
  lp = rot2(lp, level * 0.11);               // each frame slightly turned
  edgeOut = min(f, 1.0 - f);
  vec3 col = seedAt(lp, level);
  // Depth shading: frames darken toward their inner edge, outlined rims.
  col *= 0.55 + 0.45 * smoothstep(0.0, 0.6, f);
  col *= 1.0 - 0.75 * smoothstep(0.035, 0.0, f);
  col += 0.08 * smoothstep(0.02, 0.0, abs(f - 0.985));
  return col;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec3 prev = texture(u_prev, uv).rgb;
  if (u_freeze > 0.5) {
    // Frozen: hold the frame, only the glitch blocks crawl.
    vec3 c = prev;
    for (int i = 0; i < 8; i++) {
      if (i >= u_block_count) break;
      vec4 b = u_blocks[i];
      if (uv.x > b.x && uv.y > b.y && uv.x < b.x + b.z && uv.y < b.y + b.w) {
        vec2 o = u_block_fx[i].xy * 0.3;
        c = vec3(texture(u_prev, uv + o + vec2(u_block_fx[i].z, 0)).r, texture(u_prev, uv + o).g, texture(u_prev, uv + o - vec2(u_block_fx[i].z, 0)).b);
      }
    }
    frag = vec4(c, 1.0);
    return;
  }
  // Luminance-driven displacement of the lookup (from the last frame).
  vec2 px = 1.5 / u_res;
  float lx = luma(texture(u_prev, uv + vec2(px.x, 0)).rgb) - luma(texture(u_prev, uv - vec2(px.x, 0)).rgb);
  float ly = luma(texture(u_prev, uv + vec2(0, px.y)).rgb) - luma(texture(u_prev, uv - vec2(0, px.y)).rgb);
  vec2 duv = uv + vec2(lx, ly) * u_disp;
  float edge;
  vec3 col = tunnel(duv, edge);
  // Datamosh smear: drag the brightest of the previous frame along a direction.
  if (u_smear > 0.01) {
    vec3 sm = prev;
    float ls = luma(sm);
    for (int i = 1; i <= 10; i++) {
      vec3 t = texture(u_prev, uv - u_smear_dir * float(i) * 3.0 / u_res).rgb;
      float lt = luma(t);
      if (lt > ls) { sm = t; ls = lt; }
    }
    col = mix(col, sm, u_smear * 0.75);
  }
  // Beat flash on the frame rims.
  col += u_inject * 0.12 * smoothstep(0.03, 0.0, edge) * vec3(1.0);
  // Glitch blocks: shifted, channel-split rectangles of the last frame.
  for (int i = 0; i < 8; i++) {
    if (i >= u_block_count) break;
    vec4 b = u_blocks[i];
    if (uv.x > b.x && uv.y > b.y && uv.x < b.x + b.z && uv.y < b.y + b.w) {
      vec2 o = u_block_fx[i].xy;
      float k = u_block_fx[i].z;
      col = vec3(texture(u_prev, uv + o + vec2(k, 0)).r, texture(u_prev, uv + o).g, texture(u_prev, uv + o - vec2(k, 0)).b);
      if (u_block_fx[i].w > 0.7) col = floor(col * 4.0) / 4.0;
    }
  }
  // Scanline tears.
  if (u_tear > 0.01) {
    float row = floor(uv.y * u_res.y / 3.0);
    float hr = fract(sin(row * 91.7 + floor(u_time * 24.0) * 7.1) * 4375.5);
    if (hr > 1.0 - u_tear * 0.25) col = texture(u_prev, uv + vec2((hr - 0.5) * 0.15 * u_tear, 0)).rgb;
  }
  frag = vec4(col, 1.0);
}
