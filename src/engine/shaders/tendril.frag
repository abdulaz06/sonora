#version 300 es
precision mediump float;

in float v_alpha;
in vec3 v_color;

out vec4 frag_color;

void main() {
    frag_color = vec4(v_color, v_alpha);
}
