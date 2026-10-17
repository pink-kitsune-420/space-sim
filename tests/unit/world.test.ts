import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIVERSE, IDLE, STEP, advance, validateUniverse, type Controls, type State,
} from '../../packages/sim-core/src/index';
import { World, cleanName } from '../../packages/sim-core/src/world';
import oceanWorld from '../../games/space-sim/universes/sandbox/ocean/universe.json';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };

function standalone(world: World, presetId: string, steps: number, controls: (i: number) => Controls): State {
  const start = world.presetState(presetId);
  const body = world.body(start.bodyId), surface = world.surface(start.bodyId);
  let state = start.state;
  for (let i = 0; i < steps; i++) state = advance(state, controls(i), STEP, body, surface);
  return state;
}

describe('multi-ship world', () => {
  it('advances each ship exactly as single flight does, on one shared clock', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const pad = world.spawn({ ownerId: 'a', presetId: 'pad' });
    const orbit = world.spawn({ ownerId: 'b', presetId: 'planet-orbit' });
    const program = (i: number): Controls => i < 150 ? BURN : i < 220 ? { turn: 1, throttle: 0, engine: true } : IDLE;
    for (let i = 0; i < 400; i++) {
      world.setControls(pad.id, program(i));
      world.step();
    }
    expect(world.tick).toBe(400);
    const expectedPad = standalone(new World(DEFAULT_UNIVERSE), 'pad', 400, program);
    const expectedOrbit = standalone(new World(DEFAULT_UNIVERSE), 'planet-orbit', 400, () => IDLE);
    expect(world.ship(pad.id)!.state.position).toEqual(expectedPad.position);
    expect(world.ship(pad.id)!.state.velocity).toEqual(expectedPad.velocity);
    expect(world.ship(orbit.id)!.state.position).toEqual(expectedOrbit.position);
    for (const ship of world.ships()) expect(ship.state.time).toBe(world.time);
  });

  it('applies held controls only to the commanded ship', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const a = world.spawn({ ownerId: 'a', presetId: 'pad' });
    const b = world.spawn({ ownerId: 'a', presetId: 'pad' });
    world.setControls(a.id, BURN);
    for (let i = 0; i < 100; i++) world.step();
    expect(world.ship(a.id)!.state.status).toBe('flying');
    expect(world.ship(b.id)!.state.status).toBe('landed');
    expect(world.ship(b.id)!.state.position).toEqual(b.state.position);
  });

  it('spawns later ships on the shared clock with stable ids and default names', () => {
    const world = new World(DEFAULT_UNIVERSE);
    world.spawn({ ownerId: 'a' });
    for (let i = 0; i < 50; i++) world.step();
    const late = world.spawn({ ownerId: 'b', presetId: 'planet-orbit', name: '  Night\u0000  Owl  ' });
    expect(late.id).toBe('ship-2');
    expect(late.name).toBe('Night Owl');
    expect(late.state.time).toBe(world.time);
    expect(world.spawn({ ownerId: 'b' }).name).toBe('Vessel 03');
    world.step();
    expect(world.ship(late.id)!.state.dynamics).toBe('kepler');
    expect(world.ship(late.id)!.state.coast!.epochSeconds).toBe(late.state.time);
  });

  it('switches sphere of influence per ship and reports it', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const leaving = world.spawn({ ownerId: 'a', presetId: 'moon-orbit' });
    const staying = world.spawn({ ownerId: 'a', presetId: 'moon-orbit' });
    world.put({ ...leaving, state: { ...leaving.state, position: { x: 0, y: 2999.9 }, velocity: { x: 0, y: 100 } } });
    const events = world.step();
    expect(events).toEqual([{ type: 'soi', shipId: leaving.id, from: 'moon', to: 'planet' }]);
    expect(world.ship(leaving.id)!.bodyId).toBe('planet');
    expect(world.ship(staying.id)!.bodyId).toBe('moon');
  });

  it('freezes a ship whose motion fails without stopping the others', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const broken = world.spawn({ ownerId: 'a', presetId: 'planet-orbit' });
    const fine = world.spawn({ ownerId: 'a', presetId: 'planet-orbit' });
    world.put({ ...broken, state: { ...broken.state, position: { x: 0, y: 100 } } });
    const events = world.step();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'fault', shipId: broken.id });
    world.step();
    expect(world.ship(broken.id)!.fault).toContain('inside ground');
    expect(world.ship(broken.id)!.state.position).toEqual({ x: 0, y: 100 });
    expect(world.ship(broken.id)!.state.time).toBe(0); // the last verified snapshot
    expect(world.ship(fine.id)!.state.position).not.toEqual(fine.state.position);
    world.clearFault(broken.id);
    expect(world.ship(broken.id)!.fault).toBeUndefined();
    expect(world.ship(broken.id)!.state.time).toBe(world.time);
  });

  it('respawns in place of the old flight, keeping identity, owner and God mode', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const ship = world.spawn({ ownerId: 'a', presetId: 'pad', godMode: true });
    world.setControls(ship.id, BURN);
    for (let i = 0; i < 60; i++) world.step();
    const before = world.ship(ship.id)!;
    const again = world.respawn(ship.id, 'planet-orbit');
    expect(again).toMatchObject({ id: ship.id, name: ship.name, ownerId: 'a', bodyId: 'planet', controls: IDLE });
    expect(again.state.godMode).toBe(true);
    expect(again.state.time).toBe(world.time);
    expect(again.state.revision).toBe(before.state.revision + 1);
    world.remove(ship.id);
    expect(world.size).toBe(0);
    world.spawn({ ownerId: 'a' });
    world.reset();
    expect([world.size, world.tick, world.time, world.nextShipNumber]).toEqual([0, 0, 0, 1]);
  });

  it('generates terrain once and floats ships on the ocean world', () => {
    const world = new World(validateUniverse(oceanWorld));
    expect(world.surfaces.size).toBeGreaterThan(0);
    const splash = world.spawn({ ownerId: 'a', presetId: 'splash' });
    for (let i = 0; i < 2000 && world.ship(splash.id)!.state.water !== 'floating'; i++) world.step();
    expect(world.ship(splash.id)!.state.water).toBe('floating');
  });

  it('cleans names to printable, bounded text', () => {
    expect(cleanName('‮abc​  def\n')).toBe('abc def');
    expect(cleanName('x'.repeat(80))).toHaveLength(32);
    expect(cleanName(42)).toBe('');
  });
});
