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
  // Procedural look (all optional for shader packs). 0 draws the plain disc below.
  // 1 rocky, 2 arid, 3 oceanic, 4 banded, 5 icy, 6 hazy, 7 volcanic, 8 star.
  int style;
  vec3 c1;      // palette after `color`; roles depend on the style (see BodyAppearance)
  vec3 c2;
  vec3 c3;
  vec3 mean;    // average colour, for a body too small to show detail
  float spin;   // screen angle of the body-fixed frame (counter-clockwise, y up)
  float seed;
  float metres; // radius in metres, for surface-anchored detail up close
  vec4 tune;    // water, clouds, ice, craters: 0..1, 0.5 by default
  vec2 tune2;   // turbulence, volcanic glow
};

uniform int u_bodyCount;
uniform Body u_bodies[8];
uniform highp sampler3D u_noise; // optional for shader packs: random lattice for the procedural surfaces

// Day/night: 1 by day, 0.35 at night, smooth across the terminator (see lighting.ts).
float daylight(float c) { return 0.35 + 0.65 * smoothstep(-0.18, 0.18, c); }

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

#ifndef SCENE_LITE // the lite build (compiled first, for a fast start) leaves out procedural surfaces
// ---------------------------------------------------------------------------------------
// Procedural surfaces. A 2D planet is seen from above its pole: its spin axis points out of
// the screen, so the disc is the northern hemisphere (pole at the centre, equator at the
// rim, where ships land). Detail lives on the unit sphere in the body-fixed frame, so it
// turns with the planet and foreshortens towards the rim like a real globe.

vec2 hash22(vec2 p) {
  vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yzx + 33.33);
  return fract((q.xx + q.yz) * q.zy);
}
// Smooth value noise from the shared 64^3 random lattice (u_noise): the hardware's trilinear
// filter does the blend, and moving the sample point by the smoothstep weights makes it smooth.
float noise3(vec3 p) {
  vec3 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return texture(u_noise, (i + u + 0.5) / 64.0).r;
}
// Level of detail: an octave smaller than about two pixels (`px`, in the same units as `p`)
// fades to its mean, so zoomed-out planets cost little and never shimmer.
float fbm(vec3 p, float px) {
  float sum = 0.0, amp = 0.5, freq = 1.0;
  for (int i = 0; i < 6; i++) {
    float keep = 1.0 - smoothstep(0.25, 0.5, freq * px);
    if (keep <= 0.0) { sum += amp; break; } // the rest average 0.5 times amplitudes summing to 2 * amp
    sum += amp * mix(0.5, noise3(p * freq), keep);
    freq *= 2.03; amp *= 0.5;
  }
  return sum;
}
// Thin ridges (cracks, lava channels, canyons): 1 on the ridge line.
float ridge(vec3 p, float px) {
  float keep = 1.0 - smoothstep(0.1, 0.3, px);
  return keep * (1.0 - abs(noise3(p) * 2.0 - 1.0));
}
// Craters on a jittered grid in the body-fixed plane: x = 0 outside, else 1 - d/radius (bowl
// depth); y = rim strength. Skipped when the grid is under ~3 pixels.
vec2 craters(vec2 p, float px, float seed, float density) {
  if (px > 0.35) return vec2(0.0);
  vec2 g = floor(p), f = fract(p), result = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 n = vec2(x, y), h = hash22(g + n + seed);
    if (h.x > density) continue; // not every cell holds a crater
    vec2 c = n + 0.2 + 0.6 * h;
    float radius = 0.12 + 0.3 * fract(h.y * 7.31);
    float d = length(c - f) / radius;
    if (d < 1.15) {
      result.x = max(result.x, 1.0 - min(d, 1.0));
      result.y = max(result.y, smoothstep(0.75, 0.95, d) * (1.0 - smoothstep(1.0, 1.15, d)));
    }
  }
  return result * (1.0 - smoothstep(0.15, 0.35, px));
}

