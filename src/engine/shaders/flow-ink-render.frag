#version 300 es
precision highp float;

// Flow Field Ink — final render pass.
// Samples the simulated density texture and outputs to the scene FBO,
// where bloom will pick up the bright ink areas.

uniform sampler2D u_density;
uniform vec2  u_resolution;
uniform float u_fade_in_out;
uniform float u_intensity;
uniform vec3  u_bg_color;

out vec4 frag_color;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // Bilinear sample (the texture is set to LINEAR filtering, so this
    // upscales smoothly from the sim resolution).
    vec4 ink = texture(u_density, uv);

    // The ink color was accumulated pre-multiplied by density, so we
    // can read the RGB directly. We boost slightly with intensity so
    // peaks really pop in the bloom pass.
    vec3 color = ink.rgb * (1.1 + u_intensity * 0.4);

    // Subtle background tint so the scene isn't pure black during quiet.
    color += u_bg_color * (0.05 + u_intensity * 0.10);

    // Soft vignette baked in (separate from the post-process vignette,
    // this one keeps the ink centered on the visual focal point).
    vec2 c = uv - 0.5;
    float vig = 1.0 - dot(c, c) * 0.9;
    color *= vig;

    color *= u_fade_in_out;

    frag_color = vec4(color, 1.0);
}
