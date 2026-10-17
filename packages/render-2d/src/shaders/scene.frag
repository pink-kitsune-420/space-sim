#version 300 es
precision highp float;

in vec2 v_uv;
out vec4 fragColor;

uniform vec2 u_resolution;

struct Body {
  vec2 screenPos;
  vec2 horizonPoint;
  vec2 horizonNormal;
  float radius;
  vec3 color;
  vec3 accent;
  vec4 atmosphere;
  int isStar;
  vec2 sunDir; // screen direction (y down) to the star; zero when unlit
};

uniform int u_bodyCount;
uniform Body u_bodies[8];

// Day/night: 1 by day, 0.35 at night, smooth across the terminator (see lighting.ts).
float daylight(float c) { return 0.35 + 0.65 * smoothstep(-0.18, 0.18, c); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  vec2 pixelPos = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
  vec3 col = vec3(0.031, 0.059, 0.098); // #080f19

  // Procedural background stars
  vec2 gridCoord = floor(pixelPos / 60.0);
  float starVal = hash(gridCoord * 17.13);
  vec2 starPos = (gridCoord + vec2(hash(gridCoord + 1.0), hash(gridCoord + 2.0))) * 60.0;
  float starDist = length(pixelPos - starPos);
  if (starDist < 1.2) {
    float b = 1.0 - starDist / 1.2;
    col += (starVal > 0.8 ? vec3(0.47, 0.53, 0.61) : vec3(0.16, 0.22, 0.29)) * b;
  }

  // Grid lines
  vec2 gridMod = mod(pixelPos - u_resolution * 0.5, 80.0);
  if (gridMod.x < 1.0 || gridMod.y < 1.0) {
    col = mix(col, vec3(0.082, 0.137, 0.196), 0.4);
  }

  // Draw celestial bodies
  for (int i = 0; i < 8; i++) {
    if (i >= u_bodyCount) break;
    Body b = u_bodies[i];
    float r = b.radius;

    if (r < 2.5) {
      float d = length(pixelPos - b.screenPos);
      if (b.isStar == 1) {
        if (d <= 6.0) col = mix(col, b.atmosphere.rgb, b.atmosphere.a);
        if (d <= 3.0) col = vec3(1.0);
      } else if (d <= 2.5) {
        col = b.accent;
      }
      continue;
    }

    vec2 relCenter = pixelPos - b.screenPos;
    float sd;
    if (r > 2048.0 && dot(b.horizonNormal, b.horizonNormal) > 0.5) {
      vec2 relH = pixelPos - b.horizonPoint;
      float u = dot(relH, b.horizonNormal);
      float v = relH.x * (-b.horizonNormal.y) + relH.y * b.horizonNormal.x;
      float ru = r + u;
      sd = u + (v * v) / (sqrt(ru * ru + v * v) + max(1.0, ru));
    } else {
      sd = length(relCenter) - r;
    }

    if (b.isStar == 1) {
      float coronaSpan = r > 2048.0 ? min(200.0, max(60.0, r * 0.15)) : r * 0.85;
      float innerFade = r > 2048.0 ? 0.0 : -0.3 * r;
      if (sd <= coronaSpan && sd > innerFade) {
        float t = clamp((sd - innerFade) / max(1.0, coronaSpan - innerFade), 0.0, 1.0);
        vec4 coronaCol = vec4(b.atmosphere.rgb, b.atmosphere.a * (1.0 - t));
        col = mix(col, coronaCol.rgb, coronaCol.a);
      }
      if (sd <= 0.0) {
        float depthScale = max(1.0, min(r, 350.0));
        float t = clamp(1.0 + sd / depthScale, 0.0, 1.0);
        vec3 core = mix(vec3(1.0, 1.0, 1.0), b.color, smoothstep(0.0, 0.75, t));
        core = mix(core, b.accent, smoothstep(0.75, 1.0, t));
        col = core;
      }
      if (abs(sd) <= 1.5) {
        col = mix(col, vec3(1.0, 0.97, 0.86), 0.8);
      }
    } else {
      bool lit = dot(b.sunDir, b.sunDir) > 0.5;
      float cosSun = lit ? dot(normalize(relCenter), b.sunDir) : 1.0;
      float atmoThickness = min(120.0, max(25.0, r * 0.08));
      if (sd > 0.0 && sd <= atmoThickness) {
        float atmoT = 1.0 - sd / atmoThickness;
        float atmoAlpha = b.atmosphere.a * pow(atmoT, 1.5);
        vec3 atmoCol = b.atmosphere.rgb;
        if (lit) {
          // Faint at night, warm at sunrise and sunset.
          atmoAlpha *= 0.2 + 0.8 * smoothstep(-0.25, 0.1, cosSun);
          atmoCol = mix(atmoCol, vec3(1.0, 0.6, 0.35), (1.0 - smoothstep(0.0, 0.3, abs(cosSun))) * 0.7);
        }
        col = mix(col, atmoCol, atmoAlpha);
      }
      if (sd <= 0.0) {
        float gradT;
        if (r > 2048.0) {
          gradT = clamp(-sd / 350.0, 0.0, 1.0);
        } else {
          vec2 dir = relCenter / max(1.0, r);
          // Shade away from the star when lit, else from a fixed upper-left light.
          gradT = lit ? clamp(0.5 - 0.5 * cosSun, 0.0, 1.0) * 0.6 : clamp((dir.x + dir.y) * 0.5 + 0.5, 0.0, 1.0);
        }
        vec3 bodyCol = mix(b.color, vec3(0.063, 0.118, 0.169), gradT);
        float day = lit ? daylight(cosSun) : 1.0;
        col = bodyCol * day;
        float edge = smoothstep(0.0, -2.0, sd) - smoothstep(-1.5, -3.5, sd);
        if (edge > 0.0) col = mix(col, b.accent * day, edge);
      }
    }
  }

  fragColor = vec4(col, 1.0);
}
