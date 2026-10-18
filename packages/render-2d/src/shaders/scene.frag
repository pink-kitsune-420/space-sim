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
uniform float u_time;
uniform float u_nebulaTime;  // wall-clock seconds, held at zero when nebula animation is off
uniform int u_starsVisible;
uniform float u_starDensity;
uniform int u_bgMode;        // 0: classic, 1: nebula, 2: carina, 3: galactic, 4: aurora, 5: supernova, 6: void
uniform int u_gridEnabled;   // 0: off, 1: on
uniform int u_gridMode;      // 0: cartesian, 1: polar, 2: dots, 3: hex
uniform float u_gridSpacing; // spacing in pixels (e.g. 80.0)
uniform float u_gridOpacity; // 0.0 .. 1.0
uniform vec3 u_gridColor;    // RGB tint (0.0 .. 1.0)
uniform float u_nebulaIntensity; // default 1.0
uniform int u_highQuality;   // 0: low graphics, 1: high graphics
uniform int u_galaxiesVisible; // 0: hidden, 1: visible
uniform float u_worldSeed;   // procedural seed for celestial features
uniform vec2 u_camCenter;
uniform float u_camScale;
uniform float u_camRotation;

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
  return texture(u_noise, (i + u + 0.5) * 0.015625).r;
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

#ifndef SCENE_LITE
// Planetary Rings for gas giants (style == 4, e.g. Saturn / Magnus)
vec4 planetRing(Body b, vec2 pixelPos, float planetSd) {
  float r = b.radius;
  if (b.style != 4 || r < 4.0) return vec4(0.0);
  vec2 rel = pixelPos - b.screenPos;

  // Fixed equatorial ring plane oriented consistently with camera rotation
  float ang = 0.42 - u_camRotation;
  float cA = cos(ang), sA = sin(ang);
  // Major axis u, minor axis vScreen
  float u = rel.x * cA - rel.y * sA;
  float vScreen = rel.x * sA + rel.y * cA;
  float aspect = 0.38;
  float vPlane = vScreen / aspect;
  float ringDist = length(vec2(u, vPlane));
  float normR = ringDist / r;

  // Ring spans from 1.30 * r to 2.32 * r
  if (normR < 1.30 || normR > 2.32) return vec4(0.0);

  // Depth in 3D along line of sight: inclination tilt factor sqrt(1/0.38^2 - 1) = 2.434
  // For vScreen > 0, zRing > 0 (front arc, closer to camera than planet center)
  // For vScreen < 0, zRing < 0 (back arc, further from camera than planet center)
  float zRing = vScreen * 2.434;

  // 3D Depth Occlusion:
  // If inside the planet disc (planetSd <= 0.0), only the back arc (zRing < 0.0) is hidden behind the planet.
  // The front arc (zRing > 0.0) is strictly in front of the planet and remains visible across the globe.
  if (planetSd <= 0.0 && zRing < 0.0) return vec4(0.0);

  // Ring divisions & structure (Cassini division, Ring A, Ring B, Crepe Ring C)
  float density = 0.0;
  if (normR >= 1.30 && normR < 1.48) {
    density = 0.22 * smoothstep(1.30, 1.36, normR);
  } else if (normR >= 1.48 && normR < 1.94) {
    float cassiniEdge = smoothstep(1.94, 1.90, normR);
    density = (0.78 + 0.14 * sin(normR * 140.0)) * cassiniEdge;
  } else if (normR >= 1.94 && normR < 2.02) {
    density = 0.03; // Cassini division (sharp dark gap)
  } else if (normR >= 2.02 && normR <= 2.32) {
    float encke = 1.0 - 0.7 * smoothstep(0.015, 0.0, abs(normR - 2.22));
    density = (0.58 + 0.12 * sin(normR * 160.0)) * smoothstep(2.32, 2.25, normR) * encke;
  }

  // Planet 3D cylindrical shadow cast onto the ring plane (back arc only)
  bool lit = dot(b.sunDir, b.sunDir) > 0.5;
  if (lit && zRing < 0.0) {
    vec3 lightDir = normalize(vec3(b.sunDir.x, -b.sunDir.y, 0.25));
    // 3D point P in planet-centric frame (X right, Y up, Z towards viewer)
    vec3 P = vec3(rel.x, -rel.y, zRing);
    float s = dot(P, lightDir);
    // If s < 0.0, point is on the night side (away from sun)
    if (s < 0.0) {
      float dPerpSq = dot(P, P) - s * s;
      float dPerp = sqrt(max(0.0, dPerpSq));
      float shadow = smoothstep(r * 0.96, r * 1.04, dPerp);
      density *= shadow;
    }
  }

  // Concentric micro-grooves
  density *= 0.90 + 0.10 * cos(normR * 280.0);
  vec3 ringCol = mix(b.c2, vec3(0.92, 0.88, 0.78), 0.65);
  return vec4(ringCol, clamp(density * 0.85, 0.0, 1.0));
}

