import type { SurfacePadDefinition, SurfaceDefinition, SurfaceQuery, SurfaceFeature, SurfaceProfile } from '../../game-api/src/index';
export type { SurfacePadDefinition, SurfaceDefinition, SurfaceBounds, SurfaceQuery, SurfaceFeature, SurfaceProfile } from '../../game-api/src/index';
import * as dm from './dmath';
export const SURFACE_LIMITS = Object.freeze({
  minSamples: 32,
  maxSamples: 65_536,
  maxMountainRanges: 256,
  maxCraters: 4096,
  maxPads: 64,
  maxUniverseSamples: 1_048_576,
  maxUniverseFeatures: 16_384,
});

/** Strict, detached and immutable: unknown fields cannot silently alter identity. */
export function validateSurfaceDefinition(raw: unknown, referenceRadius: number, context = 'Surface'): SurfaceDefinition {
  const fail = (message: string): never => { throw new Error(`${context}: ${message}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be an object');
  const s = raw as Record<string, unknown>;
  const fields = ['kind', 'generatorVersion', 'seed', 'sampleCount', 'maxReliefMetres',
    'minFeatureWidthMetres', 'orientationRadians', 'mountainRangeCount', 'craterCount', 'pads', 'seaRadiusMetres'] as const;
  for (const key of Object.keys(s)) {
    if (!(fields as readonly string[]).includes(key)) fail(`unknown setting ${key}`);
  }
  if (s.kind !== 'radial') fail('kind must be "radial"');
  if (s.generatorVersion !== 1) fail('unsupported generatorVersion; expected 1');
  const finite = (key: typeof fields[number]): number => {
    const value = s[key];
    if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${key} must be a finite number`);
    return value as number;
  };
  const integer = (key: typeof fields[number], min: number, max: number): number => {
    const value = finite(key);
    if (!Number.isInteger(value) || value < min || value > max) fail(`${key} must be an integer in [${min}, ${max}]`);
    return value;
  };
  const seed = integer('seed', 0, 0xffff_ffff);
  const sampleCount = integer('sampleCount', SURFACE_LIMITS.minSamples, SURFACE_LIMITS.maxSamples);
  const mountainRangeCount = integer('mountainRangeCount', 0, SURFACE_LIMITS.maxMountainRanges);
  const craterCount = integer('craterCount', 0, SURFACE_LIMITS.maxCraters);
  const maxReliefMetres = finite('maxReliefMetres');
  if (maxReliefMetres < 0) fail('maxReliefMetres must be >= 0');
  if (!Number.isFinite(referenceRadius) || referenceRadius <= 0
    || referenceRadius - maxReliefMetres <= 0 || !Number.isFinite(referenceRadius + maxReliefMetres)) {
    fail('reference radius +/- maxReliefMetres must give finite, positive radii');
  }
  const circumference = 2 * Math.PI * referenceRadius;
  const minFeatureWidthMetres = finite('minFeatureWidthMetres');
  // At least four sample intervals across the narrowest authored feature.
  if (!Number.isFinite(circumference) || minFeatureWidthMetres <= 0
    || minFeatureWidthMetres < 4 * (circumference / sampleCount) || minFeatureWidthMetres > circumference) {
    fail('minFeatureWidthMetres must span at least 4 sample intervals and at most the reference circumference');
  }
  const orientationRadians = finite('orientationRadians');
  const seaRadiusMetres = s.seaRadiusMetres === undefined ? undefined : finite('seaRadiusMetres');
  if (seaRadiusMetres !== undefined && !(seaRadiusMetres > 0 && seaRadiusMetres <= referenceRadius + maxReliefMetres)) {
    fail('seaRadiusMetres must be positive and at most reference radius + maxReliefMetres');
  }
  if (orientationRadians < 0 || orientationRadians >= 2 * Math.PI) fail('orientationRadians must be in [0, 2*pi)');
  const slopeBound = (2 * maxReliefMetres / (2 * Math.PI / sampleCount)) / (referenceRadius - maxReliefMetres);
  if (!Number.isFinite(slopeBound)) fail('relief and resolution must give a finite conservative slope bound');
  let pads: readonly SurfacePadDefinition[] | undefined;
  if (s.pads !== undefined) {
    if (!Array.isArray(s.pads) || s.pads.length > SURFACE_LIMITS.maxPads) fail(`pads must be an array of at most ${SURFACE_LIMITS.maxPads} regions`);
    const ids = new Set<string>();
    const sampleWidth = circumference / sampleCount;
    pads = Object.freeze((s.pads as unknown[]).map((rawPad, index) => {
      if (!rawPad || typeof rawPad !== 'object' || Array.isArray(rawPad)) fail(`pads[${index}] must be an object`);
      const p = rawPad as Record<string, unknown>;
      if (Object.keys(p).some(key => !['id', 'angleRadians', 'widthMetres', 'elevationMetres'].includes(key))) fail(`pads[${index}] has unknown settings`);
      if (typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id)) fail(`pads[${index}].id must be unique and contain 1–64 letters, digits, underscores or hyphens`);
      const id = p.id as string;
      ids.add(id);
      const number = (key: string): number => {
        if (typeof p[key] !== 'number' || !Number.isFinite(p[key])) fail(`pads[${index}].${key} must be finite`);
        return p[key] as number;
      };
      const angleRadians = number('angleRadians'), widthMetres = number('widthMetres'), elevationMetres = number('elevationMetres');
      if (angleRadians < 0 || angleRadians >= 2 * Math.PI) fail(`pads[${index}].angleRadians must be in [0, 2*pi)`);
      if (widthMetres < 4 * sampleWidth || widthMetres + 2 * (minFeatureWidthMetres + sampleWidth) > circumference) fail(`pads[${index}].widthMetres must span at least 4 intervals and leave room for both shoulders`);
      if (Math.abs(elevationMetres) > maxReliefMetres) fail(`pads[${index}].elevationMetres exceeds maxReliefMetres`);
      if (seaRadiusMetres !== undefined && referenceRadius + elevationMetres <= seaRadiusMetres) fail(`pads[${index}] must be above sea level`);
      return Object.freeze({ id, angleRadians, widthMetres, elevationMetres });
    }));
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i]!, b = pads[j]!;
      const difference = Math.abs(a.angleRadians - b.angleRadians);
      const distance = Math.min(difference, 2 * Math.PI - difference) * referenceRadius;
      if (distance < a.widthMetres / 2 + b.widthMetres / 2 + 2 * (minFeatureWidthMetres + sampleWidth)) fail('pad regions and shoulders must not overlap');
    }
  }
  return Object.freeze({ kind: 'radial', generatorVersion: 1, seed, sampleCount,
    maxReliefMetres, minFeatureWidthMetres, orientationRadians, mountainRangeCount, craterCount,
    ...(seaRadiusMetres === undefined ? {} : { seaRadiusMetres }),
    ...(pads === undefined ? {} : { pads }) });
}

