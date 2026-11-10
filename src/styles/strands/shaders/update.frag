#version 300 es
precision highp float;
precision highp int;
// Strands particle update (one texel = one particle). VARIANT is defined by
// the host: 0 silk, 1 lumen, 2 wisp, 3 starry, 4 warp.
//   stateA = position.xy, velocity.xy        (warp: position.xyz, speed)
//   stateB = age, life, seed, kind
uniform sampler2D u_stateA;
uniform sampler2D u_stateB;
uniform float u_time;
uniform float u_dt;
uniform float u_init;          // 1 on the first frame: spawn everything
uniform vec2 u_center;         // camera centre (world)
uniform float u_view;          // world units visible vertically
uniform float u_aspect;
uniform float u_intensity;
uniform float u_fade;
uniform float u_speed;         // variant speed multiplier from audio
uniform float u_field_t;       // flow-field evolution coordinate
uniform float u_field_scale;
uniform float u_active;        // fraction of particles alive (presence)
// Silk emitters: segments (a.xy, b.xy)
uniform vec4 u_emit[4];
uniform int u_emit_count;
// Shockwaves: centre.xy, radius, strength
uniform vec4 u_shock[4];
uniform int u_shock_count;
// Lumen source: xy, spread (0 star .. 1 X), angle
uniform vec4 u_source;
uniform vec2 u_balance;        // lumen: horizontal / vertical emphasis
// Wisp agents: pos.xy, vel.xy
uniform vec4 u_agents[4];
uniform int u_agent_count;
uniform vec4 u_ring;           // wisp ring burst: centre.xy, age, strength
// Starry vortices: pos.xy, strength, radius
uniform vec4 u_vort[8];
uniform int u_vort_count;
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
//#include noise

vec2 starryField(vec2 p) {
  vec2 v = curl2(p * 1.3, u_field_t) * 0.25;
  for (int i = 0; i < 8; i++) {
    if (i >= u_vort_count) break;
    vec2 d = p - u_vort[i].xy;
    float r2 = dot(d, d);
    float rr = u_vort[i].w * u_vort[i].w;
    v += vec2(-d.y, d.x) * u_vort[i].z * exp(-r2 / rr) / (sqrt(r2) + 0.05);
  }
  return v;
}

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(u_stateA, id, 0);
  vec4 B = texelFetch(u_stateB, id, 0);
  float age = B.x, life = B.y, seed = B.z, kind = B.w;
  vec4 r = rand4(uvec2(id), uint(u_time * 997.0) + 17u);
  float dt = u_dt;
  vec2 half_ = vec2(u_view * 0.5 * u_aspect, u_view * 0.5);

  bool respawn = u_init > 0.5 || age > life;

#if VARIANT == 4
  // ── Warp: particles in a tunnel rushing toward the camera (z → 0) ──
  if (u_init > 0.5) { seed = rand4(uvec2(id), 3u).x; A.z = -1.0 - r.z * 45.0; respawn = true; }
  A.z += u_speed * dt;
  float spin = 0.06 * dt * (1.0 + u_intensity);
  A.xy = mat2(cos(spin), sin(spin), -sin(spin), cos(spin)) * A.xy;
  if (A.z > -0.15 || respawn) {
    float ang = r.x * 6.2832;
    float rad = 0.25 + 3.5 * pow(r.y, 0.7);
    A.xy = vec2(cos(ang), sin(ang)) * rad;
    if (A.z > -0.15 || u_init < 0.5) A.z = -40.0 - r.z * 8.0;
    age = 0.0; life = 1e6;
  }
  A.w = u_speed;
  outA = A;
  outB = vec4(age + dt, life, seed, kind);
  return;
