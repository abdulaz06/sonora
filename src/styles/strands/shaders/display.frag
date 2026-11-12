#version 300 es
precision highp float;
precision highp int;
// Turns the accumulation buffer into the final Strands image per variant.
uniform sampler2D u_accum;
uniform vec2 u_res;
uniform float u_time;
uniform vec3 u_bg;
uniform vec3 u_paper;
uniform vec3 u_c0;   // primary
uniform vec3 u_c1;   // secondary
uniform vec3 u_c2;   // accent
uniform vec3 u_c3;   // highlight
uniform int u_light;
uniform float u_gain;
uniform float u_fade;
uniform float u_pulse;
// Lumen
uniform vec2 u_src;          // source in uv
uniform float u_streak;      // anamorphic streak strength
uniform vec2 u_balance;      // horizontal / vertical emphasis
// Wisp
uniform vec4 u_agents[4];    // uv.xy, brightness, size
uniform vec4 u_agent_dir[4]; // direction.xy (screen), speed
uniform int u_agent_count;
// Starry
uniform vec4 u_stars[8];     // uv.xy, radius (uv), pulse
uniform int u_star_count;
uniform float u_hue_shift;
out vec4 frag;
//#include noise

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 acc = texture(u_accum, uv);
  float aspect = u_res.x / u_res.y;
  vec3 col;

#if VARIANT == 0
  // Silk: density → silky ribbons; dust as a sparse starfield.
  float c = 1.0 - exp(-acc.r * u_gain);
  float dust = clamp(acc.g, 0.0, 1.5);
  if (u_light == 1) {
    vec3 ink = mix(vec3(0.02), u_c1 * 0.25, 0.2);
    col = mix(u_paper, ink, min(c * (0.96 + 0.5 * u_pulse), 1.0));
    col = mix(col, ink, dust * 0.6);
  } else {
    // Threads light up on the frame of each bass hit (energy glow).
    float e = 1.0 + 0.6 * u_pulse;
    col = u_bg * 0.6;
    col += u_c0 * c * 1.1 * e;
    col += u_c3 * smoothstep(0.55 - 0.2 * u_pulse, 1.0, c) * 0.9 * e;
    col += mix(u_c0, u_c3, 0.6) * dust * 0.9 * e;
  }
#elif VARIANT == 1
  // Lumen: filaments + a hot core with anamorphic streaks.
  vec3 f = acc.rgb * u_gain;
  // Streak blur of the filament light along both axes.
  vec3 sh = vec3(0.0), sv = vec3(0.0);
  for (int i = 1; i <= 10; i++) {
    float o = float(i * i) * 1.6 / u_res.x;
    float wgt = exp(-float(i) * 0.35);
    sh += (texture(u_accum, uv + vec2(o, 0.0)).rgb + texture(u_accum, uv - vec2(o, 0.0)).rgb) * wgt;
    float ov = float(i * i) * 1.6 / u_res.y;
    sv += (texture(u_accum, uv + vec2(0.0, ov)).rgb + texture(u_accum, uv - vec2(0.0, ov)).rgb) * wgt;
  }
  f += (sh * u_balance.x + sv * u_balance.y) * u_gain * 0.015 * u_streak;
  vec2 d = (uv - u_src) * vec2(aspect, 1.0);
  float core = exp(-dot(d, d) * 2500.0) * 2.2 + exp(-dot(d, d) * 160.0) * 0.35;
  float hx = exp(-abs(d.y) * 260.0) * exp(-abs(d.x) * 3.2) * u_balance.x;
  float vy = exp(-abs(d.x) * 260.0) * exp(-abs(d.y) * 3.2) * u_balance.y;
  vec3 tint = mix(vec3(1.0), u_c3, 0.35);
  col = u_bg * 0.4 + f * mix(vec3(1.0), mix(u_c0, u_c3, 0.5), 0.45) + tint * (core + (hx + vy) * 1.4 * u_streak) * u_fade * (0.6 + 0.6 * u_pulse);
#elif VARIANT == 2
  // Wisp: faint smoke trails, bright darting agents.
  float smoke = 1.0 - exp(-acc.r * u_gain);
  float ring = 1.0 - exp(-acc.g * u_gain);
  vec3 white = mix(vec3(1.0), u_c3, 0.25);
  float e = 1.0 + 1.0 * u_pulse;   // hits flare the trails on the frame
  col = u_bg * 0.4 + (white * smoke * 0.75 + mix(white, u_c0, 0.4) * ring * 0.9) * e;
  for (int i = 0; i < 4; i++) {
    if (i >= u_agent_count) break;
    vec2 q = (uv - u_agents[i].xy) * vec2(aspect, 1.0);
    // Flame: a hot core stretched backwards along the direction of travel.
    vec2 dir = u_agent_dir[i].xy;
    float along = dot(q, dir), across = dot(q, vec2(-dir.y, dir.x));
    float sz = u_agents[i].w;
    float tail = (0.8 + 3.5 * u_agent_dir[i].z);
    float stretch = along < 0.0 ? tail : 0.9;
    float r2 = (along * along) / (sz * sz * stretch * stretch) + (across * across) / (sz * sz * 0.5);
    col += white * u_agents[i].z * (exp(-r2) * 3.2 + exp(-dot(q, q) / (sz * sz) * 0.06) * (0.2 + 0.5 * u_pulse)) * e;
  }
#elif VARIANT == 3
  // Starry: the painted canvas, plus glowing stars with halo rings.
  // The paint brightens on each hit (frame-accurate, the strokes lag).
  col = acc.rgb * (1.0 + 0.45 * u_pulse);
  vec3 warm = hueRotate(u_c2, u_hue_shift * 0.25);
  vec3 hot = hueRotate(u_c3, u_hue_shift * 0.25);
  for (int i = 0; i < 8; i++) {
    if (i >= u_star_count) break;
    vec2 q = (uv - u_stars[i].xy) * vec2(aspect, 1.0);
    float r = length(q) / u_stars[i].z;
    float halo = (0.5 + 0.5 * sin(r * 18.0 - u_time * 1.5)) * smoothstep(3.2, 1.0, r) * smoothstep(0.6, 1.1, r);
    float core = exp(-r * r * 2.2);
    float puls = 0.7 + 0.6 * u_stars[i].w + 0.8 * u_pulse;
    col = mix(col, warm, halo * 0.32 * puls);
    col += hot * core * 1.4 * puls;
  }
#elif VARIANT == 4
  // Warp: streak light over a deep tunnel.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  col = u_bg * (0.5 + 0.5 * smoothstep(0.0, 0.9, length(d))) + acc.rgb * (1.0 + 0.55 * u_pulse);
#endif

  frag = vec4(col, 1.0);
}