const IDENTITIES = new WeakMap<object, string>();
/** Canonical, collision-free tuple of the full validated physical configuration.
 * Appearance, body ID and mu are separate concerns. Never use a seed alone as a key. */
export function surfaceIdentity(body: { readonly radius: number; readonly surface?: SurfaceDefinition }): string {
  // Asked for every coasting ship on every step: build the text once per immutable body.
  const cached = IDENTITIES.get(body);
  if (cached !== undefined) return cached;
  const identity = identityText(body);
  if (Object.isFrozen(body) && (!body.surface || Object.isFrozen(body.surface))) IDENTITIES.set(body, identity);
  return identity;
}
function identityText(body: { readonly radius: number; readonly surface?: SurfaceDefinition }): string {
  const s = body.surface;
  return JSON.stringify(s
    ? ['space-sim-surface/1', body.radius, s.kind, s.generatorVersion, s.seed, s.sampleCount,
      s.maxReliefMetres, s.minFeatureWidthMetres, s.orientationRadians, s.mountainRangeCount, s.craterCount,
      ...(s.seaRadiusMetres === undefined ? [] : [['seaRadiusMetres', s.seaRadiusMetres]]),
      ...(s.pads?.length ? [s.pads.map(p => [p.id, p.angleRadians, p.widthMetres, p.elevationMetres])] : [])]
    : ['space-sim-circle/1', body.radius]);
}

