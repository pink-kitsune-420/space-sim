import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIVERSE, STEP, MAX_WARP, WARP_FACTORS, checkWarpSafety, clampWarpFactor, nextWarpFactor,
  type Controls,
} from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { HostSession, SessionError } from '../../packages/net/src/host';
import { Game } from '../helpers/net-harness';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };

describe('warp factor math and safety checks', () => {
  it('steps through WARP_FACTORS array with nextWarpFactor', () => {
    expect(WARP_FACTORS).toEqual([
      1, 2, 3, 4, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000,
    ]);
    expect(nextWarpFactor(1, 1)).toBe(2);
    expect(nextWarpFactor(2, 1)).toBe(3);
    expect(nextWarpFactor(3, 1)).toBe(4);
    expect(nextWarpFactor(4, 1)).toBe(5);
    expect(nextWarpFactor(5, 1)).toBe(10);
    expect(nextWarpFactor(10000, 1)).toBe(20000);
    expect(nextWarpFactor(100000, 1)).toBe(100000);

    expect(nextWarpFactor(100000, -1)).toBe(50000);
    expect(nextWarpFactor(2, -1)).toBe(1);
    expect(nextWarpFactor(1, -1)).toBe(1);

    // Intermediate numbers step up/down correctly
    expect(nextWarpFactor(3, 1)).toBe(4);
    expect(nextWarpFactor(7, 1)).toBe(10);
    expect(nextWarpFactor(7, -1)).toBe(5);
  });

  it('clamps warp factor to valid bounds and factors', () => {
    expect(clampWarpFactor(0)).toBe(1);
    expect(clampWarpFactor(1)).toBe(1);
    expect(clampWarpFactor(25)).toBe(20);
    expect(clampWarpFactor(75)).toBe(50);
    expect(clampWarpFactor(200000)).toBe(100000);
    expect(clampWarpFactor(NaN)).toBe(1);
  });

  it('allows full rails warp when ships are in stable orbit asleep on rails', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-warp-safe' });
    world.spawn({ ownerId: 'pilot-1' });
    // Step once to settle onto rails if eligible
    world.step();
    world.step();

    const safety = checkWarpSafety(world);
    expect(safety.railsEligible).toBe(true);
    expect(safety.maxGranted).toBe(100000);
    expect(safety.reason).toBeUndefined();
  });

  it.each([20, 58.5, 128, 521.3])('allows full rails warp in a verified circular orbit %s metres above the body', altitude => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-warp-orbit' });
    try {
      const ship=world.spawn({ownerId:'pilot-1',presetId:'planet-orbit'}),body=world.body(ship.bodyId),r=body.radius+altitude;
      world.teleport(ship.id,body.id,{x:0,y:r},{x:Math.sqrt(body.mu/r),y:0});world.step();world.step();
      expect(world.isAsleep(ship.id)).toBe(true);
      expect(checkWarpSafety(world)).toEqual({maxGranted:MAX_WARP,railsEligible:true});
      const expected=world.stateAt(ship.id,(world.tick+776110)*STEP)!,host=new HostSession(world);
      expect(host.setWarp(MAX_WARP).granted).toBe(MAX_WARP);
      const tick=world.tick;host.advance(7761.1/MAX_WARP);
      expect(world.tick).toBe(tick+776110);
      expect(world.ship(ship.id)!.state.position).toEqual(expected.position);
      expect(world.ship(ship.id)!.state.velocity).toEqual(expected.velocity);
    } finally { world.dispose(); }
  });

  it('restricts warp to 1x when simulation is paused', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-warp-pause' });
    world.paused = true;
    const safety = checkWarpSafety(world);
    expect(safety.maxGranted).toBe(1);
    expect(safety.reason).toContain('paused');
  });

  it('restricts warp to 1x when a ship is firing its main engine', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-warp-burn' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    world.setControls(ship.id, BURN);
    world.step();

    const safety = checkWarpSafety(world);
    expect(safety.maxGranted).toBe(1);
    expect(safety.railsEligible).toBe(false);
    expect(safety.reason).toContain('Engine thrust active');
  });

  it('restricts warp to physical max (4x) when steering or throttle is active', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-warp-turn' });
    const ship = world.spawn({ ownerId: 'pilot-1' });
    world.setControls(ship.id, { turn: 1, throttle: 0, engine: false });
    world.step();

    const safety = checkWarpSafety(world);
    expect(safety.maxGranted).toBe(4);
    expect(safety.railsEligible).toBe(false);
    expect(safety.reason).toContain('steering controls held');
  });
  it.each([false,true])('honors the strictest fleet control limit regardless of ship insertion order ($0)', reverse => {
    const world=new World(DEFAULT_UNIVERSE);
    try {
      const first=world.spawn({ownerId:'pilot-1'}),second=world.spawn({ownerId:'pilot-2'});
      world.setControls(reverse?second.id:first.id,{turn:1,throttle:0,engine:false});
      world.setControls(reverse?first.id:second.id,BURN);
      expect(checkWarpSafety(world)).toMatchObject({maxGranted:1,railsEligible:false,reason:expect.stringContaining('Engine thrust')});
    }finally{world.dispose();}
  });
});

