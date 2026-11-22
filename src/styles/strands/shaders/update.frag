#version 300 es
precision highp float;
precision highp int;
// Strands particle update (one texel = one particle). VARIANT is defined by
// the host: 0 silk, 2 wisp, 4 warp (1 and 3 were retired looks).
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
// Wisp agents: pos.xy, vel.xy
uniform vec4 u_agents[4];
uniform int u_agent_count;
uniform vec4 u_ring;           // wisp ring burst: centre.xy, age, strength
// Silk drop arc: core (world), gather (build), burst (drop), formation weight
uniform vec2 u_core;
uniform float u_embers;        // Wisp Depth Ground: share of particles that are floating embers (0 = off)
uniform float u_ember_kick;    // Wisp Depth Ground: beat envelope that stirs the embers
uniform float u_gather;
uniform float u_burst;
uniform float u_form;
#ifdef HELIX
// Silk Helix: threads ride twisted strands around an axis; glints orbit it.
uniform vec2 u_hx_origin;      // axis centre (Flat: world) / foot on the ground (Depth: sim units)
uniform vec2 u_hx_dir;         // Flat: axis direction (unit)
uniform float u_hx_len;        // half the axis length (world / height units)
uniform float u_hx_radius;
uniform float u_hx_twist;      // radians per unit along the axis
uniform float u_hx_phase;      // rotation phase (twist speed rides intensity)
uniform float u_hx_third;      // 0..1: third strand (drops)
uniform float u_hx_burst;      // drop: the helix unwinds outward, then re-forms
uniform float u_hx_flow;       // threads travel along their strand (units/s)
uniform vec4 u_hx_pluck[4];    // kick plucks: axis position, age, strength
uniform int u_hx_pluck_count;
uniform float u_hx_depth;      // 1 in the Depth view
uniform float u_hx_hc;
uniform float u_hx_kick;       // bass-hit envelope         // Depth: height of the column's centre (on the camera's line of sight)
#endif
layout(location = 0) out vec4 outA;
layout(location = 1) out vec4 outB;
//#include noise

void main() {
  ivec2 id = ivec2(gl_FragCoord.xy);
  vec4 A = texelFetch(u_stateA, id, 0);
  vec4 B = texelFetch(u_stateB, id, 0);
  float age = B.x, life = B.y, seed = B.z, kind = B.w;
  vec4 r = rand4(uvec2(id), uint(u_time * 997.0) + 17u);
  float dt = u_dt;
  vec2 half_ = vec2(u_view * 0.5 * u_aspect, u_view * 0.5);

  bool respawn = u_init > 0.5 || age > life;

#ifdef HELIX
  // Positions are a function of the particle's seed, its age and the shared
  // helix state, so threads stay exactly on their strands (no drift).
  if (respawn) {
    seed = rand4(uvec2(id), 5u).x;
    age = u_init > 0.5 ? -r.w * 2.0 : 0.0;
    life = 2.5 + r.y * 4.5;
    kind = fract(seed * 977.0) < 0.008 ? 1.0 : 0.0;
  }
  {
    const float PI = 3.14159265;
    float h1 = fract(seed * 13.17), h2 = fract(seed * 71.31), h3 = fract(seed * 5.77), h4 = fract(seed * 191.3);
    float a = max(age, 0.0);
    float L = u_hx_len;
    vec2 perp = vec2(-u_hx_dir.y, u_hx_dir.x);
    float s, phi, R, wgt = 1.0;
    if (kind < 0.5) {
      float k = floor(h1 * 3.0);
      // Each strand is a ribbon of hair-thin threads (quantised lanes).
      float lane = (floor(h2 * 14.0) + 0.5) / 14.0 - 0.5;
      s = mod(h3 * 2.0 * L + a * u_hx_flow * (0.6 + 0.8 * h4), 2.0 * L) - L;
      float off = k < 0.5 ? 0.0 : k < 1.5 ? mix(PI, 2.0 * PI / 3.0, u_hx_third) : mix(PI, 4.0 * PI / 3.0, u_hx_third);
      if (k > 1.5) wgt = u_hx_third;
      phi = u_hx_phase + s * u_hx_twist * (1.0 - 0.8 * u_hx_burst) + off + lane * 0.38;
      R = u_hx_radius * (1.0 + lane * 0.22);
      // Hourglass: the strands pinch where they cross near the middle.
      float pinch = sin(u_hx_phase * 0.13) * 0.25 * L;
      R *= 0.42 + 0.68 * smoothstep(0.0, 0.85 * L, abs(s - pinch));
      for (int i = 0; i < 4; i++) {
        if (i >= u_hx_pluck_count) break;
        vec4 pl = u_hx_pluck[i];
        float d = abs(s - pl.x);
        float front = pl.y * 1.8 * L;
        R *= 1.0 + pl.z * 0.55 * exp(-pow((d - front) / (0.1 * L), 2.0)) * exp(-pl.y / 0.55);
      }
    } else {
      // Glints: short dashes circling the axis.
      s = (h3 * 2.0 - 1.0) * L * 0.9;
      // Thick near the strands, thinning outward (no visible edge).
      R = u_hx_radius * (1.05 + (u_hx_depth > 0.5 ? 0.9 : 1.4) * h1 * h1);
      phi = h2 * 6.2832 + a * (0.7 + 1.3 * h4) * (h1 < 0.5 ? 1.0 : -1.0) + u_hx_phase * 0.6;
    }
    // Kicks breathe the whole helix out a little (large, frame-accurate motion).
    R *= 1.0 + u_hx_kick * 0.16;
    // Drop: every thread flies out by its own amount, then eases back.
    R *= 1.0 + u_hx_burst * (0.5 + 1.7 * h4);
    // Ends of the axis fade (no hard cut where the strands leave the frame).
    wgt *= smoothstep(L, L * 0.75, abs(s));
    if (u_hx_depth > 0.5) {
      A.xy = u_hx_origin + R * vec2(sin(phi), cos(phi));
      A.z = s + u_hx_hc;
      A.w = wgt;
    } else {
      float across = R * sin(phi);
      // Glints draw circles in the picture (seen a little from above).
      float along = kind > 0.5 ? R * 0.42 * cos(phi) : 0.0;
      A.xy = u_hx_origin + u_hx_dir * (s + along) + perp * across;
      // Front threads brighter than the ones behind the axis.
      A.z = 0.45 + 0.55 * (0.5 + 0.5 * cos(phi));
      A.w = wgt;
    }
    outA = A;
    outB = vec4(age + dt, life, seed, kind);
    return;
  }
#endif

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
#elif VARIANT == 2
    // Wisp: smoke shed by an agent, or a ring around it after a bass hit.
    int a = int(floor(r.z * float(max(u_agent_count, 1))));
    vec4 ag = u_agents[min(a, 3)];
    if (seed < u_embers) {
      // Ember: floats anywhere in the region (Depth gives it a height).
      A.xy = u_center + (r.xy * 2.0 - 1.0) * half_ * 1.6;
      A.zw = vec2(0.0);
      kind = 4.0;
      life = 8.0 + r.y * 10.0;
    } else if (u_ring.w > 0.01 && u_ring.z < 0.35 && r.w < 0.75) {
      float ang = r.x * 6.2832;
      vec2 dir = vec2(cos(ang), sin(ang));
      A.xy = u_ring.xy + dir * (0.02 + r.y * 0.01);
      A.zw = dir * (0.17 + 0.14 * r.y) * u_ring.w + vec2(-dir.y, dir.x) * 0.04;
      kind = 3.0;   // ring smoke
    } else {
      A.xy = ag.xy + (r.xy - 0.5) * 0.01;
      A.zw = -ag.zw * 0.15 + (r.yx - 0.5) * 0.05;
      kind = float(min(a, 2));   // smoke tinted by its agent
    }
    life = 1.8 + r.y * 4.0;
#endif
  }

  // ── Motion ──
  vec2 p = A.xy;
  vec2 v = A.zw;
