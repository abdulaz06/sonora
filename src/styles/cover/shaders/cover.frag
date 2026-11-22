#version 300 es
precision highp float;
// Cover: the album art at the centre of a ground taken from its colours, over a
// feedback buffer of its own swept copies (premultiplied), with a soft halo.
// MODE 0 plain, 1 strips (sliding slices), 2 mirror (four-way kaleido),
// 3 tiles (slabs floating at different depths). A track change flips the
// tiles from the old cover to the new one.
uniform sampler2D u_cover;
uniform sampler2D u_prev;        // the previous cover (track-change flip)
uniform sampler2D u_fb;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_bg2;              // a second ground tone (gradient)
uniform vec3 u_halo;             // halo colour (dark on paper, a glow on dark grounds)
uniform float u_light;
uniform vec2 u_center;           // main cover centre (screen, height units from the middle)
uniform float u_size;            // main cover half size (height units)
uniform float u_rot;
uniform int u_mode;
uniform float u_amount;          // treatment strength 0..1
uniform float u_count;           // strips / tiles per side
uniform float u_phase;
uniform float u_kick;
uniform float u_flip;            // 0..1 flip progress (1 = done)
uniform float u_cover_aspect;    // width / height of the cover image
out vec4 frag;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
mat2 rot(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

vec3 sampleCover(sampler2D t, vec2 q) {
  // q in -1..1 over the square; the image is fitted (cropped to a square).
  vec2 uv = q * 0.5 + 0.5;
  if (u_cover_aspect > 1.0) uv.x = 0.5 + (uv.x - 0.5) / u_cover_aspect;
  else uv.y = 0.5 + (uv.y - 0.5) * u_cover_aspect;
  return texture(t, vec2(uv.x, 1.0 - uv.y)).rgb;
}

// The main cover with its treatment; returns colour and coverage.
vec4 mainCover(vec2 p) {
  vec2 q = rot(-u_rot) * (p - u_center) / u_size;    // -1..1 inside
  float n = max(u_count, 1.0);
  vec2 cell = floor((q * 0.5 + 0.5) * n);
  float flip = clamp(u_flip * 1.6 - (cell.x + cell.y) / (2.0 * n) * 0.6, 0.0, 1.0);
  if (u_mode == 3) {
    // Tiles float at their own depth: nearer tiles grow and cast a shadow.
    vec2 c = (cell + 0.5) / n * 2.0 - 1.0;
    float z = sin(u_time * (0.4 + hash(cell) * 0.5) + hash(cell + 3.0) * 6.28) * 0.5 + 0.5;
    z = z * u_amount * 0.35 + u_kick * 0.12 * step(0.6, hash(cell + floor(u_time * 2.0)));
    vec2 local = (q - c) / (1.0 + z) + c;
    vec2 lc = floor((local * 0.5 + 0.5) * n);
    if (lc != cell) return vec4(0.0);
    if (abs(local.x) > 1.0 || abs(local.y) > 1.0) return vec4(0.0);
    vec2 gap = abs(fract((local * 0.5 + 0.5) * n) - 0.5);
    float edge = smoothstep(0.5, 0.47, max(gap.x, gap.y));
    vec3 col = flip < 0.5 ? sampleCover(u_prev, local) : sampleCover(u_cover, local);
    return vec4(col * (0.85 + 0.25 * z), edge);
  }
  if (u_mode == 1) {
    // Strips slide along their length, more toward the edges and on the beat.
    float i = floor((q.x * 0.5 + 0.5) * n);
    q.y += sin(i * 1.7 + u_phase) * u_amount * 0.35 * (0.4 + 0.6 * abs(q.x)) + u_kick * 0.08 * (hash(vec2(i, floor(u_phase))) - 0.5);
  } else if (u_mode == 2) {
    // Four-way mirror, slowly turning inside the frame.
    vec2 m = rot(u_phase * 0.2) * q;
    m = abs(m);
    q = mix(q, m * 2.0 - 1.0, u_amount);
  }
  if (abs(q.x) > 1.0 || abs(q.y) > 1.0) return vec4(0.0);
  // Track change: tiles turn over (scaled through zero) from the old cover to the new.
  cell = floor((q * 0.5 + 0.5) * n);
  flip = clamp(u_flip * 1.6 - (cell.x + cell.y) / (2.0 * n) * 0.6, 0.0, 1.0);
  vec2 tc = (cell + 0.5) / n * 2.0 - 1.0;
  float sx = abs(cos(flip * 3.14159));
  vec2 fq = vec2(tc.x + (q.x - tc.x) / max(sx, 1e-3), q.y);
  if (abs(fq.x - tc.x) > 1.0 / n) return vec4(0.0);
  vec3 col = flip < 0.5 ? sampleCover(u_prev, fq) : sampleCover(u_cover, fq);
  float px = 1.5 / (u_res.y * u_size);
  float cov = smoothstep(1.0, 1.0 - px, max(abs(q.x), abs(q.y)));
  return vec4(col * (0.75 + 0.25 * sx), cov);
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);
  // Ground: two tones from the palette, a soft gradient and a little grain.
  vec3 col = mix(u_bg, u_bg2, smoothstep(-0.6, 0.9, p.y + 0.3 * p.x));
  col += (hash(gl_FragCoord.xy + fract(u_time) * 17.0) - 0.5) * 0.012;
  // Halo around the main cover (a shadow on paper, a glow on dark).
  vec2 hq = rot(-u_rot) * (p - u_center);
  vec2 dq = abs(hq) - vec2(u_size);
  float d = length(max(dq, 0.0)) + min(max(dq.x, dq.y), 0.0);
  // The halo answers each kick on the hit frame (local: the page itself never pulses).
  float halo = exp(-max(d, 0.0) / (0.06 + 0.07 * u_kick)) * (0.45 + 0.45 * u_kick);
  col = u_light > 0.5 ? mix(col, u_halo, halo * 0.6) : col + u_halo * halo * 0.5;
  // Swept copies (premultiplied).
  vec4 fb = texture(u_fb, uv);
  col = col * (1.0 - fb.a) + fb.rgb;
  // The cover on top.
  vec4 m = mainCover(p);
  // The cover itself lifts a little on the hit.
  vec3 mc = m.rgb * (1.0 + 0.22 * u_kick) + 0.04 * u_kick;
  // never past white: scale the hue down instead of clipping it
  float mx = max(mc.r, max(mc.g, mc.b));
  mc *= mx > 0.96 ? 0.96 / mx : 1.0;
  col = mix(col, mc, m.a);
  frag = vec4(col, 1.0);
}
