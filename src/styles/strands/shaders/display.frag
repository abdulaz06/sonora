#version 300 es
precision highp float;
precision highp int;
// Turns the accumulation buffer into the final image per style (silk, wisp, warp).
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
// Wisp
uniform vec4 u_agents[4];    // uv.xy, brightness, size
uniform vec4 u_agent_dir[4]; // direction.xy (screen), speed
uniform int u_agent_count;
// Silk beat warp, applied to the whole image (trails included) on the frame:
// x = zoom punch (fraction), y = snap amplitude (uv), z = time since the hit,
// w = ripple amplitude (uv); u_warp_origin = hit position (uv).
uniform vec4 u_warp;
uniform vec2 u_warp_origin;
out vec4 frag;
//#include noise

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
#if VARIANT == 0
  {
    // Zoom punch toward the screen centre, then a snap + ripple ring that
    // travels out from the hit: the sheet visibly jumps on every kick.
    uv = 0.5 + (uv - 0.5) * (1.0 - u_warp.x);
    vec2 d = (uv - u_warp_origin) * vec2(aspect, 1.0);
    float r = length(d);
    vec2 dir = d / max(r, 1e-4);
    float t = u_warp.z;
    float snap = u_warp.y * exp(-t / 0.18) * cos(t * 16.0) * exp(-r * 1.6);
    float ring = u_warp.w * exp(-t / 0.45) * sin(r * 26.0 - t * 30.0) * exp(-pow((r - t * 1.3) / 0.22, 2.0));
    uv -= dir * (snap + ring) / vec2(aspect, 1.0);
  }
#endif
  vec4 acc = texture(u_accum, uv);
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
#elif VARIANT == 2
  // Wisp: coloured smoke trails, bright darting flames.
  vec3 smoke = 1.0 - exp(-acc.rgb * u_gain);
  vec3 white = mix(vec3(1.0), u_c3, 0.25);
  float e = 1.0 + 0.35 * u_pulse;   // hits flare the trails on the frame
  col = u_bg * 0.5 + smoke * 1.15 * e;
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
    vec3 tint = i == 0 ? u_c0 : i == 1 ? u_c2 : u_c3;
    float core = exp(-r2);
    float halo = exp(-dot(q, q) / (sz * sz) * 0.05);
    col += (mix(tint, white, 0.65) * core * 3.0 + tint * halo * (0.35 + 0.3 * u_pulse)) * u_agents[i].z * e;
  }
#elif VARIANT == 4
  // Warp: streak light over a deep tunnel.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  col = u_bg * (0.5 + 0.5 * smoothstep(0.0, 0.9, length(d))) + acc.rgb * (1.0 + 0.55 * u_pulse);
#endif

  frag = vec4(col, 1.0);
}