vec3 rocky(Body b, vec3 s, float px, float z) {
  // Dark maria: old lava seas, dry and smooth, filling the lowlands.
  float h = fbm(s * 1.7 + b.seed, px * 1.7);
  float lowland = 0.40 + (b.tune.x - 0.5) * 0.24; // more water: wider lava seas
  vec3 col = mix(b.c1, b.color, smoothstep(lowland, lowland + 0.12, h));
  col = mix(col, b.c2, smoothstep(0.58, 0.75, h) * 0.7); // bright cratered highlands
  col *= 0.88 + 0.24 * fbm(s * 9.0 + b.seed, px * 9.0);
  float highland = smoothstep(0.45, 0.6, h);
  for (int k = 0; k < 2; k++) {
    float scale = k == 0 ? 7.0 : 19.0;
    vec2 c = craters(s.xy * scale, px * scale, b.seed + float(k) * 17.0, b.tune.w * 1.1);
    float strength = mix(0.5, 1.0, highland); // maria are younger: fewer, softer craters
    col *= 1.0 - 0.28 * c.x * strength;
    col = mix(col, b.c2, 0.45 * c.y * strength);
  }
  // Polar frost (invisible when the fourth colour is the ground).
  float edge = mix(1.0, 0.88, b.tune.z); // about 70 degrees of latitude at the default
  float cap = smoothstep(edge, edge + 0.04, z + 0.04 * (fbm(s * 6.0, px * 6.0) - 0.5));
  return mix(col, b.c3, cap);
}

vec3 arid(Body b, vec3 s, float px, float z) {
  float h = fbm(s * 1.5 + b.seed, px * 1.5) + 0.25 * (fbm(s * 5.0 + b.seed, px * 5.0) - 0.5);
  // Sand seas with dune ridges that follow the wind.
  vec3 sand = b.color * (0.92 + 0.16 * fbm(s * 4.0 + 3.1, px * 4.0));
  float dunes = sin(dot(s.xy, vec2(0.8, 0.6)) * 90.0 + fbm(s * 6.0, px * 6.0) * 12.0);
  sand *= 1.0 + 0.07 * dunes * (1.0 - smoothstep(0.004, 0.012, px));
  // Dry seas: pale salt flats and playas in the basins, cracked into polygons.
  float shore = mix(0.22, 0.5, b.tune.x);
  float basin = 1.0 - smoothstep(shore, shore + 0.06, h);
  vec2 cell = craters(s.xy * 40.0, px * 40.0, b.seed + 5.0, b.tune.w * 1.1);
  vec3 salt = b.c2 * (0.95 + 0.05 * fbm(s * 20.0, px * 20.0)) * (1.0 - 0.12 * ridge(s * 55.0, px * 55.0));
  vec3 col = mix(sand, salt, basin);
  col = mix(col, b.c1 * (0.85 + 0.3 * fbm(s * 12.0, px * 12.0)), smoothstep(0.6, 0.7, h)); // rock mesas
  col = mix(col, b.c1 * 0.7, 0.5 * ridge(s * 8.0 + b.seed, px * 8.0) * smoothstep(0.45, 0.6, h)); // canyons
  col *= 1.0 - 0.15 * cell.x; // a few old, weathered craters
  float edge = mix(1.0, 0.89, b.tune.z);
  float cap = smoothstep(edge, edge + 0.04, z + 0.04 * (fbm(s * 6.0, px * 6.0) - 0.5));
  return mix(col, b.c3, cap);
}

