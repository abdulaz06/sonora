#version 300 es
precision mediump float;

in vec2 v_uv;
in vec4 v_color;

out vec4 frag_color;

void main() {
    float dist = length(v_uv);
    // Soft circular particle with glow falloff
    float alpha = 1.0 - smoothstep(0.3, 1.0, dist);
    frag_color = vec4(v_color.rgb, v_color.a * alpha);
}