const TAU = 2 * Math.PI;
const wrap = (angle: number): number => {
  const remainder = angle % TAU;
  return remainder === 0 ? 0 : remainder < 0 ? remainder + TAU : remainder;
};
const angularDistance = (a: number, b: number): number => {
  const d = Math.abs(a - b);
  return Math.min(d, TAU - d);
};
const smooth = (t: number): number => t * t * (3 - 2 * t);
/** Compact quartic, full support width 2. */
const bump = (x: number): number => {
  if (Math.abs(x) >= 1) return 0;
  return (1 - x * x) ** 2;
};

function profileFromSamples(referenceRadius: number, orientationRadians: number, elevations: Float64Array,
  identity: string, features: readonly SurfaceFeature[] = [], pads: readonly SurfacePadDefinition[] = [], seaRadiusMetres?: number): SurfaceProfile {
  const count = elevations.length, delta = TAU / count;
  const minimum = new Float64Array(count), maximum = new Float64Array(count), derivative = new Float64Array(count);
  let minRadius = Infinity, maxRadius = 0, maxAbsDerivative = 0, maxSlope = 0;
  for (let i = 0; i < count; i++) {
    const a = elevations[i]!, b = elevations[(i + 1) % count]!;
    const low = referenceRadius + Math.min(a, b), high = referenceRadius + Math.max(a, b);
    const rate = Math.abs(b - a) / delta, slope = rate / low;
    if (!(low > 0) || ![low, high, rate, slope].every(Number.isFinite)) throw new Error('Surface samples must give finite positive radii and finite slopes');
    minimum[i] = low; maximum[i] = high; derivative[i] = rate;
    minRadius = Math.min(minRadius, low); maxRadius = Math.max(maxRadius, high);
    maxAbsDerivative = Math.max(maxAbsDerivative, rate); maxSlope = Math.max(maxSlope, slope);
  }
  const checkIndex = (index: number): void => {
    if (!Number.isInteger(index) || index < 0 || index >= count) throw new Error('Surface interval/sample index out of range');
  };
  const coastAngles: number[] = [];
  if (seaRadiusMetres !== undefined && minRadius < seaRadiusMetres) for (let i = 0; i < count; i++) {
    const a = referenceRadius + elevations[i]!, b = referenceRadius + elevations[(i + 1) % count]!;
    if ((a < seaRadiusMetres && b > seaRadiusMetres) || (a > seaRadiusMetres && b < seaRadiusMetres)) {
      coastAngles.push(wrap(orientationRadians + (i + (seaRadiusMetres - a) / (b - a)) * delta));
    } else if (a === seaRadiusMetres
      && (b < seaRadiusMetres || referenceRadius + elevations[(i + count - 1) % count]! < seaRadiusMetres)) {
      coastAngles.push(wrap(orientationRadians + i * delta));
    }
  }
  return Object.freeze({ identity, referenceRadius, orientationRadians, sampleCount: count,
    ...(seaRadiusMetres === undefined ? {} : { seaRadiusMetres }), coastAngles: Object.freeze(coastAngles.sort((a, b) => a - b)),
    hasWater: seaRadiusMetres !== undefined && minRadius < seaRadiusMetres,
    bounds: Object.freeze({ minRadius: Math.max(minRadius, seaRadiusMetres ?? 0),
      maxRadius: Math.max(maxRadius, seaRadiusMetres ?? 0), maxAbsDerivative, maxSlope }),
    features: Object.freeze(features.map(f => Object.freeze({ ...f }))),
    pads: Object.freeze(pads.map(p => Object.freeze({ ...p }))),
    storageBytes: 4 * elevations.byteLength,
    sampleElevation(index: number) { checkIndex(index); return elevations[index]!; },
    intervalBounds(index: number) {
      checkIndex(index);
      return Object.freeze({ minRadius: minimum[index]!, maxRadius: maximum[index]!,
        maxAbsDerivative: derivative[index]!, maxSlope: derivative[index]! / minimum[index]! });
    },
    copyElevations() { return elevations.slice(); },
  });
}

/** Independent hand-authored geometry, with its own full-data identity.
 * Sample limits apply; generated feature-width rules do not constrain fixtures. */
