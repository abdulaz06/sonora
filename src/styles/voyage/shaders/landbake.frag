#version 300 es
precision highp float;
// Bakes the City world's large-scale layout once into a texture wrapped
// around the cylinder (x = around, y = along the axis):
//   r = terrain height above the mean ground (world units; water carved below 0)
//   g = water: 1 = open water, 0.05-0.5 = shore (closeness to water), 0 = inland
//   b = city mask (kept clear of water and mountains)
//   a = city core (inside cities) or forest density (outside)
// Noise is sampled at the 3D position on the cylinder, so it is seamless all
// the way around. A featured district sits overhead (θ = π) near z = 0 so the
// look-up wide shot always finds a city hanging upside down.
uniform vec2 u_size;
uniform float u_r;
uniform float u_zspan;
out vec4 frag;
//#include noise

float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * snoise(p); p = p * 2.03 + 1.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_size;
  float th = uv.x * 6.2831853;
  float z = (uv.y - 0.5) * u_zspan;
  vec3 P = vec3(sin(th) * u_r, -cos(th) * u_r, z);
  // Terrain: rolling ground plus ridged mountains.
  float roll = fbm3(P * 0.03);
  float ridge = 1.0 - abs(snoise(P * 0.011 + 9.1));
  float mount = pow(ridge, 4.0);
  float h = 0.7 + 0.8 * roll + 3.4 * mount;
  // Water: meandering rivers and a few lakes; a wider buffer keeps cities off the banks.
  float rv = abs(fbm3(P * 0.008 + 4.0));
  float river = smoothstep(0.042, 0.022, rv);
  float lakeN = -snoise(P * 0.012 + 2.0);
  float lake = smoothstep(0.5, 0.62, lakeN);
  float wet = max(river, lake);
  float bank = max(smoothstep(0.085, 0.045, rv), smoothstep(0.4, 0.5, lakeN));
  // Cities: districts where a slow noise peaks, plus the featured one overhead.
  float region = snoise(P * 0.0065 + 2.3) * 0.5 + 0.5;
  vec2 dq = vec2((th - 3.14159265) * u_r, z);
  region = max(region, 0.95 * exp(-dot(dq, dq) / (18.0 * 18.0)));
  float flatLand = 1.0 - smoothstep(0.2, 0.5, mount);
  float city = smoothstep(0.62, 0.7, region) * flatLand * (1.0 - bank);
  float core = smoothstep(0.7, 0.92, region);
  float forest = smoothstep(0.08, 0.32, fbm3(P * 0.04 + 11.0)) * (1.0 - bank) * (1.0 - smoothstep(0.45, 0.75, mount));
  // Cities sit on level ground; water is carved below the waterline.
  h = mix(h, 0.35, city);
  h = mix(h, -0.7, wet);
  float shore = 0.5 * max(smoothstep(0.052, 0.04, rv), smoothstep(0.47, 0.5, lakeN));
  frag = vec4(h, max(wet, shore * (1.0 - wet)), city, city > 0.5 ? core : forest * (1.0 - city));
}
