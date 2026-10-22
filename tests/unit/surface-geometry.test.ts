import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import fixtures from '../fixtures/surfaces.json';
import golden from '../fixtures/surface-generator-v1.json';
import examples from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import {
  createSurfaceProfile, generateSurface, querySurface, surfaceIdentity, validateSurfaceDefinition,
  validateUniverse, loadSystem, type SurfaceDefinition,
} from '../../packages/sim-core/src/index';

const TAU = 2 * Math.PI;
const definition: SurfaceDefinition = {
  kind: 'radial', generatorVersion: 1, seed: 12345, sampleCount: 2048,
  maxReliefMetres: 24, minFeatureWidthMetres: 16, orientationRadians: 0,
  mountainRangeCount: 3, craterCount: 12,
};
const generate = (surface: SurfaceDefinition = definition, radius = 512) => generateSurface({ radius, surface });

describe('independent authoritative geometry fixtures', () => {
  it.each(fixtures.fixtures)('$id: interpolates radius and uses the outgoing normal', fixture => {
    const profile = createSurfaceProfile(fixture.referenceRadius, fixture.elevations, fixture.orientationRadians);
    for (const q of fixture.queries) {
      const actual = querySurface(profile, q.angle);
      expect(actual.groundRadius).toBeCloseTo(q.radius, 12);
      expect(actual.elevation).toBeCloseTo(q.radius - fixture.referenceRadius, 12);
      expect(actual.intervalIndex).toBe(q.interval);
      expect(actual.material).toBe('rock');
      const er = { x: Math.cos(q.angle), y: Math.sin(q.angle) };
      const dotRadial = actual.normal.x * er.x + actual.normal.y * er.y;
      const dotTangent = -actual.normal.x * er.y + actual.normal.y * er.x;
      expect(dotRadial).toBeGreaterThan(0);
      expect(dotTangent / dotRadial).toBeCloseTo(-q.derivative / q.radius, 12);
      expect(Math.hypot(actual.normal.x, actual.normal.y)).toBeCloseTo(1, 14);
    }
  });

  it('is polar interpolation, including the closing interval, rather than Cartesian chords', () => {
    const profile = createSurfaceProfile(10, [0, 0, -2, 4]);
    expect(querySurface(profile, Math.PI / 4).groundRadius).toBe(10); // chord would be sqrt(50)
    expect(querySurface(profile, -Math.PI / 4).groundRadius).toBeCloseTo(12, 13);
    expect(querySurface(profile, 0).groundRadius).toBe(10);
    expect(querySurface(profile, TAU).intervalIndex).toBe(0);
    expect(querySurface(profile, -TAU).intervalIndex).toBe(0);
    expect(querySurface(profile, 1e-8).groundRadius).toBeCloseTo(querySurface(profile, -1e-8).groundRadius, 6);
  });

  it('detaches fixture samples and returned data, and bounds sharp corners independently', () => {
    const samples = [0, 2, -2, 0], profile = createSurfaceProfile(10, samples);
    samples[1] = 100;
    profile.copyElevations()[1] = 100;
    expect(profile.sampleElevation(1)).toBe(2);
    expect(profile.bounds.minRadius).toBe(8);
    expect(profile.bounds.maxRadius).toBe(12);
    expect(profile.bounds.maxAbsDerivative).toBeCloseTo(8 / Math.PI, 14);
    expect(profile.bounds.maxSlope).toBeCloseTo(1 / Math.PI, 14);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.bounds)).toBe(true);
    expect(profile.storageBytes).toBe(128);
    expect(profile.identity).not.toBe(createSurfaceProfile(10, [0, 3, -2, 0]).identity);
    for (const i of [-1, 4, .5, NaN]) {
      expect(() => profile.sampleElevation(i)).toThrow('index');
      expect(() => profile.intervalBounds(i)).toThrow('index');
    }
  });

  it('rejects invalid fixtures and angles, and never returns NaN at extreme finite angles', () => {
    for (const elevations of [[], [0], [NaN, 0], [-10, 0], [Infinity, 0], Array(65537).fill(0)]) {
      expect(() => createSurfaceProfile(10, elevations)).toThrow();
    }
    expect(() => createSurfaceProfile(0, [0, 0])).toThrow();
    expect(() => createSurfaceProfile(10, [0, 0], TAU)).toThrow();
    const profile = createSurfaceProfile(10, [0, 2, -2, 0]);
    for (const angle of [NaN, Infinity, -Infinity]) expect(() => querySurface(profile, angle)).toThrow('finite');
    for (const angle of [Number.MAX_VALUE, -Number.MAX_VALUE]) {
      const q = querySurface(profile, angle);
      expect([q.groundRadius, q.normal.x, q.normal.y].every(Number.isFinite)).toBe(true);
    }
  });
});

