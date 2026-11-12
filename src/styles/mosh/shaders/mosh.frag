#version 300 es
precision highp float;
// Mosh. A twisting recursive tunnel of nested frames computed analytically
// each frame (Droste mapping: no resampling blur). Each nested frame is a
// patch of the Signal pattern, turned against its neighbours so the tunnel
// reads as a vortex; frame shape morphs between rectangle, circle and
// diamond. Patterns are luminance-only and coloured through a palette
// gradient map, so every palette stays coherent. On top, a feedback layer
// adds the datamosh: luminance displacement, smear, RGB glitch blocks,
// scanline tears and the drop freeze.
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_time;
uniform float u_aspect;
uniform vec2 u_vp;            // vanishing point (uv)
uniform float u_zoom;         // tunnel depth (levels; rises going in, falls going out)
uniform float u_level_scale;  // size ratio between nested frames
uniform float u_rot;          // whole-tunnel spin
uniform float u_twist;        // extra rotation per nested level (rad)
uniform vec2 u_shape;         // x: rectangle → circle, y: → diamond
uniform float u_disp;         // luminance displacement strength
uniform vec2 u_smear_dir;
uniform float u_smear;        // 0..1
uniform float u_rim;          // beat light on the frame rims
uniform float u_freeze;       // 1 while frozen
uniform vec4 u_blocks[8];     // glitch rects: x, y, w, h (uv)
uniform vec4 u_block_fx[8];   // dx, dy, channel split, seed
uniform int u_block_count;
uniform float u_tear;         // scanline tear strength
uniform vec3 u_bg;
uniform vec3 u_c0;            // primary
uniform vec3 u_c2;            // accent
uniform vec3 u_c3;            // highlight
uniform vec4 u_fft[8];        // 32 spectrum values
uniform float u_pulse;
out vec4 frag;
//#include noise

float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c) * p; }
float hash1(float n) { return fract(sin(n * 127.1) * 43758.5453); }

// Palette gradient map: dark background → primary → highlight. Monotonic in
// luminance, so any palette (incl. two-tone) reads as one coherent image.
vec3 paletteMap(float l) {
  l = clamp(l, 0.0, 1.0);
  vec3 lo = u_bg * 0.6;
  return l < 0.55 ? mix(lo, u_c0 * 0.9, smoothstep(0.0, 0.55, l)) : mix(u_c0 * 0.9, u_c3, smoothstep(0.55, 1.0, l));
}

float fftAt(float x) {
  int bin = int(clamp(x * 32.0, 0.0, 31.0));
  return u_fft[bin / 4][bin % 4];
}

// Frame "radius" in the current shape metric.
float frameR(vec2 p) {
  float rect = max(abs(p.x) / u_aspect, abs(p.y));
  float circ = length(p) * 0.9;
  float diam = (abs(p.x) / u_aspect + abs(p.y)) * 0.62;
  return mix(mix(rect, circ, u_shape.x), diam, u_shape.y);
}

// Signal pattern inside one nested frame. q: canonical coordinates (frame
// edge at radius 0.5), f: 0 at the inner edge → 1 at the outer edge.
float signalPattern(vec2 q, float f, float level) {
  float fam = mod(level, 4.0);
  float r = frameR(q);
  float a = atan(q.y, q.x);
  float l;
  if (fam < 1.0) {
    // Fine concentric lines following the frame shape, drifting outward.
    float lines = abs(fract(r * 46.0 - u_time * 0.6) - 0.5);
    l = smoothstep(0.16, 0.04, lines) * 0.85;
  } else if (fam < 2.0) {
    // Halftone dots: size from slow noise.
    vec2 g = q * 34.0;
    vec2 cell = fract(g) - 0.5;
    float n = 0.5 + 0.5 * snoise(vec3(floor(g) * 0.09, level * 3.1 + u_time * 0.1));
    l = smoothstep(0.05, 0.0, length(cell) - 0.42 * n) * (0.35 + 0.65 * n);
  } else if (fam < 3.0) {
    // Moiré: two slightly rotated line gratings.
    float g1 = abs(fract(rot2(q, 0.04 + 0.02 * sin(u_time * 0.3)).x * 60.0) - 0.5);
    float g2 = abs(fract(rot2(q, -0.05).x * 60.0) - 0.5);
    l = smoothstep(0.2, 0.0, g1) * smoothstep(0.2, 0.0, g2) * 0.9 + 0.08;
  } else {
    // Radial spectrum: bars around the frame, length from the live FFT.
    float x = fract(a / 6.2831853 + 0.5);
    float seg = floor(x * 64.0);
    float v = fftAt(abs(seg / 64.0 - 0.5) * 2.0);
    float bar = step(0.25, fract(x * 64.0)) * step(f, 0.2 + 0.75 * v);
    l = bar * (0.55 + 0.45 * v) + 0.05;
  }
  // Grain keeps it from looking flat.
  l += (hash1(dot(floor(q * 400.0), vec2(1.0, 57.0)) + level) - 0.5) * 0.06;
  return l;
}

// Nested-frame tunnel. Returns colour; `edgeOut` = distance to the frame edge.
vec3 tunnel(vec2 uv, out float edgeOut) {
  vec2 p = (uv - u_vp) * vec2(u_aspect, 1.0);
  p = rot2(p, u_rot);
  float r = frameR(p);
  float lr = log(max(r, 1e-4)) / log(u_level_scale);
  float t = lr + u_zoom;
  float level = floor(t);
  float f = t - level;                       // 0 at the inner edge of this frame
  float k = pow(u_level_scale, -(level - u_zoom));
  vec2 lp = rot2(p * k, level * u_twist);    // each frame turned against the last
  edgeOut = min(f, 1.0 - f);
  float l = signalPattern(lp, f, level);
  vec3 col = paletteMap(l);
  // Depth: frames darken toward their inner edge; thin dark gap, bright rim.
  col *= 0.45 + 0.55 * smoothstep(0.0, 0.7, f);
  col *= 1.0 - 0.8 * smoothstep(0.04, 0.0, f);
  col += mix(u_c2, u_c3, 0.4) * smoothstep(0.018, 0.0, abs(f - 0.975)) * (0.08 + 0.6 * u_rim);
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
  col *= 1.0 + 0.15 * u_pulse * smoothstep(0.05, 0.0, edge);
  frag = vec4(col, 1.0);
}