vec3 oceanic(Body b, vec3 s, float px, float z, out float water) {
  float h = fbm(s * 1.6 + b.seed, px * 1.6) + 0.3 * (fbm(s * 5.0 + b.seed * 2.0, px * 5.0) - 0.5);
  float sea = mix(0.36, 0.64, b.tune.x);
  // Temperature follows cos(latitude), which seen from above the pole is the distance from the
  // centre: 1 at the equator (the rim), 0 at the pole. It also falls with altitude. Moisture is its own field.
  float temperature = sqrt(max(0.0, 1.0 - z * z)) + 0.1 * (fbm(s * 3.0 + 11.0, px * 3.0) - 0.5) - max(0.0, h - sea) * 1.2
    + (0.5 - b.tune.z) * 0.4;
  float moisture = fbm(s * 2.4 + 7.0, px * 2.4);
  water = 1.0 - smoothstep(sea, sea + 0.006, h);
  // Seas: deep blue offshore, turquoise shelves, frozen near the pole.
  vec3 ocean = mix(b.color * 0.62, b.color * 1.25 + vec3(0.0, 0.07, 0.06), smoothstep(sea - 0.12, sea, h));
  ocean = mix(ocean, b.c3 * 0.92, smoothstep(0.2, 0.12, temperature)); // sea ice beyond about 80 degrees
  // Biomes on land.
  vec3 forest = b.c1, desert = b.c2;
  vec3 rainforest = b.c1 * vec3(0.62, 0.8, 0.6);
  vec3 grass = mix(b.c1, b.c2, 0.45) * 1.05;
  vec3 tundra = mix(b.c1, vec3(0.52, 0.52, 0.47), 0.65);
  vec3 rock = vec3(0.45, 0.42, 0.38);
  vec3 land = mix(grass, forest, smoothstep(0.42, 0.55, moisture));
  land = mix(land, rainforest, smoothstep(0.58, 0.68, moisture) * smoothstep(0.9, 0.97, temperature)); // tropics
  land = mix(land, desert, smoothstep(0.4, 0.31, moisture) * smoothstep(0.72, 0.84, temperature)); // subtropical deserts
  land = mix(land, tundra, smoothstep(0.47, 0.36, temperature));
  land = mix(land, rock, smoothstep(0.66, 0.74, h));
  land = mix(land, b.c3, smoothstep(0.3, 0.2, temperature)); // ice sheets and snowy peaks
  land = mix(mix(desert, vec3(0.9, 0.85, 0.7), 0.4), land, smoothstep(sea + 0.006, sea + 0.02, h)); // beaches
  land *= 0.9 + 0.2 * fbm(s * 14.0, px * 14.0);
  vec3 col = mix(land, ocean, water);
  // Clouds: swirled bands that turn with the planet.
  vec3 w = s * 2.2 + vec3(fbm(s * 2.0 + 1.7, px * 2.0), fbm(s * 2.0 + 4.3, px * 2.0), 0.0) * 2.8 * b.tune2.x;
  float cover = mix(0.8, 0.3, b.tune.y);
  float clouds = smoothstep(cover, cover + 0.23, fbm(w + b.seed * 0.37, px * 2.2)) * 0.85;
  return mix(col, b.c3, clouds);
}

vec3 banded(Body b, vec3 s, float px, float z, vec2 q) {
  // Seen from above the pole, a giant's belts and zones are rings of uneven width,
  // their edges stirred into eddies.
  float turbulence = fbm(s * 3.0 + b.seed, px * 3.0);
  float stir = b.tune2.x * 2.0;
  float lat = z + stir * (0.035 * (turbulence - 0.5) + 0.012 * (fbm(s * 11.0 + b.seed, px * 11.0) - 0.5));
  float belts = noise3(vec3(lat * 11.0, b.seed, 0.5));
  float fine = noise3(vec3(lat * 37.0, b.seed + 3.0, 0.5));
  vec3 col = mix(b.c1, b.color, smoothstep(0.35, 0.65, belts));
  col = mix(col, b.c2, 0.5 * smoothstep(0.55, 0.85, fine));
  col *= 0.94 + 0.12 * fbm(s * 7.0 + b.seed * 2.0, px * 7.0);
  // Polar vortex: a spiral at the centre.
  float angle = atan(q.y, q.x) + 14.0 * (1.0 - z);
  float vortex = smoothstep(0.94, 0.99, z) * (0.5 + 0.5 * sin(angle * 5.0 + turbulence * 4.0));
  col = mix(col, b.c2 * 0.9, vortex * 0.45);
  // A few large storms.
  vec2 storm = craters(s.xy * 3.5, px * 3.5, b.seed + 31.0, 0.55);
  float rare = step(0.62, noise3(s * 2.0 + b.seed));
  return mix(col, b.c3, smoothstep(0.25, 0.65, storm.x) * 0.75 * rare);
}

