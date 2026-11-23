#version 300 es
precision highp float;
// Echo display: the smear buffer under the crisp echoes and live figure.
// Dark: light on a palette-tinted black. Paper: ink-like colour on a bone ground.
uniform sampler2D u_trail;
uniform sampler2D u_fig;
uniform sampler2D u_body;        // bodies: r field (1 axis → 0 surface), g coverage, b strength
uniform vec3 u_body_rim;         // rim light colour × intensity (kicks flare it)
uniform vec3 u_body_fill;        // dim fill inside the silhouette
uniform vec3 u_body_core;        // faint inner skeleton
uniform vec2 u_res;
uniform vec3 u_bg;
uniform vec3 u_paper;
uniform float u_light;
uniform float u_time;
uniform vec4 u_pool;             // floor pool under the dancer: screen xy (px), radius x, y (px)
uniform float u_pool_k;          // pool strength (base + kick, on the hit frame)
uniform vec3 u_pool_col;
out vec4 frag;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  vec4 tr = texture(u_trail, uv);
  vec4 fg = texture(u_fig, uv);
  vec4 bd = texture(u_body, uv);
  float bf = bd.r, bc = bd.g, bs = max(bd.b, 1e-3);
  // The silhouette: a rim of light where the field is thin, a dim fill, a faint skeleton along the axes.
  float rim = bc * (1.0 - smoothstep(0.08, 0.32, bf));
  float fill = bc * smoothstep(0.02, 0.25, bf);
  float core = bc * smoothstep(0.78, 0.97, bf);
  vec3 col;
  if (u_light > 0.5) {
    // Ink on paper: coverage darkens toward the figure's own colour (hue kept).
    col = u_paper * (0.97 + 0.03 * smoothstep(1.2, 0.2, length(uv - 0.5)));
    // A soft shadow pool under the dancer that deepens on each kick (local, never the whole page).
    vec2 pd = (gl_FragCoord.xy - u_pool.xy) / max(u_pool.zw, vec2(1.0));
    col = mix(col, u_pool_col, exp(-dot(pd, pd) * 1.6) * u_pool_k);
    vec3 trInk = tr.a > 1e-4 ? tr.rgb / tr.a : vec3(0.0);
    col = mix(col, trInk, clamp(tr.a * 0.8, 0.0, 0.75));
    vec3 fgInk = fg.a > 1e-4 ? fg.rgb / fg.a : vec3(0.0);
    col = mix(col, fgInk, clamp(fg.a, 0.0, 1.0));
    // Bodies on paper: a translucent ink fill, a darker contour.
    col = mix(col, u_body_fill, fill * 0.55 * bs);
    col = mix(col, u_body_rim, rim * 0.85 * bs);
    col += (hash(gl_FragCoord.xy + fract(u_time) * 31.0) - 0.5) * 0.01;
  } else {
    col = u_bg * (0.7 + 0.3 * smoothstep(1.3, 0.1, length(uv - vec2(0.5, 0.45))));
    col += tr.rgb * 0.55 + fg.rgb;
    col += (u_body_rim * rim + u_body_fill * fill + u_body_core * core) * bs;
    // A pool of light on the floor under the dancer, pulsing with the kick.
    vec2 pd = (gl_FragCoord.xy - u_pool.xy) / max(u_pool.zw, vec2(1.0));
    col += u_pool_col * exp(-dot(pd, pd) * 1.4) * u_pool_k;
  }
  frag = vec4(col, 1.0);
}
