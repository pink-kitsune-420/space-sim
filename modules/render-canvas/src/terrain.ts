/** Licensed local renderer helper; first-party MIT source, see NOTICE. */
import type { RenderGeometry, SurfaceProfile } from '@space-sim/game-api';
import type { Camera, RenderBody } from './frame';
import { overviewColor } from '@space-sim/game-api';
import { daylight, skyLight, twilight, TWILIGHT_COLOR } from './lighting';

const TAU = 2 * Math.PI;
/** CSS pixels, independent of framebuffer DPI. Curve + simplification <= 0.5. */
export const TERRAIN_ERROR = 0.5;
const CURVE_ERROR = 0.2, REDUCTION_ERROR = TERRAIN_ERROR - CURVE_ERROR;
type Color = readonly [number, number, number, number];
export interface TerrainPoint { readonly x: number; readonly y: number; readonly angle: number; readonly radius: number }
export interface TerrainFace {
  /** Illustration never contributes extra canonical air-mask geometry. */
  readonly overview?: boolean;
  readonly points: readonly { x: number; y: number }[];
  readonly color: Color;
  readonly gradient?: { readonly from: { x: number; y: number }; readonly to: { x: number; y: number }; readonly color: Color };
}
export interface TerrainGeometry {
  readonly boundary: readonly TerrainPoint[];
  readonly groundClip: readonly { x: number; y: number }[];
  readonly faces: readonly TerrainFace[];
  readonly edge: readonly (readonly [{ x: number; y: number }, { x: number; y: number }])[];
  readonly accents: readonly (readonly { x: number; y: number }[])[];
  readonly accentColor: Color;
  readonly sourcePoints: number;
}

function rgba(hex: string, alpha = 1): Color {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : alpha];
}
const mix = (a: Color, b: Color, t: number): Color => a.map((v, i) => v + (b[i]! - v) * t) as unknown as Color;
const dim = (c: Color, k: number): Color => [c[0] * k, c[1] * k, c[2] * k, c[3]];
export const terrainCSS = (c: Color): string => `rgba(${c[0] * 255},${c[1] * 255},${c[2] * 255},${c[3]})`;
export function terrainFaceColor(face: TerrainFace, p: { x: number; y: number }): Color {
  const g = face.gradient;
  if (!g) return face.color;
  const dx = g.to.x - g.from.x, dy = g.to.y - g.from.y;
  const t = ((p.x - g.from.x) * dx + (p.y - g.from.y) * dy) / (dx * dx + dy * dy);
  return mix(face.color, g.color, Math.max(0, Math.min(1, t)));
}

/** Sutherland–Hodgman in double precision. GPU/Canvas never receive huge planet vertices. */
function clipPolygon(points: readonly { x: number; y: number }[], width: number, height: number): { x: number; y: number }[] {
  let out = [...points];
  for (const [axis, value, sign] of [['x', -2, 1], ['x', width + 2, -1], ['y', -2, 1], ['y', height + 2, -1]] as const) {
    const input = out; out = [];
    if (!input.length) break;
    let a = input.at(-1)!;
    for (const b of input) {
      const da = (a[axis] - value) * sign, db = (b[axis] - value) * sign;
      if ((da >= 0) !== (db >= 0)) {
        const t = da / (da - db);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      if (db >= 0) out.push(b);
      a = b;
    }
  }
  return out;
}

function clipLine(a: { x: number; y: number }, b: { x: number; y: number }, width: number, height: number): readonly [{ x: number; y: number }, { x: number; y: number }] | undefined {
  let lo = 0, hi = 1;
  for (const [p, q, limit] of [[a.x, b.x, width], [a.y, b.y, height]] as const) {
    // Each component is clipped independently, including parallel segments.
    const delta = q - p;
    if (delta === 0) { if (p < -2 || p > limit + 2) return; }
    else {
      const t0 = (-2 - p) / delta, t1 = (limit + 2 - p) / delta;
      lo = Math.max(lo, Math.min(t0, t1)); hi = Math.min(hi, Math.max(t0, t1));
    }
  }
  if (lo > hi) return;
  return [{ x: a.x + (b.x - a.x) * lo, y: a.y + (b.y - a.y) * lo },
    { x: a.x + (b.x - a.x) * hi, y: a.y + (b.y - a.y) * hi }];
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const x = b.x - a.x, y = b.y - a.y, length2 = x * x + y * y;
  const t = length2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / length2));
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
}

