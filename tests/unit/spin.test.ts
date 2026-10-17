import { describe, expect, it } from 'vitest';
import terrain from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import {
  DEFAULT_UNIVERSE, IDLE, inertialPosition, inertialState, spinAngle, spinRate, validateUniverse,
  type Controls, type UniverseDefinition,
} from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };

/** The terrain example's rugged planet, spinning once every `period` seconds. */
function spinningTerrain(period = 600): UniverseDefinition {
  const raw = structuredClone(terrain) as { systems: { bodies: Record<string, unknown>[] }[] };
  raw.systems[0]!.bodies[0]!.rotation = { period };
  return validateUniverse(raw);
}

/** Burn straight up from the pad for `burnSteps`, then coast until the ship rests again. */
function hop(world: World, shipId: string, burnSteps: number): void {
  world.setControls(shipId, BURN);
  for (let i = 0; i < burnSteps; i++) world.step();
  world.setControls(shipId, IDLE);
  for (let i = 0; i < 100_000 && world.ship(shipId)!.state.status === 'flying'; i++) world.step();
}

describe('body spin', () => {
  it('turns the body-fixed frame by whole turns exactly and in the authored direction', () => {
    const world = new World(DEFAULT_UNIVERSE), primus = world.body('planet');
    expect(primus.rotation).toEqual({ period: 600, direction: -1, phase: 0 });
    expect(spinRate(primus)).toBeCloseTo(-2 * Math.PI / 600, 15);
    expect(spinAngle(primus, 0)).toBe(0);
    expect(spinAngle(primus, 600 * 1e6)).toBe(0);
    expect(spinAngle(primus, 150)).toBeCloseTo(-Math.PI / 2, 12);
    expect(spinAngle(world.body('star'), 0)).toBe(0);
  });

  it('rejects a spin faster than a surface orbit', () => {
    const raw = structuredClone(terrain) as { systems: { bodies: Record<string, unknown>[] }[] };
    raw.systems[0]!.bodies[0]!.rotation = { period: 15 };
    expect(() => validateUniverse(raw)).toThrow(/break up/);
  });

  it('keeps a resting ship fixed to the ground while the ground carries it round', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-rest' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    for (let i = 0; i < 15_000; i++) world.step();
    const state = world.ship(ship.id)!.state;
    expect(state.position).toEqual({ x: 0, y: 512 });
    expect(state.velocity).toEqual({ x: 0, y: 0 });
    // A quarter turn clockwise later the pad faces +x, moving at the ground speed.
    const seen = inertialState(state, world.body('planet'));
    expect(seen.position.x).toBeCloseTo(512, 6);
    expect(seen.position.y).toBeCloseTo(0, 6);
    expect(seen.velocity.y).toBeCloseTo(-2 * Math.PI * 512 / 600, 9);
    expect(seen.heading).toBeCloseTo(0, 9);
  });

  it('launches with the ground speed of the pad', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-launch' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    world.setControls(ship.id, BURN);
    world.step();
    const state = world.ship(ship.id)!.state;
    expect(state.status).toBe('flying');
    // Liftoff from the north pad: the ground moves clockwise, toward +x, at 2πR/T.
    expect(state.velocity.x).toBeCloseTo(2 * Math.PI * 512 / 600, 3);
    expect(state.velocity.y).toBeGreaterThan(0);
  });

  it('lands a vertical hop safely because touchdown speed is measured against the ground', () => {
    for (const universe of [DEFAULT_UNIVERSE, spinningTerrain()]) {
      const world = new World(universe, { id: 'w-hop' });
      const ship = world.spawn({ ownerId: 'pilot-1' });
      const pad = world.ship(ship.id)!.state.position;
      hop(world, ship.id, 10);
      const state = world.ship(ship.id)!.state;
      expect(world.ship(ship.id)!.fault).toBeUndefined();
      expect(state.status).toBe('landed');
      // Body-fixed again, back down close to the pad (only Coriolis drift).
      expect(state.velocity).toEqual({ x: 0, y: 0 });
      expect(Math.hypot(state.position.x - pad.x, state.position.y - pad.y)).toBeLessThan(0.5);
      world.step();
      expect(world.isAsleep(ship.id)).toBe(true);
    }
  });

  it('crashes a hop that comes down too fast relative to the ground', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-crash' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    hop(world, ship.id, 200);
    expect(world.ship(ship.id)!.state.status).toBe('crashed');
  });

  it('settles a splashdown afloat on water that turns with the planet', () => {
    const raw = structuredClone(ocean) as { systems: { bodies: Record<string, unknown>[] }[] };
    raw.systems[0]!.bodies[0]!.rotation = { period: 600 };
    const world = new World(validateUniverse(raw), { id: 'w-ocean' });
    const ship = world.spawn({ ownerId: 'pilot-1', presetId: 'splash' });
    const afloat = () => world.ship(ship.id)!.state.water === 'floating';
    for (let i = 0; i < 60_000 && !afloat(); i++) world.step();
    // Afloat it rests body-fixed: drifting with the water, not left behind by it.
    const rest = world.ship(ship.id)!.state;
    for (let i = 0; i < 1000; i++) world.step();
    const state = world.ship(ship.id)!.state;
    expect(world.ship(ship.id)!.fault).toBeUndefined();
    expect(state).toMatchObject({ status: 'landed', water: 'floating', velocity: { x: 0, y: 0 } });
    expect(state.position.x).toBeCloseTo(rest.position.x, 9);
    expect(state.position.y).toBeCloseTo(rest.position.y, 9);
  });

  it('predicts the touchdown point where the live flight lands', () => {
    const world = new World(spinningTerrain(), { id: 'w-predict' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    world.setControls(ship.id, { turn: 0.3, throttle: 0, engine: true });
    for (let i = 0; i < 60; i++) world.step();
    world.setControls(ship.id, IDLE);
    const samples = [...(function* () { const it = world.predictShip(ship.id); let n = it.next();
      while (!n.done) { yield n.value; n = it.next(); } })()];
    for (let i = 0; i < 100_000 && world.ship(ship.id)!.state.status === 'flying'; i++) world.step();
    const landed = world.ship(ship.id)!.state;
    const last = samples[samples.length - 1]!;
    const actual = inertialPosition(landed.contact ? { ...landed, time: landed.contact.time } : landed, world.body('dry-planet'));
    expect(last.position.x).toBeCloseTo(actual.x, 9);
    expect(last.position.y).toBeCloseTo(actual.y, 9);
  });

  it('spawns a flying preset over the same ground at any time', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-preset' });
    world.advanceTo(15_000);
    const orbit = world.presetState('planet-orbit').state;
    const local = { angle: Math.atan2(orbit.position.y, orbit.position.x) - spinAngle(world.body('planet'), orbit.time) };
    expect(Math.cos(local.angle)).toBeCloseTo(0, 9);
    expect(Math.sin(local.angle)).toBeCloseTo(1, 9);
    expect(Math.hypot(orbit.velocity.x, orbit.velocity.y)).toBeCloseTo(Math.sqrt(13107200 / 640), 9);
  });

  it('includes spin in the shared simulation fingerprint', () => {
    const still = structuredClone(terrain);
    expect(new World(spinningTerrain()).simulationFingerprint).not.toBe(new World(validateUniverse(still)).simulationFingerprint);
    expect(new World(spinningTerrain(600)).simulationFingerprint).not.toBe(new World(spinningTerrain(601)).simulationFingerprint);
  });
});