export function createSurfaceProfile(referenceRadius: number, samples: ArrayLike<number>, orientationRadians = 0, seaRadiusMetres?: number): SurfaceProfile {
  if (!Number.isFinite(referenceRadius) || referenceRadius <= 0) throw new Error('Surface reference radius must be finite and positive');
  if (!Number.isFinite(orientationRadians) || orientationRadians < 0 || orientationRadians >= TAU) throw new Error('Surface orientation must be in [0, 2*pi)');
  if (!Number.isInteger(samples.length) || samples.length < 2 || samples.length > SURFACE_LIMITS.maxSamples) throw new Error('Surface fixture needs 2–65536 samples');
  const elevations = Float64Array.from(samples);
  if (!elevations.every(Number.isFinite)) throw new Error('Surface elevations must be finite');
  if (seaRadiusMetres !== undefined && (!Number.isFinite(seaRadiusMetres) || seaRadiusMetres <= 0)) throw new Error('Sea radius must be finite and positive');
  return profileFromSamples(referenceRadius, orientationRadians, elevations,
    JSON.stringify(['space-sim-surface-fixture/1', referenceRadius, orientationRadians, ...elevations,
      ...(seaRadiusMetres === undefined ? [] : [['seaRadiusMetres', seaRadiusMetres]])]), [], [], seaRadiusMetres);
}

/** Authoritative linear POLAR interpolation and right-hand interval normal. */
export function querySurface(profile: SurfaceProfile, angleRadians: number): SurfaceQuery {
  if (!Number.isFinite(angleRadians)) throw new Error('Surface query angle must be finite');
  // Reduce first, so even finite angles near Number.MAX_VALUE cannot overflow.
  const theta = wrap(angleRadians);
  const local = wrap(theta - profile.orientationRadians), delta = TAU / profile.sampleCount;
  let u = local / delta;
  // Snap only representational roundoff at exact knots; retain right-hand normals.
  const nearest = Math.round(u);
  if (Math.abs(u - nearest) <= 8 * Number.EPSILON * profile.sampleCount) u = nearest;
  const whole = Math.floor(u), index = whole % profile.sampleCount, t = u - whole;
  const a = profile.sampleElevation(index), b = profile.sampleElevation((index + 1) % profile.sampleCount);
  const elevation = (1 - t) * a + t * b, radius = profile.referenceRadius + elevation;
  const slope = ((b - a) / delta) / radius;
  const length = dm.hypot(1, slope), radial = 1 / length, tangent = -slope / length;
  const x = dm.cos(theta), y = dm.sin(theta);
  const groundNormal = { x: radial * x - tangent * y, y: radial * y + tangent * x };
  const waterDepth = Math.max(0, (profile.seaRadiusMetres ?? 0) - radius);
  return { groundRadius: radius, firstContactRadius: Math.max(radius, profile.seaRadiusMetres ?? 0),
    waterDepth, elevation, intervalIndex: index, material: waterDepth > 0 ? 'water' : 'rock', groundNormal,
    normal: waterDepth > 0 ? { x, y } : groundNormal };
}

/** Version 1: Mulberry32 feature placement, periodic smooth value noise,
 * connected quartic ranges, additive bowls/rims/peaks, one global relief scale,
 * then level pads. Details and overlap rules are frozen in SURFACE_CONTRACT.md. */
