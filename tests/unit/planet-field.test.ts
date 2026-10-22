import { describe, expect, it } from 'vitest';
import { createPlanetField } from '../../packages/game-api/src/planet-field/field';
import { validatePlanetField, type PlanetFieldDefinition } from '../../packages/game-api/src/planet-field/definition';
import { noise3, fractal3, fractalSlopeBound, NOISE_GRADIENT_BOUND } from '../../packages/game-api/src/planet-field/noise';
import * as dm from '../../packages/game-api/src/math';
import golden from '../fixtures/planet-field-v2.json';

const definition: PlanetFieldDefinition = { generatorVersion: 2, seed: 741, recipe: 'oceanic', radiusMetres: 2048,
  maxReliefMetres: 48, continentWavelengthMetres: 1100, rangeWavelengthMetres: 280, hillWavelengthMetres: 80, octaves: 4 };
const recipes = ['oceanic', 'rocky', 'arid', 'icy', 'volcanic'] as const;

describe('F9 deterministic headless field foundation', () => {
  it('preserves exact float64 golden samples qualified independently on V8, SpiderMonkey and JavaScriptCore', () => {
    const out = new Float64Array(8);
    for (const row of golden.rows) {
      const field = createPlanetField(row.definition as PlanetFieldDefinition);
      expect(field.identity).toBe(row.identity);
      for (let i = 0; i < golden.points.length; i++) {
        const p = golden.points[i]!;
        field.evaluate(p[0]!, p[1]!, p[2]!, out);
        expect(Array.from(out)).toEqual(row.values[i]);
      }
    }
  });

  it('checks analytic noise and all fractal gradients against independent symmetric differences', () => {
    const out = new Float64Array(4), lo = new Float64Array(4), hi = new Float64Array(4), e = 1e-6;
    for (const mode of ['noise', 'fbm', 'ridge', 'billow'] as const) for (let i = 0; i < 113; i++) {
      const p = [i * .137 + .027, -i * .093 - .417, i * .177 + .133];
      const sample = (v: number[], o: Float64Array) => mode === 'noise' ? noise3(12345, v[0]!, v[1]!, v[2]!, o)
        : fractal3(12345, v[0]!, v[1]!, v[2]!, 1.3, 4, mode, o);
      sample(p, out);
      expect(Math.abs(out[0]!)).toBeLessThanOrEqual(1);
      expect(Math.hypot(out[1]!, out[2]!, out[3]!)).toBeLessThanOrEqual(mode === 'noise' ? NOISE_GRADIENT_BOUND : fractalSlopeBound(1.3, 4, mode));
      for (let axis = 0; axis < 3; axis++) {
        const a = [...p], b = [...p]; a[axis] = a[axis]! - e; b[axis] = b[axis]! + e;
        sample(a, lo); sample(b, hi);
        expect(out[axis + 1]).toBeCloseTo((hi[0]! - lo[0]!) / (2 * e), 6);
      }
    }
  });

  it('is continuous with continuous noise gradients across integer cells and negative coordinates', () => {
    const a = new Float64Array(4), b = new Float64Array(4);
    for (let axis = 0; axis < 3; axis++) for (let knot = -8; knot <= 8; knot++) {
      const p = [.223, -.412, .719], q = [...p]; p[axis] = knot - 1e-8; q[axis] = knot + 1e-8;
      noise3(0xffffffff, p[0]!, p[1]!, p[2]!, a); noise3(0xffffffff, q[0]!, q[1]!, q[2]!, b);
      for (let c = 0; c < 4; c++) expect(Math.abs(a[c]! - b[c]!)).toBeLessThan(2e-7);
    }
  });

  it('differentiates the warped continent and tectonic product through independent sphere arcs', () => {
    const out = new Float64Array(8), a = new Float64Array(8), b = new Float64Array(8), e = 1e-7;
    for (const recipe of recipes) {
      const field = createPlanetField({ ...definition, recipe });
      for (let i = 0; i < 73; i++) {
        const angle = i * .071 + .113, latitude = i * .031 - 1;
        const x = dm.cos(angle) * dm.cos(latitude), y = dm.sin(angle) * dm.cos(latitude), z = dm.sin(latitude);
        field.evaluate(x, y, z, out);
        field.evaluate(dm.cos(angle - e) * dm.cos(latitude), dm.sin(angle - e) * dm.cos(latitude), z, a);
        field.evaluate(dm.cos(angle + e) * dm.cos(latitude), dm.sin(angle + e) * dm.cos(latitude), z, b);
        const expected = -y * out[1]! + x * out[2]!;
        expect(expected).toBeCloseTo((b[0]! - a[0]!) / (2 * e), 4);
      }
    }
  });

  it('bounds elevations and Cartesian gradients over dense independent equal-area sphere samples', () => {
    const out = new Float64Array(8);
    for (const recipe of recipes) for (const seed of [0, 741, 0xffffffff]) {
      const field = createPlanetField({ ...definition, seed, recipe });
      let maxHeight = 0, maxGradient = 0;
      for (let i = 0; i < 16384; i++) {
        const z = 1 - 2 * (i + .5) / 16384, r = Math.sqrt(1 - z * z), a = i * 2.399963229728653;
        field.evaluate(dm.cos(a) * r, dm.sin(a) * r, z, out);
        maxHeight = Math.max(maxHeight, Math.abs(out[0]!)); maxGradient = Math.max(maxGradient, Math.hypot(out[1]!, out[2]!, out[3]!));
        for (let c = 4; c < 8; c++) if (out[c]! < 0 || out[c]! > 1) throw Error('Attribute outside unit interval');
      }
      expect(maxHeight).toBeLessThanOrEqual(field.bounds.maxAbsElevationMetres);
      expect(maxGradient).toBeLessThanOrEqual(field.bounds.maxGradientMetres);
    }
  }, 20000);

  it('has no longitude or polar seam and retains metre detail at Earth scale', () => {
    const field = createPlanetField({ ...definition, radiusMetres: 6371000, maxReliefMetres: 1000,
      continentWavelengthMetres: 3000000, rangeWavelengthMetres: 10000, hillWavelengthMetres: .5, octaves: 2 });
    const a = new Float64Array(8), b = new Float64Array(8), c = new Float64Array(8), e = 1e-12;
    field.evaluate(dm.cos(e), dm.sin(e), 0, a); field.evaluate(dm.cos(-e), dm.sin(-e), 0, b);
    expect(Math.abs(a[0]! - b[0]!)).toBeLessThan(field.bounds.maxGradientMetres * 2 * e);
    for (const sign of [-1, 1]) {
      field.evaluate(e, 0, sign * Math.sqrt(1 - e * e), a); field.evaluate(-e, 0, sign * Math.sqrt(1 - e * e), b);
      expect(Math.abs(a[0]! - b[0]!)).toBeLessThanOrEqual(field.bounds.maxGradientMetres * 2 * e);
    }
    const step = .1 / 6371000;
    field.evaluate(1, 0, 0, a); field.evaluate(dm.cos(step), dm.sin(step), 0, b); field.evaluate(dm.cos(2 * step), dm.sin(2 * step), 0, c);
    expect(a[0]).not.toBe(b[0]); expect(b[0]).not.toBe(c[0]);
    expect(Number.isFinite(c[0]!)).toBe(true);
  });

  it('detaches configuration, includes every parameter in identity and uses caller output', () => {
    const raw = { ...definition }, f = createPlanetField(raw), g = createPlanetField({ ...definition });
    const a = new Float64Array(8), b = new Float64Array(8); raw.seed = 2;
    expect(f.definition.seed).toBe(741); expect(Object.isFrozen(f.definition)).toBe(true);
    f.evaluate(1, 0, 0, a); g.evaluate(1, 0, 0, b); expect(a).toEqual(b); expect(f.identity).toBe(g.identity);
    expect(createPlanetField({ ...definition, seed: 2 }).identity).not.toBe(f.identity);
    expect(createPlanetField({ ...definition, waterCoverage: .7 }).identity).not.toBe(f.identity);
    for (let i = 0; i < 100; i++) { f.evaluate(1, 0, 0, b); expect(b).toEqual(a); }
    expect(() => f.evaluate(0, 0, 0, a)).toThrow('unit-sphere');
    expect(() => f.evaluate(1, 0, 0, new Float64Array(7))).toThrow('eight');
  });

  it.each([null, [], { ...definition, bad: 1 }, { ...definition, generatorVersion: 1 },
    { ...definition, seed: -1 }, { ...definition, octaves: 9 }, { ...definition, recipe: 'unknown' }, { ...definition, recipe: new String('rocky') },
    { ...definition, radiusMetres: Infinity }, { ...definition, maxReliefMetres: 2048 },
    { ...definition, hillWavelengthMetres: 1e-20 }, { ...definition, waterCoverage: 1.1 },
    { ...definition, waterCoverage: .5, seaRadiusMetres: 2048 }])('rejects invalid bounded definitions (%#)', raw => {
    expect(() => validatePlanetField(raw)).toThrow();
  });
});
