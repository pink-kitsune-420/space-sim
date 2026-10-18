#version 300 es
precision mediump float;
uniform int u_style;
out vec4 fragColor;
void main() {
  // Stable drawing roles: orbit, trajectory, pad, flame, vessel, wreck, outline, scale,
  // then another of this player's ships (12) and another player's ship (13).
  if (u_style == 1) fragColor = vec4(0.14, 0.22, 0.27, 0.5);
  else if (u_style == 2) fragColor = vec4(0.55, 0.86, 0.76, 0.9);
  else if (u_style == 3) fragColor = vec4(0.86, 0.65, 0.42, 1.0);
  else if (u_style == 4) fragColor = vec4(0.88, 0.65, 0.4, 0.9);
  else if (u_style == 5) fragColor = vec4(0.91, 0.97, 0.94, 1.0);
  else if (u_style == 6) fragColor = vec4(0.94, 0.55, 0.48, 1.0);
  else if (u_style == 7) fragColor = vec4(0.03, 0.06, 0.1, 1.0);
  else if (u_style == 12) fragColor = vec4(0.62, 0.75, 0.79, 1.0);
  else if (u_style == 13) fragColor = vec4(0.97, 0.78, 0.46, 1.0);
  else fragColor = vec4(0.4, 0.5, 0.55, 1.0);
}