export function generateSurface(body: { readonly radius: number; readonly surface?: SurfaceDefinition }): SurfaceProfile {
  const radius = body.radius;
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('Surface reference radius must be finite and positive');
  if (!body.surface) return profileFromSamples(radius, 0, new Float64Array(1), surfaceIdentity(body));
  const s = validateSurfaceDefinition(body.surface, radius);
  const elevations = new Float64Array(s.sampleCount), features: SurfaceFeature[] = [];
  let randomState = s.seed;
  const random = (): number => {
    randomState = (randomState + 0x6d2b79f5) >>> 0;
    let t = Math.imul(randomState ^ (randomState >>> 15), 1 | randomState);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hash = (index: number, salt: number): number => {
    let t = (index ^ s.seed ^ salt) >>> 0;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    return ((t ^ (t >>> 15)) >>> 0) / 4294967296 * 2 - 1;
  };
  const minAngle = s.minFeatureWidthMetres / radius;
  const cells = Math.max(1, Math.floor(TAU / minAngle));
  const noise = (phase: number, count: number, salt: number): number => {
    const u = phase * count, i = Math.floor(u), t = smooth(u - i);
    return (1 - t) * hash(i % count, salt) + t * hash((i + 1) % count, salt);
  };
  for (let i = 0; i < s.sampleCount; i++) {
    const phase = i / s.sampleCount;
    elevations[i] = .18 * noise(phase, Math.min(cells, 6), 0x12345678)
      + .07 * noise(phase, Math.min(cells, 128), 0x87654321);
  }
  for (let feature = 0; feature < s.mountainRangeCount; feature++) {
    const center = random() * TAU;
    const width = Math.min(TAU, Math.max(4 * minAngle, TAU * (.05 + .15 * random())));
    const height = .35 + .5 * random();
    features.push({ id: `range-${feature}`, kind: 'mountain-range', angleRadians: wrap(s.orientationRadians + center),
      widthMetres: width * radius, heightMetres: height });
    for (let i = 0; i < s.sampleCount; i++) {
      const d = angularDistance(i / s.sampleCount * TAU, center);
      if (d >= width / 2) continue;
      const ridge = .7 + .3 * noise(i / s.sampleCount, Math.min(cells, 32), feature);
      elevations[i] = elevations[i]! + height * bump(d / (width / 2)) * ridge;
    }
  }
  for (let feature = 0; feature < s.craterCount; feature++) {
    const center = random() * TAU;
    const bowl = Math.min(Math.PI, Math.max(2 * minAngle, TAU * (.006 + .024 * random())));
    const halfRim = Math.max(minAngle / 2, bowl / 4), peak = Math.max(minAngle / 2, bowl / 4);
    const depth = .45 + .5 * random(), peakHeight = random() < .4 ? .35 * depth : 0;
    features.push({ id: `crater-${feature}`, kind: 'crater', angleRadians: wrap(s.orientationRadians + center),
      bowlRadiusMetres: bowl * radius, rimWidthMetres: 2 * halfRim * radius,
      centralPeakWidthMetres: 2 * peak * radius, depthMetres: depth,
      rimHeightMetres: .28 * depth, centralPeakHeightMetres: peakHeight });
    for (let i = 0; i < s.sampleCount; i++) {
      const d = angularDistance(i / s.sampleCount * TAU, center);
      if (d >= Math.max(bowl + halfRim, peak)) continue;
      elevations[i] = elevations[i]! - depth * bump(d / bowl)
        + .28 * depth * bump((d - bowl) / halfRim) + peakHeight * bump(d / peak);
    }
  }
  let largest = 1;
  for (const elevation of elevations) largest = Math.max(largest, Math.abs(elevation));
  // Divide before multiplying: valid very large relief must not overflow.
  for (let i = 0; i < s.sampleCount; i++) elevations[i] = (elevations[i]! / largest) * s.maxReliefMetres;
  const scaledFeatures = features.map(f => f.kind === 'mountain-range'
    ? { ...f, heightMetres: f.heightMetres / largest * s.maxReliefMetres }
    : { ...f, depthMetres: f.depthMetres / largest * s.maxReliefMetres,
      rimHeightMetres: f.rimHeightMetres / largest * s.maxReliefMetres,
      centralPeakHeightMetres: f.centralPeakHeightMetres / largest * s.maxReliefMetres });
  for (const pad of s.pads ?? []) {
    const center = wrap(pad.angleRadians - s.orientationRadians);
    const halfWidth = pad.widthMetres / radius / 2 + TAU / s.sampleCount;
    for (let i = 0; i < s.sampleCount; i++) {
      const distance = angularDistance(i / s.sampleCount * TAU, center);
      if (distance >= halfWidth + minAngle) continue;
      const weight = smooth(Math.max(0, (distance - halfWidth) / minAngle));
      const blended = weight * elevations[i]! + (1 - weight) * pad.elevationMetres;
      elevations[i] = Math.max(-s.maxReliefMetres, Math.min(s.maxReliefMetres, blended));
    }
  }
  return profileFromSamples(radius, s.orientationRadians, elevations,
    surfaceIdentity({ radius, surface: s }), scaledFeatures, s.pads, s.seaRadiusMetres);
}