// Deep Space Galaxies (Grand Spiral, Edge-on Sombrero, and Distant Deep Field)
vec3 celestialGalaxies(vec2 parPos, float seed) {
  vec3 galCol = vec3(0.0);

  // 1. Grand Spiral Galaxy (M31 Andromeda / M81 class: Smooth density waves, NO sharp singularities)
  vec2 g1Center = vec2(-0.36, -0.22) + vec2(sin(seed * 2.1), cos(seed * 3.4)) * 0.08;
  vec2 g1Pos = parPos - g1Center;
  float c1 = 0.852, s1 = 0.523;
  vec2 g1Rot = vec2(g1Pos.x * c1 - g1Pos.y * s1, g1Pos.x * s1 + g1Pos.y * c1);
  vec2 g1Flat = vec2(g1Rot.x, g1Rot.y * 1.8);
  float r1 = length(g1Flat);

  if (r1 < 0.75) {
    float fade1 = smoothstep(0.75, 0.30, r1);
    float expDisk = exp(-r1 * 3.4);

    // Radiant golden bulge & brilliant starlike nucleus
    float core1 = exp(-pow(r1 / 0.07, 0.5) * 3.5) * 1.5;
    float nucleus1 = exp(-r1 * 35.0) * 2.0;
    vec3 bulgeCol = vec3(1.0 * core1 + 1.0 * nucleus1,
                         0.92 * core1 + 0.98 * nucleus1,
                         0.80 * core1 + 0.95 * nucleus1);

    // Smooth logarithmic spiral density waves (winding flattens naturally near core)
    float theta1 = atan(g1Flat.y, g1Flat.x);
    float armAngle1 = theta1 * 2.0 - 2.2 * log(r1 + 0.08);
    float armWave1 = cos(armAngle1);

    // Spiral arm amplitude: 0 at core (no singularity), peak in mid-disk, soft outer fade
    float armAmp = smoothstep(0.06, 0.18, r1) * smoothstep(0.70, 0.35, r1);
    float armGlow = armAmp * pow(max(0.0, 0.5 + 0.5 * armWave1), 1.8) * 0.75;

    // Gentle dust lane along the inner leading edge
    float dustWave = cos(armAngle1 + 0.6);
    float dustLane = armAmp * smoothstep(0.3, 0.9, dustWave) * 0.35;

    // Starburst HII knots and OB clusters along the arms
    float knotNoise1 = noise3(vec3(g1Rot * 15.0, 1.2));
    float starburst = armAmp * smoothstep(0.5, 0.95, armWave1) * smoothstep(0.4, 0.8, knotNoise1) * 0.45;

    vec3 diskCol = mix(vec3(0.35, 0.50, 0.75), vec3(0.90, 0.95, 1.0), expDisk);
    vec3 diskLum = diskCol * (1.0 + armGlow) * (1.0 - dustLane);
    vec3 knotCol = vec3(0.95, 0.35, 0.65) * starburst;

    vec3 totGal1 = (bulgeCol + (diskLum + knotCol) * expDisk * 1.1) * fade1;

    // Satellite companion dwarf elliptical galaxy (M32 style)
    vec2 dwarfPos = g1Rot - vec2(0.12, -0.06);
    float dwarfCore = exp(-length(vec2(dwarfPos.x * 1.3, dwarfPos.y * 0.9)) * 32.0);
    vec3 dwarfCol = vec3(0.95, 0.88, 0.78) * dwarfCore * 0.7;

    galCol += totGal1 + dwarfCol;
  }

  // 2. Needle Galaxy (NGC 4565 / Edge-on Grand Spiral: Slender celestial lens with fine dust lane)
  vec2 somCenter = vec2(0.42, 0.14) + vec2(cos(seed * 4.2), sin(seed * 1.9)) * 0.06;
  vec2 somPos = parPos - somCenter;
  float cSom = 0.88, sSom = 0.475; // Elegant gentle ~28° tilt
  vec2 somRot = vec2(somPos.x * cSom - somPos.y * sSom, somPos.x * sSom + somPos.y * cSom);

  // Slender, graceful lenticular disk (aspect ratio ~10:1)
  float rDiskX = abs(somRot.x) * 2.5;
  float rDiskY = abs(somRot.y) * 16.0;
  float rSomDisk = length(vec2(rDiskX, rDiskY));

  if (rSomDisk < 1.0) {
    float fadeDisk = smoothstep(1.0, 0.35, rSomDisk);

    // Compact, delicate central lenticular bulge
    float rSomBulge = length(vec2(somRot.x * 5.5, somRot.y * 8.5));
    float bulgeCore = exp(-rSomBulge * 5.0) * 0.95;
    float nucleus = exp(-rSomBulge * 22.0) * 1.4;

    // Slender exponential disk with soft edges
    float diskProfile = exp(-abs(somRot.x) * 4.2) * exp(-rDiskY * 0.85);

    // Fine, natural interstellar dust lane bisecting the plane
    float yDust = somRot.y + 0.0018 + somRot.x * somRot.x * 0.012;
    float dustThickness = exp(-pow(yDust / 0.0032, 2.0) * 4.0);
    float dustExtent = smoothstep(0.32, 0.06, abs(somRot.x));
    float dustDepth = dustThickness * dustExtent * 1.4;
    float dustTrans = exp(-dustDepth);
    vec3 dustFilter = vec3(dustTrans, pow(dustTrans, 1.35), pow(dustTrans, 1.85));

    // Starburst OB knots along the disk edge
    float knotNoise = noise3(vec3(somRot.x * 24.0, somRot.y * 12.0, 3.4));
    float knots = smoothstep(0.55, 0.85, knotNoise) * smoothstep(0.35, 0.05, abs(somRot.x)) * exp(-rDiskY * 1.5) * 0.35;
    vec3 knotCol = vec3(0.95, 0.40, 0.70) * knots;

    // Harmonious colors: warm golden nucleus, sapphire starlight disk
    vec3 coreCol = vec3(1.0, 0.92, 0.78) * (bulgeCore + nucleus);
    vec3 diskCol = mix(vec3(0.50, 0.70, 0.95), vec3(0.95, 0.92, 0.88), exp(-abs(somRot.x) * 3.5)) * diskProfile;

    // Front dust lane gracefully absorbs the lower disk/bulge light
    float dustMask = smoothstep(0.005, -0.002, somRot.y) * dustExtent;
    vec3 totDisk = mix(diskCol, diskCol * dustFilter, dustMask) + knotCol;
    vec3 totBulge = mix(coreCol, coreCol * dustFilter, dustMask * 0.85);

    galCol += (totBulge + totDisk) * (fadeDisk * 0.85);
  }

  // 3. Hubble Deep Field Distant Galaxies
  vec2 df1 = parPos - vec2(-0.52, 0.35);
  vec2 df2 = parPos - vec2(0.50, -0.38);
  vec2 df3 = parPos - vec2(-0.20, 0.44);
  vec2 df4 = parPos - vec2(0.56, 0.30);
  float d1 = exp(-length(df1 * vec2(1.5, 0.8)) * 55.0) * 0.65;
  float d2 = exp(-length(df2 * vec2(0.9, 1.4)) * 48.0) * 0.55;
  float d3 = exp(-length(df3) * 65.0) * 0.45;
  float d4 = exp(-length(df4 * vec2(1.3, 0.7)) * 52.0) * 0.5;
  galCol += vec3(1.0, 0.78, 0.55) * d1 + vec3(0.65, 0.82, 1.0) * d2 + vec3(1.0, 0.65, 0.5) * d3 + vec3(0.85, 0.9, 1.0) * d4;

  return galCol;
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
    float r = u_bodies[i].radius;
    if (r >= 2.5) {
      vec2 d = pixelPos - u_bodies[i].screenPos;
      // Fast squared-distance disc check before expensive bodySd / sqrt
      if (r <= 2048.0) {
        if (dot(d, d) <= r * r) {
          hitIdx = i;
          hitBody = u_bodies[i];
          hitSd = length(d) - r;
        }
      } else {
        float sd = bodySd(u_bodies[i], pixelPos);
        if (sd <= 0.0) {
          hitIdx = i;
          hitBody = u_bodies[i];
          hitSd = sd;
        }
      }
    }
  }

  if (hitIdx < 0) {
    // 1. Base Skybox Color Tint
    if (u_bgMode == 1) col = vec3(0.010, 0.008, 0.018);      // Orion Nebula (deep space indigo)
    else if (u_bgMode == 2) col = vec3(0.014, 0.008, 0.006); // Cosmic Cliffs (deep space amber twilight)
    else if (u_bgMode == 3) col = vec3(0.008, 0.012, 0.022); // Grand Spiral M51
    else if (u_bgMode == 4) col = vec3(0.006, 0.016, 0.020); // Aurora
    else if (u_bgMode == 5) col = vec3(0.010, 0.014, 0.020); // Supernova
    else if (u_bgMode == 6) col = vec3(0.002, 0.004, 0.008); // Void
    else if (u_bgMode == 7) col = vec3(0.008, 0.010, 0.014); // Pillars of Creation
    else if (u_bgMode == 8) col = vec3(0.006, 0.012, 0.018); // Helix Ring
    else if (u_bgMode == 9) col = vec3(0.008, 0.010, 0.014); // Asteroid Belt / Zodiacal Light
    else col = vec3(0.015, 0.025, 0.040);                    // Classic Spacelab

    // 2. Celestial Coordinate Setup (Anchored to Universe Rotation & Parallax)
    vec2 screenCenter = u_resolution * 0.5;
    vec2 relPos = pixelPos - screenCenter;
    float cRot = cos(u_camRotation);
    float sRot = sin(u_camRotation);
    vec2 celUV = vec2(relPos.x * cRot - relPos.y * sRot, relPos.x * sRot + relPos.y * cRot) / max(100.0, min(u_resolution.x, u_resolution.y));
    float seedAngle = fract(u_worldSeed * 0.173) * 6.2831853;
    float cSeed = cos(seedAngle), sSeed = sin(seedAngle);
    vec2 seedOffset = vec2(fract(u_worldSeed * 0.317) - 0.5, fract(u_worldSeed * 0.619) - 0.5) * 0.35;
    vec2 parPos = vec2(celUV.x * cSeed - celUV.y * sSeed, celUV.x * sSeed + celUV.y * cSeed) + seedOffset;
    float t = u_nebulaTime * 0.02;
    float bgDust = 0.0;

#ifndef SCENE_LITE
    // Deep Space Galaxies (Grand Spiral, Edge-on Sombrero, Deep Field)
    if (u_highQuality == 1 && u_galaxiesVisible == 1) {
      col += celestialGalaxies(parPos, u_worldSeed);
    }

    // Procedural Nebulae & Deep Space Galaxies (High Graphics Only)
    if (u_highQuality == 1 && u_bgMode > 0 && u_bgMode != 6) {
      if (u_bgMode == 1) { // Dynamic Cosmos: Seed-generated celestial map of deep-sky clouds and structures
        // World seed angle and directional axes
        float sAngle = fract(u_worldSeed * 0.173) * 6.2831853;
        vec2 dir1 = vec2(cos(sAngle), sin(sAngle));
        vec2 dir2 = vec2(-dir1.y, dir1.x); // perpendicular axis

        // Gentle celestial drift
        vec2 driftWarp = vec2(noise3(vec3(parPos * 1.5, t * 0.03)), noise3(vec3(parPos * 1.5 + 2.5, t * 0.03))) - 0.5;
        vec2 p = parPos + driftWarp * 0.08;

        // 1. Milky Way Galactic Stream (faint celestial equator band)
        float mwBand = exp(-pow(p.x * dir1.x + p.y * dir1.y, 2.0) * 12.0);
        if (mwBand > 0.01) {
          float mwDust = smoothstep(0.42, 0.75, noise3(vec3(p * 4.8, 0.5)));
          vec3 mwCol = vec3(0.04, 0.06, 0.09) * mwBand * (1.0 - mwDust * 0.6);
          col += mwCol * (0.22 * max(0.0, u_nebulaIntensity));
        }

        // 2. Localized H II Emission Complex (Orion / Rosette style: Muted ruby H-alpha & slate teal [O III])
        vec2 posEmission = dir1 * 0.40 + dir2 * 0.18;
        float dEmission = length((p - posEmission) * vec2(1.1, 0.85));
        float envEmission = smoothstep(0.48, 0.06, dEmission);
        if (envEmission > 0.001) {
          float oct1 = noise3(vec3(p * 2.2, t * 0.02));
          float oct2 = noise3(vec3(p * 4.8 + 1.7, t * 0.04));
          float oct3 = noise3(vec3(p * 9.5 + 4.1, t * 0.06));
          float oct4 = noise3(vec3(p * 18.0 + 8.3, 0.2));
          float fbm = oct1 * 0.48 + oct2 * 0.32 + oct3 * 0.15 + oct4 * 0.05;

          float cloud = smoothstep(0.32, 0.78, fbm) * envEmission;
          float denseCore = smoothstep(0.55, 0.88, oct1 * 0.6 + oct2 * 0.4) * envEmission;
          float fineFilaments = smoothstep(0.50, 0.80, oct3) * cloud;

          vec3 hAlpha = vec3(0.12, 0.03, 0.06);   // soft deep ruby H-alpha
          vec3 o3 = vec3(0.012, 0.075, 0.10);     // ethereal slate teal [O III]
          vec3 frontCol = vec3(0.15, 0.08, 0.11); // soft lavender-peach ionization front

          vec3 colNeb = mix(hAlpha, o3, oct2);
          colNeb = mix(colNeb, frontCol, denseCore * 0.55);
          colNeb += vec3(0.04, 0.08, 0.12) * fineFilaments * 0.3;

          float dustNoise = noise3(vec3(p * 5.2 + 2.1, 0.4)) * 0.65 + noise3(vec3(p * 10.5 + 5.3, 0.7)) * 0.35;
          float dust = smoothstep(0.48, 0.78, dustNoise) * envEmission;
          bgDust = max(bgDust, dust);

          col += colNeb * cloud * (1.0 - dust * 0.80) * (0.28 * max(0.0, u_nebulaIntensity));
        }

        // 3. Localized Reflection & Dark Pillar Nebula (Carina / Horsehead style: Sapphire glow with dust finger)
        vec2 posReflection = -dir1 * 0.44 + dir2 * 0.22;
        float dReflect = length((p - posReflection) * vec2(0.9, 1.2));
        float envReflect = smoothstep(0.42, 0.05, dReflect);
        if (envReflect > 0.001) {
          float rn1 = noise3(vec3(p * 3.5, t * 0.03));
          float rn2 = noise3(vec3(p * 7.2 + 3.1, t * 0.05));
          float rCloud = smoothstep(0.34, 0.75, rn1 * 0.65 + rn2 * 0.35) * envReflect;

          vec3 sapphire = vec3(0.02, 0.07, 0.15);  // cool stardust reflection
          vec3 amberGlow = vec3(0.12, 0.08, 0.025); // photo-evaporation rim
          vec3 refCol = mix(sapphire, amberGlow, smoothstep(0.25, 0.65, rn1));

          // Dark silhouetted molecular pillar cutting in
          vec2 pillarCoord = p - posReflection + vec2(0.02, -0.04);
          float pDist = length(max(vec2(0.0), abs(pillarCoord + (rn2 - 0.5) * 0.05) - vec2(0.025, 0.16)));
          float pillarMask = smoothstep(0.04, 0.005, pDist) * envReflect;
          bgDust = max(bgDust, pillarMask);

          col += (refCol * rCloud * (1.0 - pillarMask * 0.85) + vec3(0.015, 0.008, 0.006) * pillarMask) * (0.26 * max(0.0, u_nebulaIntensity));
        }

        // 4. Localized Planetary Nebula Ring (Helix style: concentric ionized ring with cometary filaments)
        vec2 posRing = dir2 * 0.50 - dir1 * 0.12;
        float dRing = length(p - posRing);
        if (dRing < 0.26) {
          float rNorm = dRing / 0.20;
          float ringShell = exp(-pow(rNorm - 0.72, 2.0) * 36.0);
          float innerCore = exp(-pow(rNorm - 0.30, 2.0) * 24.0);
          float whiteDwarf = exp(-dRing * 120.0);

          vec3 ringCol = vec3(0.14, 0.06, 0.035) * ringShell + vec3(0.015, 0.10, 0.12) * innerCore + vec3(0.7, 0.85, 0.95) * whiteDwarf;
          col += ringCol * smoothstep(0.26, 0.18, dRing) * (0.28 * max(0.0, u_nebulaIntensity));
        }
      } else if (u_bgMode == 2) { // "Cosmic Cliffs" (Carina Nursery: Localized photo-evaporation ridge & backlit cyan cavity)
        vec2 warp = vec2(noise3(vec3(parPos * 2.8, t * 0.03)), noise3(vec3(parPos * 2.8 + 3.2, t * 0.03))) - 0.5;
        vec2 p = parPos + warp * 0.10;
        // Bounded celestial envelope for the Carina ridge
        float dCarina = length((p - vec2(0.1, 0.0)) * vec2(0.7, 1.3));
        float carinaEnv = smoothstep(0.65, 0.12, dCarina);
        if (carinaEnv > 0.001) {
          float n1 = noise3(vec3(p * 2.0, t * 0.04));
          float n2 = noise3(vec3(p * 4.8 + 1.8, t * 0.06));
          float n3 = noise3(vec3(p * 10.5 + 4.2, 0.3));
          float fbmVal = n1 * 0.52 + n2 * 0.33 + n3 * 0.15;
          float ridgeLine = p.y * 1.4 + p.x * 0.4 + (fbmVal - 0.5) * 0.55;
          float cliff = smoothstep(-0.15, 0.35, ridgeLine) * carinaEnv;
          float edge = smoothstep(0.02, 0.16, ridgeLine) * (1.0 - smoothstep(0.16, 0.34, ridgeLine)) * carinaEnv;
          float cavity = smoothstep(0.35, -0.25, ridgeLine) * (0.6 + 0.4 * n2) * carinaEnv;
          vec3 cavityCol = vec3(0.012, 0.07, 0.09) * cavity;
          vec3 cliffCol = mix(vec3(0.09, 0.03, 0.012), vec3(0.18, 0.09, 0.025), smoothstep(0.2, 0.55, fbmVal));
          cliffCol = mix(cliffCol, vec3(0.20, 0.16, 0.09), edge * 0.75);
          float pillarNoise = noise3(vec3(parPos.x * 6.5, parPos.y * 2.2, 0.8));
          float dustPillar = smoothstep(0.52, 0.78, pillarNoise) * smoothstep(0.25, -0.1, ridgeLine) * carinaEnv;
          bgDust = dustPillar;
          col += (cliffCol * cliff * (1.0 - dustPillar * 0.7) + cavityCol) * (0.28 * max(0.0, u_nebulaIntensity));
        }
      } else if (u_bgMode == 3) { // Milky Way Galactic Plane & Sagittarius Core (Luminous band with Great Rift dust)
        // Galactic equator band crossing diagonally across the sky
        float mwPlane = parPos.x * 0.60 + parPos.y * 0.80;
        float mwDisk = exp(-pow(mwPlane, 2.0) * 14.0);
        float mwWide = exp(-pow(mwPlane, 2.0) * 3.2) * 0.45;
        float mwStream = mwDisk + mwWide;

        // Sagittarius Core Bulge situated along the galactic equator
        vec2 sgrPos = parPos - vec2(-0.15, 0.11);
        float uSgr = sgrPos.x * 0.80 - sgrPos.y * 0.60;
        float vSgr = sgrPos.x * 0.60 + sgrPos.y * 0.80;
        float rBulge = length(vec2(uSgr * 1.3, vSgr * 2.4));
        float sgrBulge = exp(-pow(rBulge / 0.15, 0.55) * 3.2) * 1.5;
        float sgrNucleus = exp(-rBulge * 24.0) * 0.8;
        vec3 bulgeCol = vec3(0.24, 0.19, 0.12) * sgrBulge + vec3(0.36, 0.30, 0.20) * sgrNucleus;

        // The Great Rift: continuous filamentary dark molecular dust rifts
        float nDust1 = noise3(vec3(parPos * 4.6, 0.5));
        float nDust2 = noise3(vec3(parPos * 9.8 + 2.5, 0.8));
        float dustFbm = nDust1 * 0.65 + nDust2 * 0.35;
        float dustRift = smoothstep(0.42, 0.72, dustFbm) * exp(-pow(mwPlane / 0.16, 2.0) * 5.0);
        bgDust = max(bgDust, dustRift * 0.75);

        // Diffuse H-alpha star-forming emission complexes along the plane
        float nHalpha = noise3(vec3(parPos * 7.2 + 5.1, 0.3));
        float hAlphaKnots = smoothstep(0.55, 0.85, nHalpha) * exp(-pow(mwPlane / 0.10, 2.0) * 10.0);
        vec3 hAlphaCol = vec3(0.18, 0.04, 0.08) * hAlphaKnots * 0.65;

        // Integrated galactic light
        vec3 mwStarCol = mix(vec3(0.08, 0.11, 0.16), vec3(0.22, 0.20, 0.16), smoothstep(0.0, 0.4, sgrBulge));
        vec3 mwTotal = mwStarCol * mwStream * (1.0 - dustRift * 0.75) + bulgeCol * (1.0 - dustRift * 0.60) + hAlphaCol;
        col += mwTotal * (0.35 * max(0.0, u_nebulaIntensity));
      } else if (u_bgMode == 4) { // Auroral Veil: Undulating emerald green & violet solar wind ribbons
        float wave = sin(parPos.x * 4.5 + u_nebulaTime * 0.35) * 0.14 + sin(parPos.x * 11.0 - u_nebulaTime * 0.2) * 0.06;
        float ribbon = exp(-pow(parPos.y - wave - 0.08, 2.0) * 22.0);
        float n = noise3(vec3(parPos.x * 7.5, parPos.y * 2.5, u_nebulaTime * 0.1));
        vec3 aurCol = mix(vec3(0.02, 0.22, 0.14), vec3(0.12, 0.05, 0.20), smoothstep(0.2, 0.8, parPos.y));
        col += aurCol * ribbon * (0.65 + 0.35 * n) * (0.42 * max(0.0, u_nebulaIntensity));
      } else if (u_bgMode == 5) { // Supernova Remnant: Filamentary shockwave webbing & synchrotron core (Crab / Veil Nebula)
        vec2 snCenter = parPos - vec2(-0.08, 0.08);
        float rSN = length(snCenter * vec2(1.15, 0.92));
        float turb1 = (noise3(vec3(snCenter * 3.8, t * 0.05)) - 0.5) * 0.16;
        float turb2 = (noise3(vec3(snCenter * 9.5 + 1.7, t * 0.08)) - 0.5) * 0.08;
        float warpedR = rSN + turb1 + turb2;

        float outerShell = smoothstep(0.72, 0.54, warpedR) * smoothstep(0.32, 0.52, warpedR);
        float innerFilament = exp(-pow(warpedR - 0.46, 2.0) * 28.0);
        float outerFilament = exp(-pow(warpedR - 0.62, 2.0) * 32.0);

        float webNoise = noise3(vec3(snCenter * 14.0 + 3.2, 0.4));
        float web = smoothstep(0.42, 0.78, webNoise) * (innerFilament * 0.85 + outerFilament * 0.65);
        float pulsarCore = exp(-rSN * 5.5) * 0.35;

        vec3 o3Col = vec3(0.02, 0.16, 0.18) * outerShell * (0.7 + 0.3 * webNoise);
        vec3 hAlphaCol = vec3(0.22, 0.05, 0.09) * (innerFilament * 0.7 + web);
        vec3 coreCol = vec3(0.10, 0.18, 0.26) * pulsarCore;

        col += (o3Col + hAlphaCol + coreCol) * (0.42 * max(0.0, u_nebulaIntensity));
      } else if (u_bgMode == 7) { // "Pillars of Creation" (Eagle Nebula M16: Columnar SDFs in Hubble SHO Palette)
        vec2 pPos = parPos - vec2(0.02, 0.06);
        float lateralTurb = (noise3(vec3(pPos * 4.5, t * 0.04)) - 0.5) * 0.12;
        float dCol1 = length(max(vec2(0.0), abs(vec2(pPos.x + 0.18 + lateralTurb, pPos.y + 0.04)) - vec2(0.038, 0.30)));
        float dCol2 = length(max(vec2(0.0), abs(vec2(pPos.x - 0.04 + lateralTurb, pPos.y - 0.08)) - vec2(0.042, 0.22)));
        float dCol3 = length(max(vec2(0.0), abs(vec2(pPos.x - 0.22 + lateralTurb, pPos.y - 0.18)) - vec2(0.035, 0.15)));
        float pillarDist = min(dCol1, min(dCol2, dCol3));
        float pillarBody = smoothstep(0.06, 0.005, pillarDist);
        float pillarRim = smoothstep(0.09, 0.04, pillarDist) * (1.0 - smoothstep(0.04, 0.01, pillarDist));
        float o3Cavity = (0.55 + 0.45 * noise3(vec3(pPos * 2.8, t * 0.06))) * exp(-length(pPos) * 1.4);
        vec3 cavityCol = vec3(0.015, 0.12, 0.16) * o3Cavity * 0.7;
        vec3 rimCol = vec3(0.26, 0.18, 0.06) * pillarRim * 0.85;
        vec3 bodyCol = vec3(0.06, 0.02, 0.015) * pillarBody;
        bgDust = pillarBody;
        col += (bodyCol + rimCol + cavityCol) * (0.42 * max(0.0, u_nebulaIntensity));
      } else if (u_bgMode == 8) { // "Helix Ring" (Planetary Nebula NGC 7293: Polar concentric shells & radial cometary filaments)
        vec2 hPos = parPos;
        float rH = length(vec2(hPos.x, hPos.y * 1.25) * 2.8);
        float thetaH = atan(hPos.y, hPos.x);
        float dwarf = exp(-rH * 42.0);
        float innerPool = exp(-pow(rH - 0.22, 2.0) * 35.0);
        float ringShell = exp(-pow(rH - 0.62, 2.0) * 45.0);
        float outerHalo = exp(-pow(rH - 0.88, 2.0) * 25.0);
        float spokeHarmonics = cos(24.0 * thetaH + noise3(vec3(hPos * 12.0, 0.0)) * 6.0);
        float spokes = smoothstep(0.2, 0.85, spokeHarmonics) * smoothstep(0.15, 0.55, rH) * (1.0 - smoothstep(0.65, 0.82, rH));
        vec3 dCol = vec3(0.8, 0.8, 0.8) * dwarf * 0.9;
        vec3 poolCol = vec3(0.015, 0.16, 0.18) * innerPool * 0.7;
        vec3 ringCol = vec3(0.22, 0.05, 0.07) * ringShell * 0.8;
        vec3 haloCol = vec3(0.14, 0.03, 0.05) * outerHalo * 0.5;
        vec3 spokeCol = vec3(0.20, 0.11, 0.06) * spokes * 0.45;
        col += (dCol + poolCol + ringCol + haloCol + spokeCol) * (0.42 * max(0.0, u_nebulaIntensity));
      } else if (u_bgMode == 9) { // Asteroid Belt & Zodiacal Light (Diffuse debris torus + tumbling specular sun glints)
        // 1. Zodiacal forward-scattering dust torus along the ecliptic plane
        float ecliptic = parPos.y * 1.45 + parPos.x * 0.38;
        float dustTorus = exp(-pow(ecliptic, 2.0) * 16.0);
        float dustTurb = noise3(vec3(parPos * 4.2, 0.5));
        vec3 zodiacalCol = vec3(0.22, 0.20, 0.16) * (0.75 + 0.25 * dustTurb) * dustTorus * 0.35;
        col += zodiacalCol * (0.40 * max(0.0, u_nebulaIntensity));

        // 2. Deep-field tumbling asteroids with specular solar glints
        vec2 astGrid = floor(parPos * 38.0);
        float astSeed = hash(astGrid * 23.41);
        if (astSeed > 0.68) {
          vec2 astOffset = (astGrid + vec2(hash(astGrid + 3.1), hash(astGrid + 7.4))) / 38.0;
          float dAst = length(parPos - astOffset) * 38.0;
          if (dAst < 0.45) {
            float tumble = pow(max(0.0, sin(u_nebulaTime * (1.5 + astSeed * 3.0) + astSeed * 45.0)), 22.0);
            vec3 astCol = mix(vec3(0.42, 0.38, 0.34), vec3(1.0, 0.95, 0.85), tumble);
            col += astCol * (1.0 - dAst / 0.45) * (0.4 + 1.2 * tumble);
          }
        }
      }
    }
#endif

    // 3. Procedural Background Stars with Celestial Rotation (Zero Translational Drift & Beer-Lambert Extinction)
    vec2 celPixel = vec2(relPos.x * cRot - relPos.y * sRot, relPos.x * sRot + relPos.y * cRot) + seedOffset * 600.0;
    float starSpacing = 44.0 / sqrt(clamp(u_starDensity, 0.2, 2.5));
    vec2 gridCoord = floor(celPixel / starSpacing);
    float starVal = hash(gridCoord * 17.13 + fract(u_worldSeed * 0.053) * 100.0);
    if (u_starsVisible == 1 && starVal > 0.28) {
      vec2 starPos = (gridCoord + vec2(hash(gridCoord + 1.0), hash(gridCoord + 2.0))) * starSpacing;
      float starDist = length(celPixel - starPos);
      float maxR = starVal > 0.92 ? 1.6 : (starVal > 0.75 ? 1.2 : 0.95);
      if (starDist < maxR) {
        float b = 1.0 - starDist / maxR;
        float tw = 0.85 + 0.15 * sin(u_time * 1.8 + starVal * 28.0);
        vec3 starTint = starVal > 0.9 ? vec3(0.72, 0.84, 1.0) : (starVal > 0.7 ? vec3(1.0, 0.92, 0.75) : vec3(0.85, 0.88, 0.96));
        col += starTint * b * tw * (1.0 - bgDust * 0.72);
      }
    }

    // 4. Navigation Grids (Cartesian, Polar Radar Rings, Dots, or Hexagonal Honeycomb)
    if (u_gridEnabled == 1) {
      float sp = max(25.0, u_gridSpacing > 0.0 ? u_gridSpacing : 80.0);
      float gridAlpha = 0.0;
      float op = clamp(u_gridOpacity > 0.0 ? u_gridOpacity : 0.45, 0.05, 1.0);
      vec2 rel = pixelPos - u_resolution * 0.5;

      if (u_gridMode == 0) { // Cartesian coordinate grid with center crosshair axes
        vec2 d = abs(mod(rel + sp * 0.5, sp) - sp * 0.5);
        float lineDist = min(d.x, d.y);
        float gridLine = (1.0 - smoothstep(0.1, 1.3, lineDist)) * 0.50;
        float axisDist = min(abs(rel.x), abs(rel.y));
        float axisLine = (1.0 - smoothstep(0.2, 1.6, axisDist)) * 0.85;
        gridAlpha = max(gridLine, axisLine);
      } else if (u_gridMode == 1) { // Polar range rings & 8-point radial spokes
        float dist = length(rel);
        // Antialiased concentric range rings
        float ringDist = abs(mod(dist + sp * 0.75, sp * 1.5) - sp * 0.75);
        float rings = (1.0 - smoothstep(0.1, 1.4, ringDist)) * 0.55;
        // Central targeting reticle ring at 8px
        float reticle = (1.0 - smoothstep(0.1, 1.4, abs(dist - 8.0))) * 0.80;
        // 8-point radial navigation spokes: exact Euclidean distance in screen pixels
        float dAxes = min(abs(rel.x), abs(rel.y));
        float dDiags = min(abs(rel.x - rel.y), abs(rel.x + rel.y)) * 0.70710678;
        float dSpoke = min(dAxes, dDiags);
        float spokes = (1.0 - smoothstep(0.1, 1.3, dSpoke)) * smoothstep(16.0, 32.0, dist) * 0.45;
        gridAlpha = max(rings, max(reticle, spokes));
      } else if (u_gridMode == 2) { // Tactical dot matrix (discrete circular intersection pips)
        vec2 d = abs(mod(rel + sp * 0.5, sp) - sp * 0.5);
        float dotDist = length(d);
        // Crisp antialiased circular pip with bright solid core & phosphor bloom halo
        float dotCore = 1.0 - smoothstep(1.0, 2.8, dotDist);
        float dotGlow = (1.0 - smoothstep(2.0, 4.5, dotDist)) * 0.25;
        float dotAlpha = dotCore + dotGlow;
        // Highlight center origin pip with reticle ring
        float centerDist = length(rel);
        float centerCore = 1.0 - smoothstep(1.5, 4.2, centerDist);
        float centerRing = (1.0 - smoothstep(0.4, 1.8, abs(centerDist - 7.5))) * 0.75;
        gridAlpha = max(dotAlpha, max(centerCore, centerRing));
      } else if (u_gridMode == 3) { // Hexagonal astrometric honeycomb lattice
        float rIn = sp * 0.55;
        vec2 s = vec2(1.7320508, 1.0) * rIn;
        vec2 a = mod(rel, s * 2.0) - s;
        vec2 b = mod(rel - s, s * 2.0) - s;
        vec2 c = dot(a, a) < dot(b, b) ? a : b;
        vec2 h = abs(c);
        float edgeDist = abs(max(dot(h, vec2(0.8660254, 0.5)), h.y) - rIn);
        float hexLine = (1.0 - smoothstep(0.1, 1.4, edgeDist)) * 0.55;
        // Center vertex pip for each hexagon
        float centerPip = (1.0 - smoothstep(0.5, 2.5, length(c))) * 0.55;
        gridAlpha = max(hexLine, centerPip);
      }

      if (gridAlpha > 0.0) {
        vec3 hudColor = length(u_gridColor) > 0.01 ? u_gridColor : vec3(0.35, 0.72, 1.0);
        float a = gridAlpha * op;
        col = mix(col, hudColor, a * 0.55) + hudColor * (a * 0.65);
      }
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
        if (b.style == 4 && lit && r >= 4.0) {
          float ang = 0.42 - u_camRotation;
          vec3 nRing = normalize(vec3(2.434 * sin(ang), 2.434 * cos(ang), 1.0));
          vec3 pSurf = vec3(v.x * r, v.y * r, z * r);
          float denom = dot(light, nRing);
          if (abs(denom) > 0.001) {
            float tRing = -dot(pSurf, nRing) / denom;
            if (tRing > 0.0) {
              vec3 qRing = pSurf + tRing * light;
              float rHit = length(qRing);
              float inRing = smoothstep(1.30 * r, 1.34 * r, rHit) * smoothstep(2.32 * r, 2.26 * r, rHit);
              float inCassini = 1.0 - smoothstep(0.02 * r, 0.0, abs(rHit - 1.98 * r));
              float ringShadow = inRing * (1.0 - 0.75 * inCassini) * 0.72;
              day *= (1.0 - ringShadow);
            }
          }
        }
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

  // Draw rings, atmospheres, coronas and distant body dots in front of the background / topmost disc
  for (int i = 0; i < 8; i++) {
    if (i >= u_bodyCount) break;
    Body b = u_bodies[i];
    float r = b.radius;
    vec2 relCenter = pixelPos - b.screenPos;
    float distSq = dot(relCenter, relCenter);

    // Fast bounding cull: skip all expensive math if pixel is far outside the body's influence
    float maxReach = r < 2.5 ? 6.5 : (b.isStar == 1 ? (r > 2048.0 ? r + 205.0 : r * 1.85) : (b.style == 4 ? r * 2.45 : r + min(28.0, r * 0.2)));
    if (distSq > maxReach * maxReach) continue;

    // Distant body marker dot
    if (r < 2.5) {
      if (i <= hitIdx) continue;
      float d = sqrt(distSq);
      if (b.isStar == 1) {
        if (d <= 6.0) col = mix(col, b.atmosphere.rgb, b.atmosphere.a);
        if (d <= 3.0) col = vec3(1.0);
      } else if (d <= 2.5) {
        col = b.style > 0 ? b.mean : b.accent;
      }
      continue;
    }

    float sd = bodySd(b, pixelPos);

#ifndef SCENE_LITE
    // Planetary rings (e.g. style == 4 banded gas giant)
    if (b.style == 4 && r >= 4.0) {
      vec4 ring = planetRing(b, pixelPos, sd);
      if (ring.a > 0.0) col = mix(col, ring.rgb, ring.a);
    }
#endif

    if (i <= hitIdx) continue;

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
      // Atmospheric scale height: authentic scientific scale height is 1-2% of planet radius.
      // From orbit, it forms a crisp, delicate luminous rim, never a blown-out fog.
      float scaleHeight = max(1.0, min(8.0, 0.035 * r));
      float atmoLimit = scaleHeight * 3.5;
      if (sd > 0.0 && sd < atmoLimit) {
        bool lit = dot(b.sunDir, b.sunDir) > 0.5;
        vec3 light = lit ? normalize(vec3(b.sunDir.x, -b.sunDir.y, 0.25)) : normalize(vec3(-0.5, 0.55, 0.65));
        vec2 rim = normalize(vec2(relCenter.x, -relCenter.y));
        float cosRim = lit ? dot(rim, normalize(light.xy)) : 1.0;
        float alpha = b.atmosphere.a * 1.2 * exp(-sd / scaleHeight) * smoothstep(atmoLimit, atmoLimit * 0.4, sd);
        // Dim atmosphere gracefully when planet disc shrinks below 36px so tiny planets stay crisp
        float zoomFade = smoothstep(5.0, 32.0, r);
        alpha *= zoomFade;
        vec3 airCol = b.atmosphere.rgb * 1.1;
        if (lit) {
          alpha *= 0.15 + 0.85 * smoothstep(-0.25, 0.1, cosRim);
          airCol = mix(airCol, vec3(1.0, 0.55, 0.3), (1.0 - smoothstep(0.0, 0.3, abs(cosRim))) * 0.75);
        }
        col = mix(col, airCol, clamp(alpha, 0.0, 1.0));
      }
#endif
    } else {
      float atmoThickness = max(1.0, min(12.0, 0.05 * r));
      if (sd > 0.0 && sd <= atmoThickness) {
        bool lit = dot(b.sunDir, b.sunDir) > 0.5;
        float cosSun = lit ? dot(normalize(relCenter), b.sunDir) : 1.0;
        float atmoT = 1.0 - sd / atmoThickness;
        float atmoAlpha = b.atmosphere.a * pow(atmoT, 1.5) * smoothstep(4.0, 24.0, r);
        vec3 atmoCol = b.atmosphere.rgb;
        if (lit) {
          atmoAlpha *= 0.2 + 0.8 * smoothstep(-0.25, 0.1, cosSun);
          atmoCol = mix(atmoCol, vec3(1.0, 0.6, 0.35), (1.0 - smoothstep(0.0, 0.3, abs(cosSun))) * 0.7);
        }
        col = mix(col, atmoCol, atmoAlpha);
      }
    }
  }

  fragColor = vec4(col, 1.0);
}