describe('version 1 deterministic terrain', () => {
  it('preserves the frozen version 1 regression fixture', () => {
    const p = generateSurface({ radius: golden.referenceRadius,
      surface: validateSurfaceDefinition(golden.configuration, golden.referenceRadius) });
    const bytes = new Uint8Array(p.sampleCount * 8), view = new DataView(bytes.buffer);
    for (let i = 0; i < p.sampleCount; i++) view.setFloat64(i * 8, p.sampleElevation(i), true);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(golden.elevationsFloat64LESha256);
    for (const sample of golden.samples) expect(p.sampleElevation(sample.index)).toBe(sample.elevation);
    expect(p.bounds).toEqual(golden.bounds);
    for (const feature of golden.features) expect(p.features.find(f => f.id === feature.id)).toEqual(feature);
  });

  it('reproduces full profiles, metadata and identities; seed and orientation have defined effects', () => {
    const a = generate(), b = generate();
    expect(a.copyElevations()).toEqual(b.copyElevations());
    expect(a.features).toEqual(b.features);
    expect(a.identity).toBe(surfaceIdentity({ radius: 512, surface: definition }));
    expect(generate({ ...definition, seed: 0 }).copyElevations()).not.toEqual(a.copyElevations());
    expect(generate({ ...definition, seed: 0 }).copyElevations()).toEqual(generate({ ...definition, seed: 0 }).copyElevations());
    const rotated = generate({ ...definition, orientationRadians: .61 });
    expect(rotated.copyElevations()).toEqual(a.copyElevations());
    expect(rotated.identity).not.toBe(a.identity);
    for (const angle of [0, .1, 3, 6.2]) {
      const q = querySurface(a, angle), r = querySurface(rotated, angle + .61);
      expect(r.groundRadius).toBeCloseTo(q.groundRadius, 10);
      expect(r.normal.x).toBeCloseTo(q.normal.x * Math.cos(.61) - q.normal.y * Math.sin(.61), 10);
    }
    expect(a.features.filter(f => f.kind === 'mountain-range')).toHaveLength(3);
    expect(a.features.filter(f => f.kind === 'crater')).toHaveLength(12);
    expect(new Set(a.features.map(f => f.id)).size).toBe(a.features.length);
    expect(Object.isFrozen(a.features[0])).toBe(true);
  });

  it('has exactly periodic samples, outgoing knot normals and conservative bounds everywhere', () => {
    const p = generate({ ...definition, orientationRadians: .3 });
    for (let i = 0; i < p.sampleCount; i++) {
      const a = p.sampleElevation(i), b = p.sampleElevation((i + 1) % p.sampleCount);
      const interval = p.intervalBounds(i), angle = .3 + i * TAU / p.sampleCount;
      expect(Math.abs(a)).toBeLessThanOrEqual(definition.maxReliefMetres);
      expect(querySurface(p, angle).intervalIndex).toBe(i);
      expect(querySurface(p, angle).elevation).toBeCloseTo(a, 10);
      expect(interval.minRadius).toBe(512 + Math.min(a, b));
      expect(interval.maxRadius).toBe(512 + Math.max(a, b));
      expect(interval.maxAbsDerivative).toBe(Math.abs(b - a) / (TAU / p.sampleCount));
      expect(interval.maxSlope).toBeLessThanOrEqual(p.bounds.maxSlope);
      for (const t of [.17, .5, .91]) {
        const q = querySurface(p, angle + t * TAU / p.sampleCount);
        expect(q.groundRadius).toBeGreaterThanOrEqual(interval.minRadius);
        expect(q.groundRadius).toBeLessThanOrEqual(interval.maxRadius);
        expect(Math.hypot(q.normal.x, q.normal.y)).toBeCloseTo(1, 13);
        const h = 1e-8, r = q.groundRadius;
        const derivative = (querySurface(p, angle + t * TAU / p.sampleCount + h).groundRadius
          - querySurface(p, angle + t * TAU / p.sampleCount - h).groundRadius) / (2 * h);
        const theta = angle + t * TAU / p.sampleCount;
        const tx = derivative * Math.cos(theta) - r * Math.sin(theta);
        const ty = derivative * Math.sin(theta) + r * Math.cos(theta);
        expect(Math.abs((tx * q.normal.x + ty * q.normal.y) / Math.hypot(tx, ty))).toBeLessThan(1e-7);
      }
    }
    expect(querySurface(p, .3).elevation).toBe(querySurface(p, .3 + TAU).elevation);
    expect(querySurface(p, .3).elevation).toBe(querySurface(p, .3 - TAU).elevation);
    expect(p.storageBytes).toBe(p.sampleCount * 32);
  });

  it('forms crater bowls, positive rims and optional smaller central peaks', () => {
    const single = { ...definition, sampleCount: 16384, mountainRangeCount: 0, craterCount: 1, minFeatureWidthMetres: 2 };
    const p = generate(single), crater = p.features[0]!;
    expect(crater.kind).toBe('crater');
    if (crater.kind !== 'crater') throw new Error('Missing crater');
    const baseline = generate({ ...single, craterCount: 0 });
    const reliefAt = (offset: number) => querySurface(p, crater.angleRadians + offset).elevation
      - querySurface(baseline, crater.angleRadians + offset).elevation;
    expect(reliefAt(0)).toBeLessThan(-crater.depthMetres * .5);
    expect(reliefAt(crater.bowlRadiusMetres / 512)).toBeCloseTo(crater.rimHeightMetres, 2);
    expect(reliefAt(-crater.bowlRadiusMetres / 512)).toBeCloseTo(crater.rimHeightMetres, 2);
    expect(reliefAt((crater.bowlRadiusMetres + crater.rimWidthMetres) / 512)).toBeCloseTo(0, 12);
    expect(crater.rimWidthMetres).toBeGreaterThanOrEqual(single.minFeatureWidthMetres);
    expect(crater.centralPeakWidthMetres).toBeGreaterThanOrEqual(single.minFeatureWidthMetres);
    const both = [p, generate({ ...single, seed: 0 }), generate({ ...single, seed: 1 })];
    const peaks = both.flatMap(profile => profile.features.filter(f => f.kind === 'crater').map(f => f.centralPeakHeightMetres));
    expect(peaks.some(h => h > 0)).toBe(true);
    expect(peaks.some(h => h === 0)).toBe(true);
    for (const profile of both) for (const feature of profile.features) {
      if (feature.kind !== 'crater' || feature.centralPeakHeightMetres === 0) continue;
      const peakRadius = feature.centralPeakWidthMetres / 2 / 512;
      const center = querySurface(profile, feature.angleRadians).elevation;
      const leftFloor = querySurface(profile, feature.angleRadians - peakRadius).elevation;
      const rightFloor = querySurface(profile, feature.angleRadians + peakRadius).elevation;
      expect(center).toBeGreaterThan(leftFloor);
      expect(center).toBeGreaterThan(rightFloor);
    }
  });

  it('adds overlapping crater components before a single global relief scaling', () => {
    const settings = { ...definition, seed: 1, minFeatureWidthMetres: 512, mountainRangeCount: 0, craterCount: 1 };
    const one = generate(settings), two = generate({ ...settings, craterCount: 2 });
    const a = one.features[0]!, b = two.features[0]!, added = two.features[1]!;
    if (a.kind !== 'crater' || b.kind !== 'crater' || added.kind !== 'crater') throw new Error('Missing crater');
    const scale = b.depthMetres / a.depthMetres;
    const quartic = (x: number) => Math.abs(x) >= 1 ? 0 : (1 - x * x) ** 2;
    let overlapSamples = 0;
    for (let i = 0; i < one.sampleCount; i++) {
      const angle = i * TAU / one.sampleCount;
      const delta = Math.abs(angle - added.angleRadians);
      const d = Math.min(delta, TAU - delta) * 512;
      const expected = -added.depthMetres * quartic(d / added.bowlRadiusMetres)
        + added.rimHeightMetres * quartic((d - added.bowlRadiusMetres) / (added.rimWidthMetres / 2))
        + added.centralPeakHeightMetres * quartic(d / (added.centralPeakWidthMetres / 2));
      expect(two.sampleElevation(i) - one.sampleElevation(i) * scale).toBeCloseTo(expected, 11);
      const firstDelta = Math.abs(angle - a.angleRadians);
      if (d < added.bowlRadiusMetres && Math.min(firstDelta, TAU - firstDelta) * 512 < a.bowlRadiusMetres) overlapSamples++;
    }
    expect(overlapSamples).toBeGreaterThan(0);
  });

  it('preserves terrain shape when all world lengths scale, and handles zero relief and circles', () => {
    const p = generate(), scale = 12000;
    const large = generate({ ...definition, maxReliefMetres: 24 * scale, minFeatureWidthMetres: 16 * scale }, 512 * scale);
    for (let i = 0; i < p.sampleCount; i++) expect(large.sampleElevation(i) / scale).toBeCloseTo(p.sampleElevation(i), 11);
    const flat = generate({ ...definition, maxReliefMetres: 0 });
    expect(flat.bounds).toEqual({ minRadius: 512, maxRadius: 512, maxAbsDerivative: 0, maxSlope: 0 });
    const circle = generateSurface({ radius: 160 });
    expect(circle.identity).toBe(surfaceIdentity({ radius: 160 }));
    expect(circle.features).toEqual([]);
    expect(circle.sampleCount).toBe(1);
    expect(querySurface(circle, .7).groundRadius).toBe(160);
    expect(querySurface(circle, .7).normal.x).toBeCloseTo(Math.cos(.7), 14);
    expect(() => generateSurface({ radius: Infinity })).toThrow();
    expect(() => generate({ ...definition, generatorVersion: 2 } as unknown as SurfaceDefinition)).toThrow('generatorVersion');
  });

  it('supports minimum/maximum resolution, widest features and maximum feature counts within relief bounds', () => {
    for (const settings of [
      { ...definition, sampleCount: 32, minFeatureWidthMetres: TAU * 512, seed: 0xffff_ffff },
      { ...definition, sampleCount: 65536, mountainRangeCount: 256, craterCount: 4096, minFeatureWidthMetres: 4 * (TAU * 512 / 65536) },
    ]) {
      const p = generate(settings);
      expect(p.sampleCount).toBe(settings.sampleCount);
      expect(p.features).toHaveLength(settings.mountainRangeCount + settings.craterCount);
      expect(p.bounds.minRadius).toBeGreaterThanOrEqual(512 - settings.maxReliefMetres);
      expect(p.bounds.maxRadius).toBeLessThanOrEqual(512 + settings.maxReliefMetres);
      expect(Object.values(p.bounds).every(Number.isFinite)).toBe(true);
    }
  // Generates maximum-resolution terrain; slow when the whole suite shares a busy CPU.
  }, 15_000);

  it('loads the fixed moon and dry planet examples with safe survey orbits', () => {
    const universe = validateUniverse(examples);
    for (const system of universe.systems) {
      const loaded = loadSystem(universe, system.id), body = loaded.rootBody;
      const p = generateSurface(body);
      const legacy = body.surface;
      expect(legacy?.generatorVersion).toBe(1);
      if (legacy?.generatorVersion !== 1) throw Error('Expected frozen v1 fixture');
      expect(p.features).toHaveLength(legacy.mountainRangeCount + legacy.craterCount);
      expect(p.bounds.maxRadius).toBeGreaterThan(p.bounds.minRadius);
      expect(loaded.initialState('orbit').state.position.y).toBeGreaterThan(p.bounds.maxRadius);
    }
  });
});

