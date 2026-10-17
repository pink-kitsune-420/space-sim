import { describe, expect, it } from 'vitest';
import terrain from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import { DEFAULT_UNIVERSE, loadSystem, validateUniverse } from '../../packages/sim-core/src/index';
import { appearanceUniforms, STYLE_INDEX } from '../../packages/render-2d/src/appearance';

/** The terrain example's first body with `appearance` set (or removed when undefined). */
function withAppearance(appearance: unknown, features?: string) {
  const raw = structuredClone(terrain) as { systems: { bodies: Record<string, unknown>[] }[] };
  const body = raw.systems[0]!.bodies[0]!;
  if (appearance !== undefined) body.appearance = appearance;
  if (features) body.surfaceFeatures = features;
  return raw;
}

describe('body appearance', () => {
  it('derives a full look from the legacy style and colours when none is authored', () => {
    const body = loadSystem(validateUniverse(withAppearance(undefined))).rootBody;
    expect(body.appearance.style).toBe('hazy'); // surfaceFeatures "smooth"
    expect(body.appearance.colors).toHaveLength(4);
    expect(body.appearance.colors[0]).toBe('#a87954');
  });

  it('keeps authored colours, fills the rest by role and always draws stars as stars', () => {
    const body = loadSystem(validateUniverse(withAppearance({ style: 'oceanic', colors: ['#112233'], water: .8, seed: 12 }))).rootBody;
    expect(body.appearance).toMatchObject({ style: 'oceanic', water: .8, seed: 12 });
    expect(body.appearance.colors).toEqual(['#112233', '#4f7d3a', '#c2a46a', '#eef3f6']);
    const lumen = loadSystem(DEFAULT_UNIVERSE).getResolvedBody('star');
    expect(lumen.appearance.style).toBe('star');
  });

  it('rejects malformed looks', () => {
    for (const bad of [{ style: 'plaid' }, { style: 'rocky', colors: ['red'] }, { style: 'rocky', colors: Array(5).fill('#000000') },
      { style: 'rocky', water: 2 }, { style: 'rocky', seed: -1 }, 'rocky']) {
      expect(() => validateUniverse(withAppearance(bad))).toThrow(/appearance/);
    }
  });

  it('gives the shader its style, tuning defaults, a stable seed and an average colour', () => {
    const primus = loadSystem(DEFAULT_UNIVERSE).getResolvedBody('planet');
    const u = appearanceUniforms({ id: 'planet', name: 'Primus', position: { x: 0, y: 0 }, radius: 512, appearance: primus.appearance })!;
    expect(u.style).toBe(STYLE_INDEX.oceanic);
    expect(u.tune).toEqual([.5, .5, .5, .5, .5, .5]);
    const again = appearanceUniforms({ id: 'planet', name: 'Primus', position: { x: 0, y: 0 }, radius: 512, appearance: { ...primus.appearance } })!;
    expect(again.seed).toBe(u.seed);
    expect(appearanceUniforms({ id: 'planet', name: 'Primus', position: { x: 0, y: 0 }, radius: 512,
      appearance: { ...primus.appearance, seed: 42 } })!.seed).toBe(42);
    for (const k of u.mean) expect(k).toBeGreaterThan(0);
    expect(appearanceUniforms({ id: 'x', name: 'X', position: { x: 0, y: 0 }, radius: 1 })).toBeUndefined();
  });
});