vec3 icy(Body b, vec3 s, float px, float z) {
  vec3 col = mix(b.color, b.c2, 0.5 * fbm(s * 3.0 + b.seed, px * 3.0));
  col = mix(col, b.c3, b.tune.z * 0.5 * smoothstep(0.5, 0.7, fbm(s * 1.5 + 9.0, px * 1.5)));
  // Long cracks in the ice shell at two scales.
  col = mix(col, b.c1, 0.7 * smoothstep(0.93, 0.985, ridge(s * 6.0 + b.seed, px * 6.0)));
  col = mix(col, b.c1, 0.45 * smoothstep(0.95, 0.99, ridge(s * 17.0 + b.seed, px * 17.0)));
  vec2 c = craters(s.xy * 12.0, px * 12.0, b.seed + 3.0, b.tune.w * 1.1);
  return col * (1.0 - 0.12 * c.x);
}

vec3 hazy(Body b, vec3 s, float px, float z) {
  vec3 w = s * 1.8 + vec3(fbm(s * 2.2 + 2.0, px * 2.2), fbm(s * 2.2 + 6.0, px * 2.2), 0.0) * 2.2 * b.tune2.x;
  float c = fbm(w + b.seed, px * 1.8) + 0.12 * sin(z * 16.0 + b.seed);
  vec3 col = mix(b.c1, b.c2, smoothstep(0.35, 0.8, c));
  return mix(mix(col, b.color, 0.35), b.c3, 0.15);
}

vec3 volcanic(Body b, vec3 s, float px, float z, out float glow) {
  vec3 col = mix(b.c1, b.color, fbm(s * 4.0 + b.seed, px * 4.0));
  col = mix(col, b.c3, 0.55 * smoothstep(0.58, 0.72, fbm(s * 2.2 + 9.0, px * 2.2))); // sulfur plains
  vec2 c = craters(s.xy * 9.0, px * 9.0, b.seed + 7.0, b.tune.w * 1.1); // calderas
  float flow = mix(0.98, 0.82, b.tune2.y);
  float lava = smoothstep(flow, flow + 0.07, ridge(s * 5.0 + b.seed, px * 5.0)) + 0.8 * c.x * step(0.6, c.x) * b.tune2.y * 2.0;
  lava = clamp(lava, 0.0, 1.0);
  glow = lava;
  return mix(col, b.c2 * 0.5, lava);
}

