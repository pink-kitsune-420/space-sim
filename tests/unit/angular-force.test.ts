import { describe, expect, it } from 'vitest';
import type { Body, ForceExtension, ForceHook, State } from '../../packages/game-api/src/index';
import { createSimulationContext, initialState } from '../../packages/sim-core/src/context';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { shipFromSaved, shipToSaved } from '../../packages/sim-core/src/save';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';

const hookOf = (evaluate: ForceHook['evaluate']): ForceExtension => ({ moduleId: 'test.torque', version: '0.1.0',
  hook: { modelIdentity: 'torque/v1', initialState: { version: 1, value: 0 }, evaluate } });
const smallBody: Body = { id: 'tiny', radius: 1, mu: 1e-30 };
const free: State = { ...initialState(), status: 'flying', position: { x: 0, y: 1000 }, velocity: { x: 0, y: 1 }, time: 1, heading: 0 };

describe('generalized force: angular acceleration', () => {
  it('integrates constant torque into rotation rate and heading (KDK)', () => {
    const alpha = 2;
    const context = createSimulationContext({}, { forces: [hookOf(() => ({ x: 0, y: 0, angularAcceleration: alpha }))] });
    let s = free;
    for (let i = 0; i < 100; i++) s = context.advance(s, IDLE, STEP, smallBody);
    expect(s.angularVelocity).toBeCloseTo(alpha * 1, 9);
    expect(s.heading).toBeCloseTo(.5 * alpha * 1, 9);
  });

  it('keeps coasting rotation without further torque', () => {
    const context = createSimulationContext({}, { forces: [hookOf(() => ({ x: 0, y: 0 }))] });
    const s = context.advance({ ...free, angularVelocity: 1 }, IDLE, STEP, smallBody);
    expect(s.angularVelocity).toBe(1);
    expect(s.heading).toBeCloseTo(.01, 12);
  });

  it('passes stage heading and rotation rate to the hook', () => {
    const seen: number[][] = [];
    const context = createSimulationContext({}, { forces: [hookOf(i => { seen.push([i.heading, i.angularVelocity]); return { x: 0, y: 0, angularAcceleration: 1 }; })] });
    context.advance({ ...free, angularVelocity: 1 }, IDLE, STEP, smallBody);
    expect(seen[0]).toEqual([0, 1]);
    expect(seen[1]![1]).toBeCloseTo(1.005, 12);
  });

  it('adds no angularVelocity field for plain Vec hooks', () => {
    const plain = createSimulationContext({}, { forces: [hookOf(() => ({ x: 4, y: 0 }))] });
    expect('angularVelocity' in plain.advance(free, IDLE, STEP, smallBody)).toBe(false);
  });

  it('rejects non-finite or out-of-range angular acceleration', () => {
    for (const bad of [NaN, Infinity, 1001]) {
      const context = createSimulationContext({}, { forces: [hookOf(() => ({ x: 0, y: 0, angularAcceleration: bad }))] });
      expect(() => context.advance(free, IDLE, STEP, smallBody)).toThrow('angularAcceleration');
    }
  });

  it('round-trips angularVelocity through a saved ship', () => {
    const world = new World(DEFAULT_UNIVERSE, { soloPreview: false });
    const ship = world.spawn({ ownerId: 'p1' });
    const spinning = { ...ship, state: { ...ship.state, angularVelocity: 1.5 } };
    const saved = shipToSaved(spinning);
    expect(saved.angularVelocity).toBe(1.5);
    expect(shipFromSaved(world, JSON.parse(JSON.stringify(saved))).state.angularVelocity).toBe(1.5);
    expect('angularVelocity' in shipToSaved(ship)).toBe(false);
  });
});