#endif

  if (respawn) {
    seed = rand4(uvec2(id), 5u).x;
    age = u_init > 0.5 ? -r.w * 6.0 : 0.0;
#if VARIANT == 0
    // Silk: 12% dust, the rest spawn along emitter segments → ribbons.
    kind = seed < 0.05 ? 1.0 : 0.0;
    if (kind > 0.5) {
      A.xy = u_center + (r.xy * 2.0 - 1.0) * half_ * 1.6;
      A.zw = vec2(0.0);
      life = 6.0 + r.z * 10.0;
    } else {
      int e = int(floor(r.z * float(max(u_emit_count, 1))));
      vec4 seg = u_emit[min(e, 3)];
      // Quantised lanes: each ribbon is a bundle of hair-thin threads.
      float lane = (floor(r.x * 56.0) + 0.5) / 56.0;
      A.xy = mix(seg.xy, seg.zw, lane) + (r.yw - 0.5) * 0.0006;
      A.zw = vec2(0.0);
      life = 2.5 + r.y * 4.5;
    }
#elif VARIANT == 1
    // Lumen: burst from the source along a cross (quiet) or an X (loud).
    float pick = r.x;
    float base;
    float spread = u_source.z;
    if (pick < u_balance.x) base = (r.y < 0.5 ? 0.0 : 3.14159);
    else if (pick < u_balance.x + u_balance.y) base = (r.y < 0.5 ? 1.5708 : -1.5708);
    else base = 0.7854 + floor(r.y * 4.0) * 1.5708;
    // Discrete rays (lanes) read as individual hair-thin filaments.
    float lane = (floor(r.z * 120.0) + 0.5) / 120.0 - 0.5;
    float jitter = lane * mix(0.05, 0.38, spread * spread) + (r.w - 0.5) * 0.002;
    float ang = base + jitter + u_source.w;
    float sp = (0.15 + 1.1 * pow(fract(r.w * 7.31), 2.0)) * u_speed;
    A.xy = u_source.xy + (r.zw - 0.5) * 0.006;
    A.zw = vec2(cos(ang), sin(ang)) * sp;
    kind = fract(seed * 13.7);
    life = 0.5 + 1.6 * fract(r.z * 3.7);
#elif VARIANT == 2
    // Wisp: smoke shed by an agent, or a ring around it after a bass hit.
    int a = int(floor(r.z * float(max(u_agent_count, 1))));
    vec4 ag = u_agents[min(a, 3)];
    if (u_ring.w > 0.01 && u_ring.z < 0.35 && r.w < 0.55) {
      float ang = r.x * 6.2832;
      vec2 dir = vec2(cos(ang), sin(ang));
      A.xy = u_ring.xy + dir * (0.02 + r.y * 0.01);
      A.zw = dir * (0.12 + 0.1 * r.y) * u_ring.w + vec2(-dir.y, dir.x) * 0.03;
      kind = 1.0;
    } else {
      A.xy = ag.xy + (r.xy - 0.5) * 0.01;
      A.zw = -ag.zw * 0.15 + (r.yx - 0.5) * 0.05;
      kind = 0.0;
    }
    life = 1.8 + r.y * 4.0;
#elif VARIANT == 3
    // Starry: brushstrokes anywhere in (and around) the view.
    A.xy = u_center + (r.xy * 2.0 - 1.0) * half_ * 1.25;
    A.zw = vec2(0.0);
    kind = r.z;
    life = 2.0 + r.w * 4.0;
#endif
  }

  // ── Motion ──
  vec2 p = A.xy;
  vec2 v = A.zw;
#if VARIANT == 0
  vec2 field = curl2(p * u_field_scale, u_field_t) * 0.11 * u_speed;
  if (kind > 0.5) {
    v = field * 0.1;
  } else {
    v = mix(v, field, 1.0 - exp(-dt * 3.5));
  }
  for (int i = 0; i < 4; i++) {
    if (i >= u_shock_count) break;
    vec2 d = p - u_shock[i].xy;
    float rr = length(d);
    float ring = exp(-pow((rr - u_shock[i].z) / 0.06, 2.0));
    v += d / max(rr, 1e-4) * u_shock[i].w * ring * dt * 9.0;
  }
#elif VARIANT == 1
  // Fine wiggle only: the filaments stay straight-ish, like hair.
  v += curl2(p * 22.0, u_field_t * 2.0) * 0.11 * dt * (0.4 + u_intensity) * length(v);
  v *= exp(-dt * 0.6);
#elif VARIANT == 2
  v += curl2(p * 4.0, u_field_t) * 0.05 * dt;
  v *= exp(-dt * (kind > 0.5 ? 1.6 : 0.7));
#elif VARIANT == 3
  vec2 f = starryField(p);
  v = mix(v, f * 0.12 * u_speed, 1.0 - exp(-dt * 6.0));
#endif
  p += v * dt;

  // Leaving the area: recycle early.
  vec2 rel = (p - u_center) / half_;
#if VARIANT == 1
  if (length(p - u_source.xy) > u_view * 1.4) age = life + 1.0;
#elif VARIANT == 2
  if (max(abs(rel.x), abs(rel.y)) > 2.5) age = life + 1.0;
#else
  if (max(abs(rel.x), abs(rel.y)) > 1.9) age = life + 1.0;
#endif

  outA = vec4(p, v);
  outB = vec4(age + dt, life, seed, kind);
}