// Cross-section seen up close: a surface skin, soil, rock and bedrock below the surface line.
vec3 strata(Body b, float depthMetres, vec2 q) {
  vec2 p = q * min(b.metres, 4.0e5) / 4.0;
  float wobble = noise3(vec3(p, b.seed)) * 1.5;
  // Layer colours by world type: [skin, soil, rock].
  vec3 skin = b.color, soil = b.color * 0.75, rock = b.c1;
  if (b.style == 3) { skin = b.c1; soil = b.c2 * 0.55; rock = vec3(0.38, 0.35, 0.32); } // turf, soil, granite
  else if (b.style == 2) { skin = b.color; soil = b.color * 0.8; rock = b.c1; }            // sand over rock
  else if (b.style == 5) { skin = b.c3; soil = b.color; rock = b.c1 * 1.1; }               // frost over ice
  else if (b.style == 7) { skin = b.c1; soil = b.color; rock = b.c1 * 0.7; }               // crust over basalt
  else if (b.style == 1) { skin = b.c2 * 0.9; soil = b.color; rock = b.c1; }               // dust over regolith
  float d = depthMetres + wobble * 0.3;
  vec3 col = mix(skin, soil, smoothstep(0.35, 0.6, d));
  col = mix(col, rock, smoothstep(2.5, 4.0, depthMetres + wobble * 1.5));
  col = mix(col, rock * 0.75, smoothstep(12.0, 16.0, depthMetres + wobble * 4.0));
  col = mix(col, rock * 0.5, smoothstep(45.0, 60.0, depthMetres + wobble * 10.0));
  // Grains and pebbles, anchored to the ground.
  col *= 0.88 + 0.24 * noise3(vec3(p * 3.0, depthMetres * 0.8));
  return col;
}
#endif

float bodySd(Body b, vec2 pixelPos) {
  float r = b.radius;
  if (r > 2048.0 && dot(b.horizonNormal, b.horizonNormal) > 0.5) {
    vec2 relH = pixelPos - b.horizonPoint;
    float u = dot(relH, b.horizonNormal);
    float v = relH.x * (-b.horizonNormal.y) + relH.y * b.horizonNormal.x;
    float ru = r + u;
    return u + (v * v) / (sqrt(ru * ru + v * v) + max(1.0, ru));
  }
  return length(pixelPos - b.screenPos) - r;
}

