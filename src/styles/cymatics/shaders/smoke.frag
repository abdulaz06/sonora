#version 300 es
precision highp float;
precision highp int;
// Cymatics edge smoke: a small dye field over the plate domain, advected by a
// slow curl-noise flow that leans outward past the plate's edge. It is fed
// where sand crowds the edge (and puffs on kicks), with a fibrous grain along
// the edge, so smoky fur grows off the relief. Sampled mirrored (|x|).
uniform sampler2D u_prev;
uniform sampler2D u_dens;
uniform vec2 u_res;
uniform float u_dt;
uniform float u_time;
uniform float u_extent;
uniform vec2 u_half;
uniform float u_round;
uniform float u_feed;        // steady feed (intensity)
uniform float u_kick;        // puff on kicks
uniform float u_decay;       // per-frame keep at 60 fps
out vec4 frag;
//#include noise

float sdPlate(vec2 p) {
  vec2 q = abs(p) - u_half + u_round;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - u_round;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec2 p = (uv * 2.0 - 1.0) * u_extent;
  float d = sdPlate(p);
  vec2 n = normalize(vec2(sdPlate(p + vec2(0.003, 0.0)) - d, sdPlate(p + vec2(0.0, 0.003)) - d) + 1e-6);
  vec2 vel = curl2(p * 2.4, u_time * 0.12) * 0.07 + n * 0.05 * smoothstep(-0.05, 0.1, d);
  vel *= 1.0 + 1.5 * u_kick;
  vec4 prev = texture(u_prev, uv - vel * u_dt / (2.0 * u_extent));
  // Feed just outside the edge, where sand crowds against it.
  float sand = texture(u_dens, (p - n * 0.06) / u_extent * 0.5 + 0.5).r;
  float band = exp(-pow((d - 0.015) / 0.035, 2.0));
  vec2 t = vec2(-n.y, n.x);
  float fibre = 0.5 + 0.5 * snoise(vec3(dot(p, t) * 60.0, d * 6.0, u_time * 0.3));
  float feed = band * min(sand * 0.05, 1.0) * fibre * (u_feed + 2.5 * u_kick) * u_dt * 6.0;
  float keep = pow(u_decay, u_dt * 60.0);
  frag = vec4(min(prev.r * keep + feed, 1.5), 0.0, 0.0, 1.0);
}