/** Iterative RDP. Every omitted vertex lies within REDUCTION_ERROR of its retained chord. */
function reduce(points: TerrainPoint[]): TerrainPoint[] {
  const keep = new Uint8Array(points.length); keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = REDUCTION_ERROR, index = -1;
    for (let i = a! + 1; i < b!; i++) {
      const error = segmentDistance(points[i]!, points[a!]!, points[b!]!);
      if (error > worst) { worst = error; index = i; }
    }
    if (index >= 0) { keep[index] = 1; stack.push([a!, index], [index, b!]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** Camera-local anchor avoids subtracting enormous projected floats near a horizon.
 * The cos(delta)-1 identity retains curvature even for very small visible angles. */
function localProjector(profile: SurfaceProfile, body: RenderBody, camera: Camera, width: number, height: number, querySurface: RenderGeometry['querySurface']) {
  const x = camera.center.x - body.position.x, y = camera.center.y - body.position.y;
  const theta = Math.atan2(y, x), c = Math.cos(theta), s = Math.sin(theta);
  const r0 = querySurface(profile, theta).firstContactRadius;
  const ax = r0 * c - x, ay = r0 * s - y;
  const cr = Math.cos(camera.rotation), sr = Math.sin(camera.rotation);
  return (angle: number, radius: number): TerrainPoint => {
    const d = angle - theta, radial = radius - r0 - 2 * radius * Math.sin(d / 2) ** 2;
    const tangent = radius * Math.sin(d);
    const px = ax + c * radial - s * tangent, py = ay + s * radial + c * tangent;
    return { x: width / 2 + (px * cr - py * sr) * camera.scale,
      y: height / 2 - (px * sr + py * cr) * camera.scale, angle, radius };
  };
}

/** Only directions intersecting a padded viewport can contribute ground or atmosphere. */
function visibleAngles(body: RenderBody, camera: Camera, width: number, height: number): readonly [number, number] {
  const x = camera.center.x - body.position.x, y = camera.center.y - body.position.y;
  const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
  const bx = width / 2 + (-x * c + y * s) * camera.scale;
  const by = height / 2 + (x * s + y * c) * camera.scale;
  if (bx >= -132 && bx <= width + 132 && by >= -132 && by <= height + 132) return [0, TAU];
  const theta = Math.atan2(y, x);
  let low = 0, high = 0;
  for (const sx of [-132, width + 132]) for (const sy of [-132, height + 132]) {
    const px = (sx - width / 2) / camera.scale, py = -(sy - height / 2) / camera.scale;
    const angle = Math.atan2(y - px * s + py * c, x + px * c + py * s);
    const diff = Math.atan2(Math.sin(angle - theta), Math.cos(angle - theta));
    low = Math.min(low, diff); high = Math.max(high, diff);
  }
  return [theta + low, theta + high];
}

/** The same view from the body's turning frame: terrain is generated and cached there. */
function bodyFrameCamera(body: RenderBody, camera: Camera): Camera {
  const angle = body.rotation ?? 0;
  if (!angle) return camera;
  const x = camera.center.x - body.position.x, y = camera.center.y - body.position.y;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { ...camera, center: { x: body.position.x + x * c + y * s, y: body.position.y - x * s + y * c },
    rotation: camera.rotation + angle };
}

const LAST_GEOMETRY = new WeakMap<SurfaceProfile, { key: string; querySurface: RenderGeometry['querySurface']; overview: RenderBody['overview']; geometry: TerrainGeometry }>();
/** One last view per immutable profile; no growing history of zoom levels or universes. */
export function terrainGeometry(body: RenderBody & { surface: SurfaceProfile }, view: Camera, width: number, height: number, geometryPort: RenderGeometry): TerrainGeometry {
  const { querySurface } = geometryPort;
  const profile = body.surface, camera = bodyFrameCamera(body, view);
  // The sun in the body's own frame; slow orbital drift is rounded so a still view stays cached.
  const angle = body.rotation ?? 0, sunDirection = body.sunDirection;
  const sun = sunDirection && { x: Math.cos(angle) * sunDirection.x + Math.sin(angle) * sunDirection.y,
    y: -Math.sin(angle) * sunDirection.x + Math.cos(angle) * sunDirection.y };
  const key = JSON.stringify([camera.center.x - body.position.x, camera.center.y - body.position.y,
    camera.scale, camera.rotation, width, height, body.color, body.accentColor, body.horizonColor, body.atmosphereColor, body.skyColor, Boolean(body.air), Boolean(body.overview),
    sun ? [Math.round(sun.x * 1e3), Math.round(sun.y * 1e3)] : null]);
  const cached = LAST_GEOMETRY.get(profile);
  if (cached?.key === key && cached.querySurface === querySurface && cached.overview === body.overview) return cached.geometry;
  const localDistance = Math.hypot(camera.center.x - body.position.x, camera.center.y - body.position.y);
  const viewportRadius = Math.hypot(width / 2, height / 2) / camera.scale;
  // No surface direction is visible when the entire viewport is inside the
  // minimum ground envelope. Avoid tessellating a huge, completely hidden disc.
  if (localDistance + viewportRadius < profile.bounds.minRadius) {
    const groundClip = [{ x: -2, y: -2 }, { x: width + 2, y: -2 },
      { x: width + 2, y: height + 2 }, { x: -2, y: height + 2 }];
    const geometry: TerrainGeometry = { boundary: [], groundClip, sourcePoints: 0, edge: [], accents: [],
      accentColor: rgba(body.horizonColor ?? body.accentColor ?? '#659497'),
      faces: [{ points: groundClip, color: rgba(profile.hasWater ? '#082b49' : '#101e2b') }] };
    LAST_GEOMETRY.set(profile, { key, querySurface, overview: body.overview, geometry });
    return geometry;
  }
  const project = localProjector(profile, body, camera, width, height, querySurface);
  const [start, end] = visibleAngles(body, camera, width, height);
  const delta = TAU / profile.sampleCount;
  const points: TerrainPoint[] = [];
  const cuts = profile.coastAngles.flatMap(angle => {
    const first = angle + Math.ceil((start - angle) / TAU) * TAU;
    return first <= end ? [first, ...(first + TAU <= end ? [first + TAU] : [])] : [];
  }).sort((a, b) => a - b);
  let cutIndex = 0;
  const preserved: number[] = [0];
  let a = start;
  points.push(project(a, querySurface(profile, a).firstContactRadius));
  while (a < end) {
    while (cutIndex < cuts.length && cuts[cutIndex]! <= a) cutIndex++;
    const knot = Math.floor((a - profile.orientationRadians) / delta + 1e-9) + 1;
    const b = Math.min(end, profile.orientationRadians + knot * delta, cuts[cutIndex] ?? Infinity);
    const bounds = profile.intervalBounds(((knot - 1) % profile.sampleCount + profile.sampleCount) % profile.sampleCount);
    // |p''| <= r + 2|dr/dtheta| on a linear polar interval. Chord error <= M*h²/8.
    const maxStep = Math.sqrt(8 * CURVE_ERROR / (camera.scale * (Math.max(bounds.maxRadius, profile.seaRadiusMetres ?? 0) + 2 * bounds.maxAbsDerivative)));
    const divisions = Math.max(1, Math.ceil((b - a) / maxStep));
    for (let j = 1; j <= divisions; j++) {
      const angle = a + (b - a) * j / divisions;
      points.push(project(angle, querySurface(profile, angle).firstContactRadius));
    }
    if (b === cuts[cutIndex]) preserved.push(points.length - 1);
    const waterDepth = querySurface(profile, b).waterDepth;
    if (waterDepth > 0 && waterDepth < Math.max(.1, profile.referenceRadius * .005)) preserved.push(points.length - 1);
    a = b;
  }
  // Keep quadrants before simplifying a closed circle (its first and last vertex coincide).
  const boundary: TerrainPoint[] = [];
  for (let i = 1; i <= 4; i++) preserved.push(Math.floor(i * (points.length - 1) / 4));
  const sections = [...new Set(preserved)].sort((a, b) => a - b);
  for (let i = 1; i < sections.length; i++) {
    const lo = sections[i - 1]!, hi = sections[i]!;
    if (hi <= lo) continue;
    const section = reduce(points.slice(lo, hi + 1));
    boundary.push(...(boundary.length ? section.slice(1) : section));
  }
  const faces: TerrainFace[] = [], edge: Array<readonly [{ x: number; y: number }, { x: number; y: number }]> = [];
  const accents: Array<readonly { x: number; y: number }[]> = [];
  const base = rgba(body.color ?? '#233c47'), dark = rgba('#101e2b');
  const accentColor = rgba(body.horizonColor ?? body.accentColor ?? '#659497');
  const sky = rgba(body.air ? '#00000000' : body.skyColor ?? body.atmosphereColor ?? '#29495380');
  const center = project(0, 0);
  const depth = Math.min(profile.bounds.minRadius * .22, 220 / camera.scale);
  // Air is a share of the radius, so it stays as deep as the zoom shows it, however close.
  const glowPx = Math.min(18, Math.max(2, profile.bounds.maxRadius * camera.scale * 0.05));
  const glow = glowPx / camera.scale;
  let overviewTriangles = 0, overviewOverflow = false;
  const face = (vertices: readonly { x: number; y: number }[], color: Color, gradient?: TerrainFace['gradient'], overview = false) => {
    const clipped = clipPolygon(vertices, width, height);
    if (clipped.length >= 3) {
      if (overview) {
        overviewTriangles += clipped.length - 2;
        if (overviewTriangles > 1024) { overviewOverflow = true; return; }
      }
      faces.push({ points: clipped, color, gradient, ...(overview ? { overview: true } : {}) });
    }
  };
  for (let i = 1; i < boundary.length; i++) {
    const p = boundary[i - 1]!, q = boundary[i]!;
    const middle = (p.angle + q.angle) / 2, radius = (p.radius + q.radius) / 2;
    const query = querySurface(profile, middle), water = query.material === 'water';
    const ocean = profile.hasWater;
    const deep = water ? rgba('#082b49') : dark;
    face([center, p, q], ocean ? rgba('#082b49') : dark);
    // Illustrative land extends inward from the same exact shore crossings.
    // Taper to zero at both coasts instead of painting radial pie sectors.
    const landDepth = (radius: number) => ocean ? Math.min(radius * .75, Math.max(0, radius - profile.seaRadiusMetres!) * 8) : depth;
    const pDepth = water ? depth : Math.min(depth, landDepth(p.radius));
    const qDepth = water ? depth : Math.min(depth, landDepth(q.radius));
    if (ocean && !water) face([p, q, project(q.angle, q.radius - landDepth(q.radius)), project(p.angle, p.radius - landDepth(p.radius))], dark);
    const normal = query.normal;
    // Slopes facing the sun are brighter; without a sun, a fixed upper-left light.
    const light = .45 + .3 * (sun ? normal.x * sun.x + normal.y * sun.y : normal.x * -.6 + normal.y * .8);
    const cosSun = sun ? Math.cos(middle) * sun.x + Math.sin(middle) * sun.y : 1;
    const day = sun ? daylight(cosSun) : 1;
    const shallowScale = Math.max(.1, profile.referenceRadius * .005);
    const shade = dim(water ? mix(rgba('#53afad'), rgba('#155882'), Math.min(1, query.waterDepth / shallowScale))
      : mix(dark, base, light + .25), day);
    face([p, q, project(q.angle, q.radius - qDepth), project(p.angle, p.radius - pDepth)], shade,
      { from: project(middle, radius), to: project(middle, radius - Math.max(1e-12, (pDepth + qDepth) / 2)), color: deep });
    if (water) {
      const band = Math.min(query.waterDepth, 8 / camera.scale);
      face([p, q, project(q.angle, q.radius - band), project(p.angle, p.radius - band)], rgba('#71c5c338'),
        { from: project(middle, radius), to: project(middle, radius - band), color: rgba('#71c5c300') });
    }
    // The atmosphere glows by day, fades at night and warms at sunrise and sunset.
    const air: Color = !sun ? sky : (() => {
      const warm = mix(sky, [...TWILIGHT_COLOR, sky[3]] as Color, twilight(cosSun) * .7);
      return [warm[0], warm[1], warm[2], sky[3] * skyLight(cosSun)];
    })();
    if (air[3] > 0) face([p, q, project(q.angle, q.radius + glow), project(p.angle, p.radius + glow)], air,
      { from: project(middle, radius), to: project(middle, radius + glow), color: [air[0], air[1], air[2], 0] });
    const line = clipLine(p, q, width, height);
    if (line) edge.push(line);
  }
  // Illustrative interior markings use feature IDs/angles, never independent noise.
  // They stay strictly inside the minimum ground envelope at every orientation.
  for (const feature of profile.features) {
    if (profile.hasWater) continue;
    const r = profile.bounds.minRadius;
    const centerAngle = feature.angleRadians;
    if (feature.kind === 'crater') {
      const ring = Math.min(r * .13, feature.bowlRadiusMetres * .8);
      if (ring * camera.scale < 2) continue;
      const ox = r * .65 * Math.cos(centerAngle), oy = r * .65 * Math.sin(centerAngle);
      for (const factor of [1, .72]) {
        const center = project(centerAngle, r * .65);
        if (Math.abs(Math.hypot(center.x - width / 2, center.y - height / 2) - factor * ring * camera.scale)
          > Math.hypot(width / 2, height / 2) + 3) continue;
        const samples = Math.max(16, Math.ceil(Math.PI * Math.sqrt(ring * camera.scale / TERRAIN_ERROR)));
        const line: { x: number; y: number }[] = [];
        for (let j = 0; j <= samples; j++) {
          const angle = TAU * j / samples;
          const x = ox + factor * ring * Math.cos(angle), y = oy + factor * ring * Math.sin(angle);
          const p = project(Math.atan2(y, x), Math.hypot(x, y));
          if (line.length) { const segment = clipLine(line.at(-1)!, p, width, height); if (segment) accents.push(segment); }
          line.push(p);
        }
      }
    } else {
      const half = Math.min(.3, feature.widthMetres / r / 3);
      for (const offset of [0, -.04]) {
        let previous: TerrainPoint | undefined;
        for (let j = 0; j <= 24; j++) {
          const angle = centerAngle - half + 2 * half * j / 24;
          const p = project(angle, r * (.78 + offset + .025 * Math.sin(j * Math.PI / 6)));
          if (previous) { const line = clipLine(previous, p, width, height); if (line) accents.push(line); }
          previous = p;
        }
      }
    }
  }
  // Bounded pseudo-sphere color only; the exact canonical rim/coasts above remain
  // authoritative. Keep the original complete ground underneath every fade/loading state.
  const originalFaceCount = faces.length;
  const amount = body.overview ? Math.max(0, Math.min(1, (1.4 - profile.referenceRadius * camera.scale / Math.max(width, height)) / .55)) : 0;
  if (amount > 0 && boundary.length <= 257) {
    const rings = 2, sample = new Float64Array(4), outer = new Float64Array(4);
    for (let i = 1; i < boundary.length; i++) {
      const p = boundary[i - 1]!, q = boundary[i]!, angle = (p.angle + q.angle) / 2;
      const ground = querySurface(profile, angle), radius = (p.radius + q.radius) / 2;
      for (let ring = 0; ring < rings; ring++) {
        const lo = ring / rings, hi = (ring + 1) / rings, fraction = (lo + hi) / 2;
        if (!overviewColor(body, angle, lo, 2 * Math.PI * profile.referenceRadius * camera.scale, sample)) continue;
        // Same illustrative coast taper as the original terrain, never invented water.
        const landDepth = profile.hasWater ? Math.min(radius * .75, Math.max(0, radius - profile.seaRadiusMetres!) * 8) : radius;
        const water = profile.hasWater && (ground.material === 'water' || radius * fraction < radius - landDepth);
        overviewColor(body, angle, hi, 2 * Math.PI * profile.referenceRadius * camera.scale, outer);
        const endColor: Color = water ? [outer[0]! * .20, outer[1]! * .55, outer[2]! * .85, amount] : [outer[0]!, outer[1]!, outer[2]!, amount];
        const color: Color = water ? [sample[0]! * .20, sample[1]! * .55, sample[2]! * .85, amount] : [sample[0]!, sample[1]!, sample[2]!, amount];
        face([project(p.angle, p.radius * lo), project(q.angle, q.radius * lo),
          project(q.angle, q.radius * hi), project(p.angle, p.radius * hi)], color,
            { from: project(angle, radius * lo), to: project(angle, radius * hi), color: endColor }, true);
      }
    }
  }
  if (overviewOverflow) faces.length = originalFaceCount;
  const groundClip = clipPolygon([center, ...boundary], width, height);
  const geometry = { boundary, groundClip, faces, edge, accents, accentColor, sourcePoints: points.length };
  LAST_GEOMETRY.set(profile, { key, querySurface, overview: body.overview, geometry });
  return geometry;
}

export function drawCanvasTerrain(ctx: CanvasRenderingContext2D, geometry: TerrainGeometry): void {
  const opaque = (face: TerrainFace) => face.color[3] === 1 && (!face.gradient || face.gradient.color[3] === 1);
  const draw = (face: TerrainFace) => {
    const g = face.gradient;
    let fill: CanvasGradient | string = terrainCSS(face.color);
    if (g) {
      fill = ctx.createLinearGradient(g.from.x, g.from.y, g.to.x, g.to.y);
      fill.addColorStop(0, terrainCSS(face.color)); fill.addColorStop(1, terrainCSS(g.color));
    }
    ctx.fillStyle = fill;
    ctx.beginPath();
    face.points.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
    ctx.closePath(); ctx.fill();
    // Cover antialias cracks between opaque sectors inside the silhouette clip.
    if (opaque(face)) {
      ctx.strokeStyle = fill; ctx.lineWidth = 1.5; ctx.stroke();
    }
  };
  ctx.save(); ctx.beginPath();
  geometry.groundClip.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.closePath(); ctx.clip();
  for (const face of geometry.faces) if (opaque(face)) draw(face);
  ctx.restore();
  for (const face of geometry.faces) if (!opaque(face)) draw(face);
  ctx.strokeStyle = terrainCSS(geometry.accentColor); ctx.lineWidth = 1;
  ctx.beginPath();
  for (const [a, b] of geometry.edge) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
  ctx.stroke();
  ctx.globalAlpha = .24;
  ctx.beginPath();
  for (const line of geometry.accents) line.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
  ctx.stroke(); ctx.globalAlpha = 1;
}
