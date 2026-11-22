#version 300 es
precision highp float;
precision highp int;
// Memory splats: one instance per splat (in back-to-front order). Each is a
// flat disc on the scanned surface (normal + radius), projected as a 2D
// Gaussian (EWA: the 3D covariance through the view and the projection's
// Jacobian), drawn as a quad of ±3σ. Reactive offsets move splats before
// projection: beat dissolve, bass push along the view, build pull-apart.
layout(location = 0) in vec2 a_corner;
layout(location = 1) in uint a_index;
uniform highp sampler2D u_pos;      // xyz, hash
uniform highp sampler2D u_nrm;      // normal xyz, radius
uniform highp sampler2D u_col;      // rgba8
uniform int u_tex_w;
uniform mat4 u_view;
uniform mat4 u_proj;
uniform vec2 u_res;
uniform vec2 u_focal;               // pixels
uniform vec3 u_cam;
uniform float u_time;
uniform float u_dissolve;           // beat envelope: splats break into drifting points
uniform float u_push;               // bass: splats pushed outward along the view
uniform float u_apart;              // build: the world pulls apart (snaps back on the drop)
uniform float u_points;             // breakdown: a point cloud (tiny glowing points)
uniform float u_fog_far;
uniform float u_fog_near;
uniform vec3 u_fog_col;
uniform vec3 u_light;               // palette light (highlights lean toward it)
uniform vec3 u_shadow;              // palette shade (shadows lean toward it)
uniform float u_grade;              // how far the palette grades the scan (keeps it natural)
uniform float u_edge;               // the frame's edges dissolve into the fog
uniform float u_glow;               // point cloud: points glow
uniform float u_lift_share;         // share of splats that lift off on a kick
uniform float u_lift_glow;          // how bright the lifting splats glow
uniform vec3 u_ring;                // kick light ring: radius (m), amplitude, width (m)
uniform float u_ring_gain;          // how bright the ring lights what it passes
uniform float u_ring_cap;           // the ring lifts colours up to this luminance, never past it
uniform vec3 u_gain;                // the look's light (the desert: a moonlit night in the palette's hue)
out vec4 v_col;
out vec2 v_g;                       // gaussian coordinates (σ units)
out float v_point;

vec3 hash3(float h) { return fract(vec3(h * 127.1, h * 311.7, h * 74.7) * 43.758) * 2.0 - 1.0; }

