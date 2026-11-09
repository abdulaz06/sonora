// Flow Ink simulation passes. One file, split into programs by
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
  frag = vec4(v, 0.0, 1.0);
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
uniform int u_pass;
void main() {
  vec2 uv = gl_FragCoord.xy * u_dye_texel;
  vec2 v = texture(u_vel, uv).xy / u_sim_res;
  vec2 back = uv - u_dt * v;
  if (u_pass == 0) {
    frag = texture(u_dye, back);
    return;
  }
  vec4 fwd = texture(u_tmp, uv);
  vec4 hatN = texture(u_tmp, uv + u_dt * v);
  vec4 phiN = texture(u_dye, uv);
  vec4 res = fwd + 0.5 * (phiN - hatN);
  vec2 px = back / u_dye_texel - 0.5;
  vec2 c = (floor(px) + 0.5) * u_dye_texel;
  vec4 a = texture(u_dye, c);
  vec4 b = texture(u_dye, c + vec2(u_dye_texel.x, 0.0));
  vec4 d = texture(u_dye, c + vec2(0.0, u_dye_texel.y));
  vec4 e = texture(u_dye, c + u_dye_texel);
  res = clamp(res, min(min(a, b), min(d, e)), max(max(a, b), max(d, e)));
  frag = max(res * exp(-u_dissipation * u_dt) - u_floor_decay * u_dt, 0.0);
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
