// ── Shared helpers for Ink shaders (injected at //#include common) ──
uvec3 pcg3d(uvec3 v) {
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
vec3 grad3(vec3 c) {
  uvec3 h = pcg3d(uvec3(ivec3(c) + 65536));
  return vec3(h & 0xFFFFu) / 32767.5 - 1.0;
}
float hash12(vec2 p) {
  uvec3 h = pcg3d(uvec3(ivec2(p) + 65536, 7));
  return float(h.x & 0xFFFFu) / 65535.0;
}
// Gradient noise, periodic in xy with integer `period`, free in z. ~[-1,1]
float pnoise(vec3 x, vec2 period) {
  vec3 i = floor(x);
  vec3 f = x - i;
  vec3 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float n[8];
  for (int k = 0; k < 8; k++) {
    vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 c = i + o;
    c.xy = mod(c.xy, period);
    n[k] = dot(grad3(c), f - o);
  }
  float x00 = mix(n[0], n[1], u.x), x10 = mix(n[2], n[3], u.x);
  float x01 = mix(n[4], n[5], u.x), x11 = mix(n[6], n[7], u.x);
  return mix(mix(x00, x10, u.y), mix(x01, x11, u.y), u.z) * 1.6;
}
// Catmull-Rom bicubic sample (9 bilinear taps). `res` = texture size.
vec4 sampleBicubic(sampler2D tex, vec2 uv, vec2 res) {
  vec2 p = uv * res - 0.5;
  vec2 tc = floor(p) + 0.5;
  vec2 f = p - floor(p);
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 o12 = w2 / w12;
  vec2 t0 = (tc - 1.0) / res, t3 = (tc + 2.0) / res, t12 = (tc + o12) / res;
  vec4 r = vec4(0.0);
  r += texture(tex, vec2(t0.x, t0.y)) * w0.x * w0.y;
  r += texture(tex, vec2(t12.x, t0.y)) * w12.x * w0.y;
  r += texture(tex, vec2(t3.x, t0.y)) * w3.x * w0.y;
  r += texture(tex, vec2(t0.x, t12.y)) * w0.x * w12.y;
  r += texture(tex, vec2(t12.x, t12.y)) * w12.x * w12.y;
  r += texture(tex, vec2(t3.x, t12.y)) * w3.x * w12.y;
  r += texture(tex, vec2(t0.x, t3.y)) * w0.x * w3.y;
  r += texture(tex, vec2(t12.x, t3.y)) * w12.x * w3.y;
  r += texture(tex, vec2(t3.x, t3.y)) * w3.x * w3.y;
  return r;
}
