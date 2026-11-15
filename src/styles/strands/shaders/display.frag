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
#ifdef DEPTH
uniform float u_horizon;      // screen y (uv) of the horizon in the Depth views
uniform int u_scene;          // wisp: 0 ground, 1 tunnel
// Wisp Ground: the camera, to find the ground under each pixel, and the flames
// (world x, y, z, brightness) that light it.
uniform vec3 u_cam_pos;
uniform vec3 u_cam_fwd;
uniform vec3 u_cam_right;
uniform vec3 u_cam_up;
uniform float u_tan_half;
uniform float u_curve_k;
uniform vec2 u_fog;
uniform vec4 u_flame_w[3];
uniform vec2 u_vanish;        // wisp tunnel: screen uv of the tunnel's far end
#endif
out vec4 frag;
//#include noise

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  float aspect = u_res.x / u_res.y;
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
#ifdef DEPTH
  if (u_scene == 0) {
    // Ground: each flame lights the dark ground beneath it like a lantern, so
    // its height and distance read at a glance. Ray-traced against the same
    // curved ground the particles use.
    vec3 rd = normalize(u_cam_fwd + (u_cam_right * (uv.x * 2.0 - 1.0) * aspect + u_cam_up * (uv.y * 2.0 - 1.0)) * u_tan_half);
    float qa = u_curve_k * dot(rd.xz, rd.xz), qb = rd.y, qc = u_cam_pos.y;
    float t = -1.0;
    if (abs(qa) < 1e-5) { if (qb < 0.0) t = -qc / qb; }
    else {
      float disc = qb * qb - 4.0 * qa * qc;
      if (disc >= 0.0) {
        float sq = sqrt(disc);
        float t1 = (-qb - sq) / (2.0 * qa), t2 = (-qb + sq) / (2.0 * qa);
        t = min(t1 > 0.0 ? t1 : 1e9, t2 > 0.0 ? t2 : 1e9);
        if (t > 1e8) t = -1.0;
      }
    }
    if (t > 0.0) {
      vec3 P = u_cam_pos + rd * t;
      vec2 g = P.xz;
      // Dark sand: soft ripples and grain, only visible where lit.
      float rip = 0.5 + 0.5 * sin(dot(g, vec2(0.8, 0.6)) * 38.0 + snoise(vec3(g * 2.5, 0.0)) * 3.0);
      float tex = 0.45 + 0.35 * rip + 0.2 * snoise(vec3(g * 14.0, 1.0));
      vec3 pool = vec3(0.0);
      for (int i = 0; i < 3; i++) {
        vec3 f = u_flame_w[i].xyz;
        float hgt = max(f.y - P.y, 0.02);
        vec2 dd = g - f.xz;
        float d2 = dot(dd, dd) + hgt * hgt;
        vec3 tint = i == 0 ? u_c0 : i == 1 ? u_c2 : u_c3;
        pool += tint * u_flame_w[i].w * 0.012 * hgt / (d2 * sqrt(d2) + 1e-4);
      }
      float fog = 1.0 - smoothstep(u_fog.x, u_fog.y, t);
      col += min(pool, vec3(1.5)) * tex * fog * 0.55;
    }
  } else {
    // Tunnel: a faint glow at the far end draws the eye down the tunnel.
    vec2 dv = (uv - u_vanish) * vec2(aspect, 1.0);
    col += mix(u_c2, u_c0, 0.5) * 0.07 * exp(-length(dv) * 5.0);
  }
#endif
#elif VARIANT == 4
  // Warp: streak light over a deep tunnel.
  vec2 d = (uv - 0.5) * vec2(aspect, 1.0);
  col = u_bg * (0.5 + 0.5 * smoothstep(0.0, 0.9, length(d))) + acc.rgb * (1.0 + 0.55 * u_pulse);
#endif

#ifdef DEPTH
  // A faint horizon glow gives the 3D views a sense of ground and distance.
  if (u_light == 0 && !(VARIANT == 2 && u_scene == 1)) col += mix(u_c1, u_c0, 0.5) * 0.06 * exp(-abs(uv.y - u_horizon) * 9.0);
#endif
  frag = vec4(col, 1.0);
}