describe('world.advanceTo rails fast-forwarding', () => {
  it.each(['surface approach','SOI exit'] as const)('stops maximum warp at a verified %s wake without skipping live physics', event => {
    const worlds=[new World(DEFAULT_UNIVERSE),new World(DEFAULT_UNIVERSE)];
    const [world,reference]=worlds as [World,World];reference.rails=false;
    try {
      for(const current of worlds){
        const ship=current.spawn({ownerId:'pilot-1',presetId:'planet-orbit'}),body=current.body(event==='SOI exit'?'moon':'planet');
        const r=event==='SOI exit'?body.soi.exitMetres-100:body.radius+300;
        current.teleport(ship.id,body.id,{x:0,y:r},event==='SOI exit'?{x:1,y:Math.sqrt(2*body.mu/r)*1.5}:{x:.7*Math.sqrt(body.mu/r),y:0});
        current.step();current.step();
      }
      const ship=world.ships()[0]!,host=new HostSession(world);
      expect(world.isAsleep(ship.id)).toBe(true);expect(Number.isFinite(world.nextWakeTick)).toBe(true);
      expect(host.setWarp(MAX_WARP).granted).toBe(MAX_WARP);
      host.advance(.1);
      expect(host.warp).toBe(1);expect(world.time).toBeLessThan(10000);
      expect(host.warpReason).toMatch(/woke|transition|contact/);
      while(reference.tick<world.tick)reference.step();
      const actual=world.ship(ship.id)!,expected=reference.ship(ship.id)!;
      expect(actual.bodyId).toBe(expected.bodyId);expect(actual.state.status).toBe(expected.state.status);
      expect(Math.hypot(actual.state.position.x-expected.state.position.x,actual.state.position.y-expected.state.position.y)).toBeLessThan(1e-8);
      expect(Math.hypot(actual.state.velocity.x-expected.state.velocity.x,actual.state.velocity.y-expected.state.velocity.y)).toBeLessThan(1e-8);
    } finally {for(const current of worlds)current.dispose();}
  });
  it('advances tick and time in O(1) when ships are asleep on rails', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-adv-rails' });
    world.spawn({ ownerId: 'pilot-1' });
    // Step two ticks so ship is put on rails
    world.step();
    world.step();
    expect(world.asleepCount).toBe(1);
    expect(world.awakeCount).toBe(0);

    const startTick = world.tick;
    const targetTick = startTick + 5000;
    const nextWake = world.nextWakeTick;
    expect(nextWake).toBeGreaterThan(targetTick);

    const startEpoch = Date.now();
    const events = world.advanceTo(targetTick);
    const durationMs = Date.now() - startEpoch;

    expect(world.tick).toBe(targetTick);
    expect(world.time).toBeCloseTo(targetTick * STEP);
    expect(events).toEqual([]);
    // O(1) jump should be virtually instantaneous (< 50ms)
    expect(durationMs).toBeLessThan(50);
  });

  it('wakes on rails when target tick reaches or passes next wake tick', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-adv-wake' });
    world.spawn({ ownerId: 'pilot-1' });
    world.step();
    world.step();

    const nextWake = world.nextWakeTick;
    if (Number.isFinite(nextWake)) {
      world.advanceTo(nextWake + 10);
      expect(world.tick).toBeGreaterThanOrEqual(nextWake);
    }
  });
});

describe('host authority and client synchronization for warp', () => {
  it('restricts warp activation to host seat only', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-host-perm' });
    const host = new HostSession(world);

    // Dedicated server console / host without playerId can warp
    expect(host.canWarp()).toBe(true);
    const hostResult = host.setWarp(10);
    expect(hostResult.granted).toBe(10);
    expect(host.warp).toBe(10);

    // Remote player cannot warp
    expect(host.canWarp('remote-player-123')).toBe(false);
    expect(() => host.setWarp(50, 'remote-player-123')).toThrow(SessionError);
    expect(() => host.setWarp(50, 'remote-player-123')).toThrow('Only the host can activate time warp.');
  });

  it('broadcasts warp factor to connected clients and syncs client session warp', () => {
    const game = new Game();
    const a = game.join('Ada');
    const b = game.join('Bo');
    game.run(200);

    expect(a.client.warp).toBe(1);
    expect(b.client.warp).toBe(1);

    // Host activates 10x warp
    game.host.setWarp(10);
    expect(game.host.warp).toBe(10);

    // Run game so snapshots are delivered
    game.run(100);

    expect(a.client.warp).toBe(10);
    expect(b.client.warp).toBe(10);
  });

  it('automatically drops warp to 1x when an engine burn starts', () => {
    const game = new Game();
    const a = game.join('Ada');
    game.run(200);

    game.host.setWarp(10);
    expect(game.host.warp).toBe(10);

    // Ada begins burning engine
    a.controls = BURN;
    game.run(200);

    // Host should have dropped warp to 1x
    expect(game.host.warp).toBe(1);
    expect(game.host.warpReason).toContain('Engine thrust active');
  });

  it('host.advance advances simulation time scaled by warp factor', () => {
    const world = new World(DEFAULT_UNIVERSE, { id: 'w-host-adv' });
    const host = new HostSession(world);
    world.spawn({ ownerId: 'host-player' });
    // Settle onto rails
    host.step();
    host.step();

    host.setWarp(100);
    expect(host.warp).toBe(100);

    const startTick = world.tick;
    // Advance 0.1s real time at 100x warp -> 10 simulation seconds -> 1000 ticks
    host.advance(0.1);
    expect(world.tick).toBeGreaterThanOrEqual(startTick + 990);
  });
});
