#version 300 es

// Quad geometry (shared across instances)
layout(location = 0) in vec2 a_quad;

// Per-instance attributes
layout(location = 1) in vec2 a_offset;
layout(location = 2) in float a_size;
layout(location = 3) in float a_alpha;
layout(location = 4) in vec3 a_color;

uniform vec2 u_resolution;

out vec2 v_uv;
out vec4 v_color;

void main() {
    v_uv = a_quad;
    v_color = vec4(a_color, a_alpha);

    float aspect = u_resolution.x / u_resolution.y;
    vec2 pos = a_quad * a_size + a_offset;
    if (aspect > 1.0) {
        pos.x /= aspect;
    } else {
        pos.y *= aspect;
    }

    gl_Position = vec4(pos, 0.0, 1.0);
}
