#version 300 es

layout(location = 0) in vec2 a_position;
layout(location = 1) in float a_alpha;
layout(location = 2) in vec3 a_color;

uniform vec2 u_resolution;

out float v_alpha;
out vec3 v_color;

void main() {
    v_alpha = a_alpha;
    v_color = a_color;

    vec2 pos = a_position;
    float aspect = u_resolution.x / u_resolution.y;
    if (aspect > 1.0) {
        pos.x /= aspect;
    } else {
        pos.y *= aspect;
    }

    gl_Position = vec4(pos, 0.0, 1.0);
}
