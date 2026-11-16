// Ink simulation passes. One file, split into programs by
// `//#program <name>` markers (see fluid.ts). Every program shares the header.
#version 300 es
precision highp float;
out vec4 frag;

//#program curl
uniform sampler2D u_vel;
uniform vec2 u_texel;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  float L = texture(u_vel, uv - vec2(u_texel.x, 0.0)).y;
  float R = texture(u_vel, uv + vec2(u_texel.x, 0.0)).y;
  float T = texture(u_vel, uv + vec2(0.0, u_texel.y)).x;
  float B = texture(u_vel, uv - vec2(0.0, u_texel.y)).x;
  frag = vec4(0.5 * (R - L - T + B), 0.0, 0.0, 1.0);
}

//#program forces
// Vorticity confinement + periodic curl-noise stirring + damping.
uniform sampler2D u_vel;
uniform sampler2D u_curl;
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_curl_strength;
uniform float u_damping;       // 1/s
uniform float u_noise_amp;     // texels/s^2
uniform float u_noise_period;  // lattice cells across the domain
uniform float u_noise_z;
uniform float u_noise_detail;  // weight of the finer octaves
// Holds: circles (uv x, y, radius, strength 0-1) where the flow is kept still,
// so a fresh beat shape stays solid before it is released into the flow.
const int MAX_HOLDS = 6;
uniform vec4 u_holds[MAX_HOLDS];
uniform int u_hold_count;
uniform float u_hold_rate;     // 1/s at full strength
//#include common
float potential(vec2 uv) {
  return pnoise(vec3(uv * u_noise_period, u_noise_z), vec2(u_noise_period))
       + u_noise_detail * (0.5 * pnoise(vec3(uv * u_noise_period * 2.0, u_noise_z * 1.7 + 13.0), vec2(u_noise_period * 2.0))
       + 0.25 * pnoise(vec3(uv * u_noise_period * 4.0, u_noise_z * 2.3 + 29.0), vec2(u_noise_period * 4.0)));
}
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  float L = texture(u_curl, uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_curl, uv + vec2(u_texel.x, 0.0)).x;
  float T = texture(u_curl, uv + vec2(0.0, u_texel.y)).x;
  float B = texture(u_curl, uv - vec2(0.0, u_texel.y)).x;
  float C = texture(u_curl, uv).x;
  vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  force /= length(force) + 1e-4;
  force *= u_curl_strength * C;
  force.y *= -1.0;

  float e = 0.5 / u_noise_period;
  float pn = potential(uv + vec2(0.0, e)), ps = potential(uv - vec2(0.0, e));
  float pe = potential(uv + vec2(e, 0.0)), pw = potential(uv - vec2(e, 0.0));
  vec2 stir = vec2(pn - ps, -(pe - pw)) * 0.5;

  vec2 v = texture(u_vel, uv).xy;
  v += (force + stir * u_noise_amp) * u_dt;
  v *= exp(-u_damping * u_dt);
  float hold = 0.0;
  for (int i = 0; i < MAX_HOLDS; i++) {
    if (i >= u_hold_count) break;
    vec2 d = fract(uv - u_holds[i].xy + 0.5) - 0.5;
    hold = max(hold, u_holds[i].w * exp(-dot(d, d) / (u_holds[i].z * u_holds[i].z)));
  }
  v *= exp(-u_hold_rate * hold * u_dt);
  frag = vec4(v, 0.0, 1.0);
}

//#program flowVel
// v0.1 Flow Ink's motion: the velocity IS a curl-noise field (no momentum, no
// pressure, no vorticity), a slow large layer plus a finer layer that grows
// with intensity. Written in sim texels per second. Periodic noise keeps the
// domain seamless; z evolves slowly so the field never repeats.
uniform vec2 u_texel;
uniform vec4 u_period;     // noise cells across the domain (x, y): large layer xy, fine layer zw.
                           // Fewer cells across x: v0.1's square sim was stretched over a wide screen.
