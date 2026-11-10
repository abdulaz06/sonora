// ── Flow Ink shading (injected at //#include ink) ────────────────────
// Turns dye (palette-slot densities) into colour for each variant, in dark
// (emissive ink on night) or light (absorbing ink on paper).

uniform sampler2D u_dye;
uniform sampler2D u_height;   // blurred dye (rgb) + lift (a), sim resolution
uniform sampler2D u_grain;    // static tileable noise, mipmapped
uniform float u_dye_res;
uniform float u_sim_res;
uniform float u_domain;       // world units per domain tile
uniform vec3 u_bg;
uniform vec3 u_paper;
uniform vec3 u_ink_a;
uniform vec3 u_ink_b;
uniform vec3 u_spark;
uniform int u_variant;        // 0 ink, 1 sumi, 2 marble
uniform int u_light;          // 1 = ink on paper
uniform float u_fade;
uniform float u_time;
uniform float u_drop;         // post-drop envelope
uniform float u_sharpen;
uniform float u_glow;
uniform float u_pulse;        // bass-hit envelope × fade: frame-accurate beat response
uniform float u_pulse_gain;   // how much ink brightens on a hit

struct InkSample {
  vec4 d;      // sharpened dye
  vec4 blur;   // blurred dye
  float edge;  // fine detail above the local mean
};

InkSample sampleInk(vec2 uv, float lod) {
  InkSample s;
  vec4 raw = lod < 0.5 ? sampleBicubic(u_dye, uv, vec2(u_dye_res)) : texture(u_dye, uv);
  s.blur = texture(u_height, uv);
  // Unsharp mask with a clamped negative lobe: crisper filaments, no halos.
  s.d = max(raw + u_sharpen * clamp(raw - s.blur, -0.2 * raw, vec4(8.0)), 0.0);
  s.d.a = raw.a;
  s.edge = clamp((raw.r + raw.g) - (s.blur.r + s.blur.g), 0.0, 1.5);
  return s;
}

/** Ink-density height used for the surface (world units before scaling). */
float inkHeight(vec4 blur) {
  return 1.0 - exp(-(blur.r + blur.g) * 0.9);
}

float grainAt(vec2 world) {
  return texture(u_grain, world * 1.7).r * 0.6 + texture(u_grain, world * 6.3 + 0.37).r * 0.4;
}

vec3 darkBackground(vec2 world) {
  float g = grainAt(world * 0.35);
  return u_bg * (0.75 + 0.5 * g);
}

// Returns colour; `cover` receives ink coverage (0..1) for lighting.
vec3 shadeInkBase(InkSample s, vec2 world, vec2 fragCoord, out float cover) {
  float a = s.d.r, b = s.d.g, sp = s.d.b;
  float g = grainAt(world);
  bool light = u_light == 1;

  if (u_variant == 2) {
    // ── Marble: duotone, marbling striations, stippled transitions (ref04) ──
    float total = a + b;
    float ratio = a / (total + 0.12);
    float cov = 1.0 - exp(-total * 1.6);
    float field = ratio * cov + s.edge * 0.25;
    float veins = 0.5 + 0.5 * sin((ratio * 9.0 + (s.blur.r - s.blur.g) * 4.0) * 6.2832);
    veins = smoothstep(0.86, 1.0, veins) * cov;
    float n = hash12(fragCoord) - 0.5;
    float stip = smoothstep(0.5 - 0.14, 0.5 + 0.14, field + n * 0.42 + (g - 0.5) * 0.12);
    vec3 bright = light ? mix(u_paper, u_ink_a * 0.9, 0.08) : u_ink_a;
    vec3 dark = light ? u_ink_a * 0.55 : u_bg * 0.6;
    vec3 col = mix(dark, bright, stip);
    col = mix(col, light ? dark * 0.7 : bright * 1.25, veins * 0.6);
    col += light ? vec3(0.0) : u_spark * sp * 2.0;
    cover = cov;
    return col;
  }

  if (u_variant == 1) {
    // ── Sumi: black ink in water / on bone paper (ref07) ──
    float dens = a + b * 0.85 + s.edge * 0.7;
    float cov = 1.0 - exp(-pow(dens, 0.8) * 2.2);
    cover = cov;
    if (light) {
      vec3 ink = mix(vec3(0.025, 0.024, 0.028), u_ink_a * 0.18, 0.18);
      vec3 paper = u_paper * (0.965 + 0.05 * g);
      vec3 col = mix(paper, ink, cov * (0.9 + 0.1 * g));
      col = mix(col, ink, clamp(sp * 0.6, 0.0, 0.8));
      return col;
    }
    vec3 ink = u_paper * 0.95;
    vec3 col = darkBackground(world);
    col = mix(col, ink, cov * (0.88 + 0.12 * g));
    col += u_paper * max(dens - 1.6, 0.0) * 0.35 * u_glow;
    col += u_spark * sp * 1.6;
    return col;
  }

  // ── Ink: luminous palette ink (dark) / coloured stains (light) ──
  // Soft response: thin wisps stay translucent, dense cores saturate.
  float ca = 1.0 - exp(-pow(a, 0.85) * 0.95);
  float cb = 1.0 - exp(-pow(b, 0.85) * 0.95);
  cover = max(ca, cb);
  if (light) {
    vec3 absA = (1.0 - u_ink_a) * 2.2 + 0.15;
    vec3 absB = (1.0 - u_ink_b) * 2.2 + 0.15;
    vec3 paper = u_paper * (0.965 + 0.05 * g);
    vec3 col = paper * exp(-(a * absA + b * absB) * (0.8 + 0.25 * g) - s.edge * 0.6);
    col = mix(col, col * 0.4, clamp(sp * 0.5, 0.0, 0.6));
    return col;
  }
  vec3 col = darkBackground(world);
  col = mix(col, u_ink_a * (0.85 + 0.25 * g), ca);
  col = mix(col, u_ink_b * (0.85 + 0.25 * g), cb * (1.0 - 0.35 * ca));
  // Dense cores push past 1.0 so only they bloom.
  col += (u_ink_a * smoothstep(1.0, 3.0, a) + u_ink_b * smoothstep(1.0, 3.0, b)) * 0.6 * u_glow;
  // Filament rims: fine detail catches light.
  col += mix(u_ink_a, u_spark, 0.6) * s.edge * 0.35;
  col += u_spark * min(sp, 1.5) * 1.6;
  return col;
}

// Beat response on top of the variant shading:
//  - u_pulse brightens all ink on the hit (dark) or deepens it (paper)
//  - dye.a carries "energy" injected by hits; it glows past 1.0 so it blooms
//    and fades in ~150 ms
vec3 shadeInk(InkSample s, vec2 world, vec2 fragCoord, out float cover) {
  vec3 col = shadeInkBase(s, world, fragCoord, cover);
  float e = min(s.d.a, 2.0);
  vec3 inkCol = u_variant == 1 ? (u_light == 1 ? vec3(0.02) : u_paper)
              : mix(u_ink_a, u_ink_b, s.d.g / (s.d.r + s.d.g + 1e-3));
  if (u_light == 1) {
    float deepen = clamp((0.45 * u_pulse * u_pulse_gain + 0.35 * e) * max(cover, 0.25 * e), 0.0, 0.7);
    return col * (1.0 - deepen) + inkCol * deepen * 0.15;
  }
  vec3 base = darkBackground(world);
  col = base + (col - base) * (1.0 + u_pulse_gain * u_pulse);
  col += inkCol * e * (0.3 + 0.7 * cover);
  return col;
}