void main() {
  int i = int(a_index);
  ivec2 tc = ivec2(i % u_tex_w, i / u_tex_w);
  vec4 P = texelFetch(u_pos, tc, 0);
  vec4 N = texelFetch(u_nrm, tc, 0);
  vec4 C = texelFetch(u_col, tc, 0);
  vec3 p = P.xyz;
  float h = P.w;
  vec3 dir = normalize(hash3(h) + vec3(0.0, 0.3, 0.0));
  // Build: drift apart on slow noise; drop: snap back (u_apart falls fast).
  p += dir * u_apart * (0.4 + 1.6 * fract(h * 7.31)) + vec3(sin(u_time * 0.3 + h * 40.0), 0.6, cos(u_time * 0.27 + h * 31.0)) * u_apart * 0.4;
  // Beat dissolve: a share of splats lift off into drifting points.
  float lift = step(1.0 - u_lift_share, fract(h * 13.7)) * u_dissolve;
  p += dir * lift * 0.25 + vec3(0.0, lift * 0.15, 0.0);
  // Bass push: outward along the view ray.
  vec3 ray = p - u_cam;
  float dist = length(ray);
  p += ray / max(dist, 1e-3) * u_push * 0.35 * smoothstep(0.5, 6.0, dist);

  vec4 vp = u_view * vec4(p, 1.0);
  if (vp.z > -0.08 || -vp.z > u_fog_far * 1.2) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  // 3D covariance of a flat disc: r² in the tangent plane, a thin r/5 along the normal.
  float r = N.w * mix(1.0, 0.35, lift) * mix(1.0, 0.18, u_points);
  vec3 n = normalize(N.xyz);
  mat3 S = r * r * (mat3(1.0) - outerProduct(n, n)) + (r * 0.2) * (r * 0.2) * outerProduct(n, n);
  mat3 W = mat3(u_view);
  mat3 V = W * S * transpose(W);
  float z = -vp.z;
  mat3 J = mat3(u_focal.x / z, 0.0, 0.0, 0.0, u_focal.y / z, 0.0, u_focal.x * vp.x / (z * z), u_focal.y * vp.y / (z * z), 0.0);
  mat3 cov = J * V * transpose(J);
  float a = cov[0][0] + 0.3, b = cov[0][1], c = cov[1][1] + 0.3;
  // Eigenvectors of the 2D covariance → the ellipse's axes (pixels).
  float mid = 0.5 * (a + c), rad = length(vec2(0.5 * (a - c), b));
  float l1 = mid + rad, l2 = max(mid - rad, 0.1);
  vec2 e1 = normalize(vec2(b, l1 - a) + vec2(1e-6, 0.0));
  vec2 e2 = vec2(-e1.y, e1.x);
  float s1 = min(sqrt(l1) * 3.0, 1024.0), s2 = min(sqrt(l2) * 3.0, 1024.0);
  // Point cloud: every splat becomes a small round point.
  float pt = max(1.6, 2.2 * u_points);
  s1 = mix(s1, pt, u_points * step(pt, s1)); s2 = mix(s2, pt, u_points * step(pt, s2));
  vec4 clip = u_proj * vp;
  vec2 offset = (a_corner.x * e1 * s1 + a_corner.y * e2 * s2) / u_res * 2.0;
  gl_Position = vec4(clip.xy / clip.w + offset, clip.z / clip.w, 1.0);
  v_g = a_corner * 3.0;
  // Grade: shadows toward the palette's shade, highlights toward its light; keep the scan natural.
  vec3 col = C.rgb;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec3 graded = mix(u_shadow, u_light, smoothstep(0.0, 0.75, lum)) * (0.35 + 1.25 * lum);
  col = mix(col, graded, u_grade);
  col *= u_gain;
  col *= 1.0 + u_glow * (0.6 + 1.4 * fract(h * 3.7));
  // Splats lifting off on the kick catch the light (capped like the ring: never past the fog).
  col *= min(1.0 + lift * u_lift_glow, max(1.0, u_ring_cap / max(dot(col, vec3(0.299, 0.587, 0.114)), 1e-3)));
  // Each kick sends a ring of light out from the walker through the scene: what it passes lights
  // up for a moment (local, so the fog and the shadows never pulse as a whole).
  // It lifts darks and mid-tones only: the brightest parts (a bright fog, sunlit sand) never pulse.
  float rd_ = (dist - u_ring.x) / u_ring.z;
  float lum0 = max(dot(col, vec3(0.299, 0.587, 0.114)), 1e-3);
  // Nothing right at the lens flashes (a near rock fills a third of the frame).
  col *= min(1.0 + u_ring.y * u_ring_gain * exp(-rd_ * rd_) * smoothstep(1.8, 4.0, dist), max(1.0, u_ring_cap / lum0));
  // Fog, and the frame's edges dissolving into it (reel01).
  vec2 ndc = clip.xy / clip.w;
  float fog = smoothstep(u_fog_near, u_fog_far, z);
  fog = max(fog, smoothstep(0.6, 1.25, length(ndc * vec2(0.85, 1.0))) * u_edge);
  col = mix(col, u_fog_col, fog);
  // Splats right at the lens would smear into smoke: they fade out.
  v_col = vec4(col, C.a * (1.0 - fog * 0.9) * mix(1.0, 0.9, u_points) * smoothstep(0.35, 1.3, z));
  v_point = u_points;
}
