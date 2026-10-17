import { describe, expect, it } from 'vitest';
import terrain from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import {
  DEFAULT_UNIVERSE, IDLE, MAX_WARP, PHYSICAL_WARP_MAX, checkWarpSafety, validateUniverse,
  type Controls,
} from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { HostSession } from '../../packages/net/src/host';

const TURN: Controls = { turn: 1, throttle: 0, engine: false };

describe('time warp while landed', () => {
  it('grants full rails warp to a ship spawned on the pad before its first step', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-pad-fresh' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    expect(world.awakeCount).toBe(1);
    expect(world.settles(ship.id)).toBe(true);
    expect(checkWarpSafety(world)).toEqual({ maxGranted: MAX_WARP, railsEligible: true });

    world.advanceTo(world.tick + 100_000);
    expect(world.awakeCount).toBe(0);
    expect(world.isAsleep(ship.id)).toBe(true);
  });

  it('keeps a sleeping landed ship identical to one stepped every tick', () => {
    for (const universe of [DEFAULT_UNIVERSE, validateUniverse(terrain)]) {
      const railed = new World(universe, { id: 'w-railed' }), stepped = new World(universe, { id: 'w-stepped' });
      stepped.rails = false;
      const ship = railed.spawn({ ownerId: 'pilot-1' });
      stepped.spawn({ ownerId: 'pilot-1' });
      for (let i = 0; i < 5000; i++) { railed.step(); stepped.step(); }
      expect(railed.isAsleep(ship.id)).toBe(true);
      expect(JSON.stringify(railed.ship(ship.id))).toBe(JSON.stringify(stepped.ship(ship.id)));
    }
  });

  it('warps straight away after a respawn and holds the factor through host frames', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-respawn' });
    const host = new HostSession(world);
    const ship = world.spawn({ ownerId: 'host-player' });
    host.step();
    world.respawn(ship.id);

    expect(host.setWarp(1000).granted).toBe(1000);
    const start = world.time;
    for (let i = 0; i < 10; i++) host.advance(0.1);
    expect(host.warp).toBe(1000);
    expect(world.time - start).toBeCloseTo(1000, 6);
    expect(world.ship(ship.id)!.state.status).toBe('landed');
  });

  it('caps warp while steering is held and restores the request once it is released', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-release' });
    const host = new HostSession(world);
    const ship = world.spawn({ ownerId: 'host-player' });
    host.setWarp(1000);

    world.setControls(ship.id, TURN);
    host.advance(0.05);
    expect(host.warp).toBe(PHYSICAL_WARP_MAX);
    expect(host.requestedWarp).toBe(1000);
    expect(host.warpReason).toMatch(/steering/);
    world.setControls(ship.id, IDLE);
    host.advance(0.05);
    expect(host.warp).toBe(1000);
    expect(host.warpReason).toBe('');
  });

  it('stops warp on an engine burn until it is requested again', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-burn' });
    const host = new HostSession(world);
    const pilot = host.seatHost('Host', 'host-token');
    const ship = world.spawn({ ownerId: pilot });
    host.setWarp(1000);

    host.setControls(pilot, ship.id, { turn: 0, throttle: 0, engine: true });
    expect(host.warp).toBe(1);
    expect(host.requestedWarp).toBe(1);
    expect(host.warpReason).toMatch(/Engine thrust/);
    host.setControls(pilot, ship.id, IDLE);
    expect(host.warp).toBe(1);
  });

  it('holds warp at 1x for the touchdown step only, then grants rails warp', () => {
    const world = new World(validateUniverse(terrain), { id: 'w-touchdown' });
    const ship = world.spawn({ ownerId: 'pilot-1', godMode: true });
    world.setControls(ship.id, { turn: 0, throttle: 1, engine: true });
    for (let i = 0; i < 100; i++) world.step();
    world.setControls(ship.id, IDLE);
    for (let i = 0; i < 100_000 && world.ship(ship.id)!.state.status === 'flying'; i++) world.step();

    expect(world.ship(ship.id)!.state.contact).toBeDefined();
    expect(checkWarpSafety(world)).toMatchObject({ maxGranted: 1, reason: 'Surface contact on Vessel 01' });
    world.step();
    expect(world.awakeCount).toBe(0);
    expect(checkWarpSafety(world)).toEqual({ maxGranted: MAX_WARP, railsEligible: true });
  });

  it('limits a ship afloat to physical warp instead of stopping time', () => {
    const world = new World(validateUniverse(ocean), { id: 'w-afloat' });
    const ship = world.spawn({ ownerId: 'pilot-1', presetId: 'splash' });
    expect(world.settles(ship.id)).toBe(false);
    for (let i = 0; i < 100; i++) world.step();
    expect(world.ship(ship.id)!.state.water).toBeDefined();
    expect(checkWarpSafety(world)).toMatchObject({ maxGranted: PHYSICAL_WARP_MAX, railsEligible: false });
  });
});