uniform float u_detail;    // fine-layer weight (v0.1: 0.4 x intensity)
uniform vec2 u_offset;     // drift of the field (cells of the large layer)
uniform float u_z;         // evolution
uniform float u_speed;     // texels per second per unit of curl
//#include common
vec2 curlAt(vec2 q, float z, vec2 period) {
  float e = 0.05;
  float n1 = pnoise(vec3(q + vec2(0.0, e), z), period);
  float n2 = pnoise(vec3(q - vec2(0.0, e), z), period);
  float n3 = pnoise(vec3(q + vec2(e, 0.0), z), period);
  float n4 = pnoise(vec3(q - vec2(e, 0.0), z), period);
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec2 v = curlAt(uv * u_period.xy + u_offset, u_z, u_period.xy);
  v += u_detail * curlAt(uv * u_period.zw + u_offset * 1.8, u_z * 1.4 + 7.0, u_period.zw);
  frag = vec4(v * u_speed, 0.0, 1.0);
}

//#program divergence
uniform sampler2D u_vel;
uniform vec2 u_texel;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  float L = texture(u_vel, uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_vel, uv + vec2(u_texel.x, 0.0)).x;
  float T = texture(u_vel, uv + vec2(0.0, u_texel.y)).y;
  float B = texture(u_vel, uv - vec2(0.0, u_texel.y)).y;
  frag = vec4(0.5 * (R - L + T - B), 0.0, 0.0, 1.0);
}

//#program scale
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_scale;
void main() { frag = texture(u_src, gl_FragCoord.xy * u_texel) * u_scale; }

//#program pressure
uniform sampler2D u_pressure;
uniform sampler2D u_div;
uniform vec2 u_texel;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  float L = texture(u_pressure, uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_pressure, uv + vec2(u_texel.x, 0.0)).x;
  float T = texture(u_pressure, uv + vec2(0.0, u_texel.y)).x;
  float B = texture(u_pressure, uv - vec2(0.0, u_texel.y)).x;
  float d = texture(u_div, uv).x;
  frag = vec4((L + R + T + B - d) * 0.25, 0.0, 0.0, 1.0);
}

//#program gradient
uniform sampler2D u_pressure;
uniform sampler2D u_vel;
uniform vec2 u_texel;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  float L = texture(u_pressure, uv - vec2(u_texel.x, 0.0)).x;
  float R = texture(u_pressure, uv + vec2(u_texel.x, 0.0)).x;
  float T = texture(u_pressure, uv + vec2(0.0, u_texel.y)).x;
  float B = texture(u_pressure, uv - vec2(0.0, u_texel.y)).x;
  vec2 v = texture(u_vel, uv).xy - 0.5 * vec2(R - L, T - B);
  frag = vec4(v, 0.0, 1.0);
}

//#program advectVel
uniform sampler2D u_vel;
uniform vec2 u_texel;
uniform float u_dt;
uniform float u_dissipation; // 1/s
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec2 v = texture(u_vel, uv).xy;
  vec2 src = uv - u_dt * v * u_texel;
  frag = vec4(texture(u_vel, src).xy * exp(-u_dissipation * u_dt), 0.0, 1.0);
}