#if VARIANT == 0
  vec2 field = curl2(p * u_field_scale, u_field_t) * 0.11 * u_speed;
  // Drop arc: the build pulls threads into a swirling knot, the drop bursts
  // them outward, then they stream along radial spokes for a few seconds.
  vec2 toC = u_core - p;
  float dc = length(toC) + 1e-4;
  vec2 inw = toC / dc;
  field = mix(field, -inw * 0.16 * u_speed, u_form * 0.85);
  v += (inw * 0.18 + vec2(-inw.y, inw.x) * 0.24) * u_gather * u_speed * dt * 3.0;
  v -= inw * u_burst * 9.0 * dt * exp(-dc / (u_view * 0.9));
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
#elif VARIANT == 2
  if (kind > 3.5) {
    // Embers: each drifts on its own (own phase of the field and its own
    // heading), so they never trace one shared pattern; the flames sweep them
    // into swirling wakes; bass rings blow them outward; beats stir them.
    float ph = fract(seed * 13.7) * 40.0;
    vec2 own = vec2(cos(seed * 91.0), sin(seed * 91.0)) * (0.006 + 0.01 * fract(seed * 7.3));
    vec2 target = curl2(p * (1.1 + fract(seed * 3.1)) + ph, u_field_t * (0.7 + 0.6 * fract(seed * 5.9)) + ph) * 0.03 + own;
    for (int i = 0; i < 4; i++) {
      if (i >= u_agent_count) break;
      vec2 d = p - u_agents[i].xy;
      float r2 = dot(d, d);
      float near = exp(-r2 / 0.012);
      // Dragged along behind the flame and spun around its path.
      target += (u_agents[i].zw * 0.8 + vec2(-d.y, d.x) * 2.2) * near;
    }
    if (u_ring.w > 0.01 && u_ring.z < 1.2) {
      vec2 d = p - u_ring.xy;
      float rr = length(d);
      float front = 0.05 + u_ring.z * 0.35;
      target += d / max(rr, 1e-4) * u_ring.w * 0.35 * exp(-pow((rr - front) / 0.05, 2.0));
    }
    target *= 1.0 + 1.5 * u_ember_kick;
    v = mix(v, target, 1.0 - exp(-dt * 4.0));
  } else {
    v += curl2(p * 4.0, u_field_t) * 0.05 * dt;
    v *= exp(-dt * (kind > 2.5 ? 1.6 : 0.7));
  }
#endif
  p += v * dt;

  // Leaving the area: recycle early.
  vec2 rel = (p - u_center) / half_;
#if VARIANT == 2
  if (max(abs(rel.x), abs(rel.y)) > 2.5) age = life + 1.0;
#else
  if (max(abs(rel.x), abs(rel.y)) > 1.9) age = life + 1.0;
#endif

  outA = vec4(p, v);
  outB = vec4(age + dt, life, seed, kind);
}
