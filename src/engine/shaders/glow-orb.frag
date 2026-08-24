#version 300 es
precision mediump float;

in vec2 v_uv;
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_uv);
    // Very soft radial gradient — much softer than particles
    float glow = exp(-dist * dist * 2.0) * 0.8;
    frag_color = vec4(v_color.rgb, v_color.a * glow);
}
