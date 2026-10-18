#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform int u_style;
out vec4 fragColor;
void main() {
  float a = texture(u_tex, v_uv).a;
  // Body label (9), star label (10), vessel and telemetry labels (11).
  vec3 color = u_style == 9 ? vec3(123.0, 146.0, 157.0) / 255.0
    : u_style == 10 ? vec3(245.0, 176.0, 65.0) / 255.0
    : vec3(149.0, 169.0, 181.0) / 255.0;
  fragColor = vec4(color, a);
}