void main() {
  vec2 pixelPos = vec2(v_uv.x * u_resolution.x, (1.0 - v_uv.y) * u_resolution.y);
  vec3 col = vec3(0.031, 0.059, 0.098); // #080f19

  // Find the topmost opaque body disc (if any) so its procedural surface is shaded once outside the loop.
  int hitIdx = -1;
  Body hitBody;
  float hitSd = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= u_bodyCount) break;
    if (u_bodies[i].radius >= 2.5) {
      float sd = bodySd(u_bodies[i], pixelPos);
      if (sd <= 0.0) {
        hitIdx = i;
        hitBody = u_bodies[i];
        hitSd = sd;
      }
    }
  }

  if (hitIdx < 0) {
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
  } else {
    Body b = hitBody;
    float r = b.radius;
    float sd = hitSd;
    vec2 relCenter = pixelPos - b.screenPos;

    if (b.isStar == 1) {
#ifndef SCENE_LITE
      if (b.style == 8) {
        // Limb darkening and boiling granulation.
        vec2 v = vec2(relCenter.x, -relCenter.y) / r;
        float z = sqrt(max(0.0, 1.0 - dot(v, v)));
        float c = cos(b.spin), s = sin(b.spin);
        vec3 p = vec3(c * v.x + s * v.y, -s * v.x + c * v.y, z);
        float px = 1.0 / (r * max(z, 0.15));
        float granules = fbm(p * 24.0 + b.seed, px * 24.0);
        vec3 core = mix(b.c1, b.color, smoothstep(0.0, 0.9, z));
        core = mix(b.c2, core, smoothstep(0.0, 0.35, z));
        core *= 0.88 + 0.24 * granules;
        vec2 spots = craters(p.xy * 5.0, px * 5.0, b.seed, 0.55);
        col = mix(core, b.c3, smoothstep(0.3, 0.7, spots.x) * 0.7 * step(0.25, z));
      } else
#endif
      {
        float depthScale = max(1.0, min(r, 350.0));
        float t = clamp(1.0 + sd / depthScale, 0.0, 1.0);
        vec3 core = mix(vec3(1.0, 1.0, 1.0), b.color, smoothstep(0.0, 0.75, t));
        core = mix(core, b.accent, smoothstep(0.75, 1.0, t));
        col = core;
      }
      if (abs(sd) <= 1.5) {
        col = mix(col, vec3(1.0, 0.97, 0.86), 0.8);
      }
#ifndef SCENE_LITE
    } else if (b.style > 0) {
      // ---- Procedural planet ----
      bool lit = dot(b.sunDir, b.sunDir) > 0.5;
      // Light from the star, tipped a little towards the viewer (an axial tilt), else from the upper left.
      vec3 light = lit ? normalize(vec3(b.sunDir.x, -b.sunDir.y, 0.25)) : normalize(vec3(-0.5, 0.55, 0.65));
      vec2 rim = normalize(vec2(relCenter.x, -relCenter.y));
      float cosRim = lit ? dot(rim, normalize(light.xy)) : 1.0; // day/night at the equator, where ships land
      // Close to the ground the view becomes a side-on cross-section.
      float near = smoothstep(1000.0, 2000.0, r);
      vec2 v = vec2(relCenter.x, -relCenter.y) / r;
      float z = sqrt(max(0.0, 1.0 - dot(v, v)));
      float c = cos(b.spin), s = sin(b.spin);
      vec2 q = vec2(c * v.x + s * v.y, -s * v.x + c * v.y);
      vec3 shaded = b.color;
      if (near < 1.0) {
        // The seed moves every noise layer to its own part of the lattice, so each seed is a different world.
        vec3 p = vec3(q, z) + fract(vec3(b.seed) * vec3(0.1031, 0.1030, 0.0973)) * 64.0;
        float px = 1.0 / (r * max(z, 0.12)); // one pixel on the sphere, for level of detail
        vec3 surface = b.color;
        float water = 0.0, glow = 0.0;
        if (b.style == 1) surface = rocky(b, p, px, z);
        else if (b.style == 2) surface = arid(b, p, px, z);
        else if (b.style == 3) surface = oceanic(b, p, px, z, water);
        else if (b.style == 4) surface = banded(b, p, px, z, q);
        else if (b.style == 5) surface = icy(b, p, px, z);
        else if (b.style == 6) surface = hazy(b, p, px, z);
        else if (b.style == 7) surface = volcanic(b, p, px, z, glow);
        // Sphere shading with a soft terminator; the night side keeps a faint blue ambient.
        vec3 normal = vec3(v, z);
        float diffuse = dot(normal, light);
        float ambient = lit ? 0.1 : 0.32;
        float day = lit ? smoothstep(-0.05, 0.15, diffuse) : 1.0;
        shaded = surface * (ambient * vec3(0.8, 0.88, 1.15) + (1.0 - ambient) * day * (0.3 + 0.7 * clamp(diffuse, 0.0, 1.0)));
        // Sun glint on open water.
        if (lit && water > 0.0) {
          float glint = pow(max(dot(reflect(-light, normal), vec3(0.0, 0.0, 1.0)), 0.0), 40.0);
          shaded += vec3(1.0, 0.95, 0.85) * glint * water * 0.6 * day;
        }
        shaded += b.c2 * glow * 1.3; // lava glows by day and night
        // Atmosphere scattering at the rim, warm at the terminator.
        float scatter = pow(1.0 - z, 3.0) * b.atmosphere.a * 1.8;
        vec3 airCol = lit ? mix(b.atmosphere.rgb, vec3(1.0, 0.55, 0.3), (1.0 - smoothstep(0.0, 0.3, abs(cosRim))) * 0.7) : b.atmosphere.rgb;
        shaded = mix(shaded, airCol * (lit ? smoothstep(-0.2, 0.2, cosRim) : 1.0), clamp(scatter, 0.0, 1.0));
      }
      // Up close: the cross-section, lit by the time of day at that spot on the surface.
      if (near > 0.0) {
        float depth = -sd / r * b.metres;
        vec3 cut = strata(b, depth, q) * (lit ? daylight(cosRim) : 1.0);
        shaded = mix(shaded, cut, near);
      }
      col = shaded;
      float dayEdge = lit ? daylight(cosRim) : 1.0;
      float edge = smoothstep(0.0, -2.0, sd) - smoothstep(-1.5, -3.5, sd);
      if (edge > 0.0) col = mix(col, b.accent * dayEdge, edge * 0.6);
#endif
    } else {
      bool lit = dot(b.sunDir, b.sunDir) > 0.5;
      float cosSun = lit ? dot(normalize(relCenter), b.sunDir) : 1.0;
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

  // Draw atmospheres, coronas and distant body dots in front of the background / topmost disc
  for (int i = 0; i < 8; i++) {
    if (i >= u_bodyCount) break;
    if (i <= hitIdx) continue;
    Body b = u_bodies[i];
    float r = b.radius;

    if (r < 2.5) {
      float d = length(pixelPos - b.screenPos);
      if (b.isStar == 1) {
        if (d <= 6.0) col = mix(col, b.atmosphere.rgb, b.atmosphere.a);
        if (d <= 3.0) col = vec3(1.0);
      } else if (d <= 2.5) {
        col = b.style > 0 ? b.mean : b.accent; // far away: one dot of the planet's average colour
      }
      continue;
    }

    vec2 relCenter = pixelPos - b.screenPos;
    float sd = bodySd(b, pixelPos);

    if (b.isStar == 1) {
      float coronaSpan = r > 2048.0 ? min(200.0, max(60.0, r * 0.15)) : r * 0.85;
      float innerFade = r > 2048.0 ? 0.0 : -0.3 * r;
      if (sd <= coronaSpan && sd > innerFade) {
        float t = clamp((sd - innerFade) / max(1.0, coronaSpan - innerFade), 0.0, 1.0);
        vec4 coronaCol = vec4(b.atmosphere.rgb, b.atmosphere.a * (1.0 - t));
        col = mix(col, coronaCol.rgb, coronaCol.a);
      }
      if (abs(sd) <= 1.5) {
        col = mix(col, vec3(1.0, 0.97, 0.86), 0.8);
      }
#ifndef SCENE_LITE
    } else if (b.style > 0) {
      // Air thins exponentially with altitude, over a scale height of 6% of the radius (in
      // metres, so it scales with zoom): a deep sky from the ground that fades as you climb,
      // a thin glowing rim from orbit. Never thinner than a few pixels on a small disc.
      float scaleHeight = max(0.06 * r, min(12.0, 0.12 * r));
      if (sd < scaleHeight * 6.0) {
        bool lit = dot(b.sunDir, b.sunDir) > 0.5;
        vec3 light = lit ? normalize(vec3(b.sunDir.x, -b.sunDir.y, 0.25)) : normalize(vec3(-0.5, 0.55, 0.65));
        vec2 rim = normalize(vec2(relCenter.x, -relCenter.y));
        float cosRim = lit ? dot(rim, normalize(light.xy)) : 1.0;
        float alpha = b.atmosphere.a * 1.6 * exp(-sd / scaleHeight);
        vec3 airCol = b.atmosphere.rgb * 1.2;
        if (lit) {
          alpha *= 0.15 + 0.85 * smoothstep(-0.25, 0.1, cosRim);
          airCol = mix(airCol, vec3(1.0, 0.55, 0.3), (1.0 - smoothstep(0.0, 0.3, abs(cosRim))) * 0.75);
        }
        col = mix(col, airCol, clamp(alpha, 0.0, 1.0));
      }
#endif
    } else {
      float atmoThickness = max(0.08 * r, min(25.0, 0.25 * r)); // 8% of the radius: thick near the ground
      if (sd > 0.0 && sd <= atmoThickness) {
        bool lit = dot(b.sunDir, b.sunDir) > 0.5;
        float cosSun = lit ? dot(normalize(relCenter), b.sunDir) : 1.0;
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
    }
  }

  fragColor = vec4(col, 1.0);
}
