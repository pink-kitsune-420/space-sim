import { describe, expect, it } from 'vitest';
import { advanceSandboxFrame, sustainableWarp } from '../../apps/orbit-sandbox/src/simulation-clock';
import { createDefaultSolarSystem, instantiateBody } from '../../apps/orbit-sandbox/src/presets';
import { DEFAULT_FULL_BODY_OPTIONS, stepSimulation } from '../../apps/orbit-sandbox/src/physics';

describe('bounded sandbox warp', () => {
  it('stops on its CPU budget, advances only integrated time and records one trail per frame', () => {
    const bodies = createDefaultSolarSystem(); let clock = 0;
    const before = bodies[1]!.trail.length;
    const result = advanceSandboxFrame(bodies, 'full-body', 1 / 60, 100000, DEFAULT_FULL_BODY_OPTIONS, false, () => clock += 3);
    expect(result.limited).toBe(true); expect(result.steps).toBe(3);
    expect(result.simulatedSeconds).toBeCloseTo(.6, 12);
    expect(result.simulatedSeconds).toBeLessThan(result.requestedSeconds);
    expect(bodies[1]!.trail.length).toBe(before + 1);
  });

  it('debug mode bypasses the CPU budget while keeping numerical steps bounded', () => {
    const bodies = createDefaultSolarSystem();
    const result = advanceSandboxFrame(bodies, 'full-body', .01, 1000, DEFAULT_FULL_BODY_OPTIONS, true, () => { throw new Error('CPU budget was sampled'); });
    expect(result.limited).toBe(false); expect(result.simulatedSeconds).toBe(10);
    expect(result.steps).toBeGreaterThanOrEqual(50);
  });

  it('resolves an approaching fast body instead of skipping through the collision at high warp', () => {
    const bodies = [
      instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { radius: 100, mu: 100, isFixed: true }),
      instantiateBody('rocky', { x: -2000, y: 0 }, { x: 10000, y: 0 }, { radius: 100, mu: 1 }),
    ];
    const result = advanceSandboxFrame(bodies, 'full-body', .01, 50, DEFAULT_FULL_BODY_OPTIONS, true);
    expect(result.limited).toBe(false); expect(bodies).toHaveLength(1);
  });

  it('keeps accelerated orbital motion close to a fine-step reference', () => {
    const bodies = [
      instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }, { id: 'primary', radius: 100, mu: 1e7, isFixed: true }),
      instantiateBody('rocky', { x: 4000, y: 0 }, { x: 0, y: 50 }, { id: 'orbiter', radius: 10, mu: .01 }),
    ];
    const reference = structuredClone(bodies);
    const result = advanceSandboxFrame(bodies, 'nbody', .01, 10000, DEFAULT_FULL_BODY_OPTIONS, true);
    stepSimulation(reference, 'nbody', 100, 5000);
    expect(result.simulatedSeconds).toBe(100);
    expect(Math.hypot(bodies[1]!.position.x - reference[1]!.position.x, bodies[1]!.position.y - reference[1]!.position.y)).toBeLessThan(1);
  });

  it('chooses a lower sustainable factor with headroom and never raises warp', () => {
    expect(sustainableWarp(10000, 200, .5)).toBe(200);
    expect(sustainableWarp(50, 20, .5)).toBe(20);
    expect(sustainableWarp(1, 0, .5)).toBe(.2);
    expect(sustainableWarp(.2, 10, .5)).toBe(.2);
    expect(advanceSandboxFrame([], 'nbody', 0, 100000, DEFAULT_FULL_BODY_OPTIONS).steps).toBe(0);
  });
});