describe('authoritative level pads', () => {
  const pad = { id: 'test-pad', angleRadians: .01, widthMetres: 32, elevationMetres: 7 };
  const settings = { ...definition, orientationRadians: .3, pads: [pad] };

  it('flattens the requested width across the seam, with level normals, bounded shoulders and full identity', () => {
    const p = generate(settings);
    for (let i = -100; i <= 100; i++) {
      const angle = pad.angleRadians + i / 100 * pad.widthMetres / 512 / 2;
      const q = querySurface(p, angle);
      expect(q.elevation).toBeCloseTo(7, 13);
      expect(q.normal.x).toBeCloseTo(Math.cos(angle), 13);
      expect(q.normal.y).toBeCloseTo(Math.sin(angle), 13);
    }
    const original = generate({ ...settings, pads: undefined });
    const outside = pad.angleRadians + (pad.widthMetres / 2 + definition.minFeatureWidthMetres + 4 * TAU * 512 / definition.sampleCount) / 512;
    expect(querySurface(p, outside)).toEqual(querySurface(original, outside));
    expect(p.bounds.minRadius).toBeGreaterThanOrEqual(512 - definition.maxReliefMetres);
    expect(p.bounds.maxRadius).toBeLessThanOrEqual(512 + definition.maxReliefMetres);
    expect(p.identity).not.toBe(original.identity);
    for (const changed of [{ ...pad, id: 'different' }, { ...pad, angleRadians: .02 }, { ...pad, widthMetres: 40 }, { ...pad, elevationMetres: 8 }]) {
      expect(generate({ ...settings, pads: [changed] }).identity).not.toBe(p.identity);
    }
    expect(generate({ ...definition, pads: [] }).identity).toBe(generate().identity);
    expect(p.features).toEqual(original.features);
    expect(Object.isFrozen(p.pads[0])).toBe(true);
  });

  it('round-trips and detaches settings; rejects bad fields, resource excess and overlapping shoulders', () => {
    const validated = validateSurfaceDefinition(settings, 512);
    expect(validated).toEqual(JSON.parse(JSON.stringify(settings)));
    expect(Object.isFrozen(validated.pads)).toBe(true);
    expect(Object.isFrozen(validated.pads![0])).toBe(true);
    for (const pads of [null, {}, Array(65).fill(pad), [null], [{ ...pad, id: '' }],
      [{ ...pad, sea: 1 }], [{ ...pad, widthMetres: 1 }], [{ ...pad, widthMetres: TAU * 512 }],
      [{ ...pad, angleRadians: TAU }], [{ ...pad, elevationMetres: 25 }], [{ ...pad, elevationMetres: Infinity }],
      [pad, pad], [pad, { ...pad, id: 'near-seam', angleRadians: TAU - .01 }],
    ]) expect(() => validateSurfaceDefinition({ ...definition, pads }, 512)).toThrow(/pad/i);
    expect(() => validateSurfaceDefinition({ ...definition, pads: [pad, { ...pad, id: 'other', angleRadians: Math.PI }] }, 512)).not.toThrow();
    const raw = structuredClone(examples);
    const before = validateUniverse(raw);
    expect(validateUniverse(JSON.parse(JSON.stringify(before)))).toEqual(before);
    const body = raw.systems[0]!.bodies[0]!;
    const originalPad = ('pads' in body.surface ? body.surface.pads : undefined)![0]!;
    const active = loadSystem(before).rootBody.surface!;
    originalPad.elevationMetres = 9;
    expect(active.pads![0]!.elevationMetres).toBe(8);
    // Pads count against the existing aggregate feature budget too.
    const system = before.systems[0]!;
    const budget = { ...before, systems: [{ ...system, bodies: Array.from({ length: 4 }, (_, i) => ({
      ...system.bodies[0]!, id: `b${i}`, surface: { ...settings, mountainRangeCount: 0, craterCount: 4096 },
    })), presets: [{ id: 'pad', bodyId: 'b0', kind: 'landed' }] }] };
    expect(() => validateUniverse(budget)).toThrow('surface budget');
  });
});
