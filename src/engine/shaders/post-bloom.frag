#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform vec2 u_resolution;
uniform vec2 u_direction; // (1,0) for horizontal, (0,1) for vertical
uniform float u_intensity;

out vec4 frag_color;

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution;
    vec2 texel = u_direction / u_resolution * 2.0;

    // 9-tap Gaussian blur with brightness threshold
    const float weights[5] = float[5](0.227027, 0.194594, 0.121622, 0.054054, 0.016216);

    vec3 result = texture(u_texture, uv).rgb * weights[0];

    for (int i = 1; i < 5; i++) {
        vec2 off = texel * float(i);
        result += texture(u_texture, uv + off).rgb * weights[i];
        result += texture(u_texture, uv - off).rgb * weights[i];
    }

    // Keep moderately bright parts for bloom (lower threshold for more glow)
    float brightness = dot(result, vec3(0.299, 0.587, 0.114));
    result *= smoothstep(0.15, 0.6, brightness) * u_intensity * 0.7;

    frag_color = vec4(result, 1.0);
}