//#program advectDye
// Pass 0: semi-Lagrangian forward step. Pass 1: MacCormack correction,
// clamped to the departure neighbourhood (sharp filaments, no overshoot).
uniform sampler2D u_vel;
uniform sampler2D u_dye;     // phi^n
uniform sampler2D u_tmp;     // forward result (pass 1)
uniform vec2 u_dye_texel;
uniform float u_sim_res;
uniform float u_dt;
uniform vec4 u_dissipation;  // per-channel decay, 1/s
uniform vec4 u_floor_decay;  // per-channel subtractive decay, units/s (clears faint haze)
uniform int u_pass;           // 0 forward step, 1 MacCormack, 2 soft single step (v0.1)
uniform vec4 u_cap;           // soft caps per channel (0 = none)
// Beat kicks: a divergent push applied to the ink only (not the velocity
// field, where the pressure solve would cancel it), so ink bursts outward on
// the frame of the hit. xy = centre (uv), z = radius (uv), w = speed (uv/s).
const int MAX_KICKS = 8;
uniform vec4 u_kicks[MAX_KICKS];
uniform int u_kick_count;
// Ambient drizzle (v0.1): faint dots sprinkled in hashed cells, refreshed 12x a
// second, which the flow stretches into sheets. x = dye per second while a dot
// is lit, y = chance a cell lights per refresh, z = cells across the domain.
uniform vec3 u_drizzle;
uniform float u_drizzle_t;
float dhash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
vec2 kickVelocity(vec2 uv) {
  vec2 v = vec2(0.0);
  for (int i = 0; i < MAX_KICKS; i++) {
    if (i >= u_kick_count) break;
    vec4 k = u_kicks[i];
    vec2 d = uv - k.xy;
    d -= floor(d + 0.5);
    float r = length(d) / k.z;
    if (r > 3.0) continue;
    // Lopsided: random 2- and 3-lobe angular strength so bursts tear
    // irregularly instead of stamping discs.
    float ang = atan(d.y, d.x);
    float ph = fract(k.x * 91.7 + k.y * 37.3) * 6.2832;
    float lobes = 0.45 + 0.35 * sin(ang * 2.0 + ph) + 0.3 * sin(ang * 3.0 + ph * 1.7);
    v += (d / max(length(d), 1e-5)) * k.w * max(lobes, 0.05) * min(r * 1.5, 1.0) * exp(-r * r);
  }
  return v;
}
void main() {
  vec2 uv = gl_FragCoord.xy * u_dye_texel;
  vec2 v = texture(u_vel, uv).xy / u_sim_res + kickVelocity(uv);
  vec2 back = uv - u_dt * v;
  if (u_pass == 0) {
    frag = texture(u_dye, back);
    return;
  }
  vec4 res;
  if (u_pass == 2) {
    // Soft semi-Lagrangian step (bilinear): smooth sheets, no fine shimmer.
    res = texture(u_dye, back);
  } else {
    vec4 fwd = texture(u_tmp, uv);
    vec4 hatN = texture(u_tmp, uv + u_dt * v);
    vec4 phiN = texture(u_dye, uv);
    res = fwd + 0.5 * (phiN - hatN);
    vec2 px = back / u_dye_texel - 0.5;
    vec2 c = (floor(px) + 0.5) * u_dye_texel;
    vec4 a = texture(u_dye, c);
    vec4 b = texture(u_dye, c + vec2(u_dye_texel.x, 0.0));
    vec4 d = texture(u_dye, c + vec2(0.0, u_dye_texel.y));
    vec4 e = texture(u_dye, c + u_dye_texel);
    res = clamp(res, min(min(a, b), min(d, e)), max(max(a, b), max(d, e)));
  }
  res = max(res * exp(-u_dissipation * u_dt) - u_floor_decay * u_dt, 0.0);
  if (u_drizzle.y > 0.0) {
    vec2 cell = floor(uv * u_drizzle.z);
    float tick = floor(u_drizzle_t * 12.0);
    if (dhash(cell + tick * 0.618) > 1.0 - u_drizzle.y) {
      // v0.1: the whole cell gets ink (in the second ink colour); the flow and
      // the soft step merge these into broad sheets, the cap flattens them.
      res.y += u_drizzle.x * u_dt;
    }
  }
  if (u_cap.x > 0.0) res = min(res, u_cap);
  frag = res;
}

//#program height
// Downsample + blur dye to sim resolution: rgb = blurred ink, a = lift.
uniform sampler2D u_dye;
uniform vec2 u_texel;
void main() {
  vec2 uv = gl_FragCoord.xy * u_texel;
  vec2 o = u_texel * 0.75;
  vec4 s = texture(u_dye, uv) * 0.25;
  s += texture(u_dye, uv + vec2(o.x, o.y)) * 0.125;
  s += texture(u_dye, uv + vec2(-o.x, o.y)) * 0.125;
  s += texture(u_dye, uv + vec2(o.x, -o.y)) * 0.125;
  s += texture(u_dye, uv + vec2(-o.x, -o.y)) * 0.125;
  s += texture(u_dye, uv + vec2(o.x * 2.0, 0.0)) * 0.0625;
  s += texture(u_dye, uv - vec2(o.x * 2.0, 0.0)) * 0.0625;
  s += texture(u_dye, uv + vec2(0.0, o.y * 2.0)) * 0.0625;
  s += texture(u_dye, uv - vec2(0.0, o.y * 2.0)) * 0.0625;
  frag = s;
}

//#program copy
uniform sampler2D u_src;
uniform vec2 u_texel;
void main() { frag = texture(u_src, gl_FragCoord.xy * u_texel); }
