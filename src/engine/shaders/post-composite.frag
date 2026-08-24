#version 300 es
precision highp float;

uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_bloom_strength;
uniform float u_grain_amount;
uniform float u_vignette_strength;
uniform vec3 u_tint; // Palette tint for color grading

out vec4 frag_color;

float random(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;

    // Sample scene and bloom
    vec3 scene = texture(u_scene, uv).rgb;
    vec3 bloom = texture(u_bloom, uv).rgb;

    // Additive bloom (subtle)
    vec3 color = scene + bloom * u_bloom_strength;

    // Film grain (apply early, before tonemap)
    float grain = (random(uv + fract(u_time)) - 0.5) * u_grain_amount;
    color += grain;

    // Vignette
    vec2 vig_uv = uv * 2.0 - 1.0;
    float vig = 1.0 - dot(vig_uv, vig_uv) * u_vignette_strength;
    vig = clamp(vig, 0.0, 1.0);
    color *= vig;

    // Hue-preserving tonemap: compress luminance only, keep saturation
    float lum = dot(color, vec3(0.299, 0.587, 0.114));
    float mappedLum = lum / (lum + 0.6); // soft compress
    if (lum > 0.001) {
        color *= mappedLum / lum;
    }

    // Clamp
    color = clamp(color, 0.0, 1.0);

    frag_color = vec4(color, 1.0);
}
