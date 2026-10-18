import { describe, expect, it } from 'vitest';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { worldFacade, engineModuleServices } from '../../packages/sim-core/src/module-services';
import { browserSessionFactory } from '../../apps/web/src/module-session';
import { CORE_WORLD, type WorldFactory } from '../../packages/game-api/src/index';
import { saveWorld } from '../../packages/sim-core/src/save';
import { loopback } from '../../packages/net/src/connection';
import { HostSession } from '../../packages/net/src/host';

describe('typed engine and session adapters', () => {
  it('joins through the Phase 2 session facade with asynchronous pilot reservation and exact authority', async () => {
    const world = new World(DEFAULT_UNIVERSE), host = new HostSession(world);
    const [server, peer] = loopback();
    try {
      const joining = browserSessionFactory.join(peer, { name: 'Module pilot', token: async () => undefined,
        lock: world.lock, simulationFingerprint: world.simulationFingerprint }, new AbortController().signal);
      host.accept(server);
      const session = await joining;
      expect(session.kind).toBe('client');
      expect(session.world.simulationFingerprint).toBe(world.simulationFingerprint);
      expect(session.players().map(p => p.name)).toEqual(['Module pilot']);
      session.dispose();
    } finally { host.close(); world.dispose(); }
  });

  it('rejects a different authoritative fingerprint through the Phase 2 session facade', async () => {
    const world = new World(DEFAULT_UNIVERSE), host = new HostSession(world);
    const [server, peer] = loopback();
    try {
      const joining = browserSessionFactory.join(peer, { name: 'Wrong game', simulationFingerprint: '0'.repeat(64),
        verifyCandidate: () => true }, new AbortController().signal);
      const rejected = expect(joining).rejects.toThrow('Simulation mismatch');
      host.accept(server);
      await rejected;
      expect(host.connectedCount()).toBe(0);
    } finally { host.close(); world.dispose(); }
  });

  it('preserves fixed-step results and save identity through the public facade', () => {
    const direct = new World(DEFAULT_UNIVERSE), backing = new World(DEFAULT_UNIVERSE), facade = worldFacade(backing);
    const options = { ownerId: 'pilot', presetId: 'pad' };
    const a = direct.spawn(options), b = facade.control.spawn(options);
    for (let i = 0; i < 20; i++) { direct.step(); facade.control.step(); }
    expect(facade.read.tick).toBe(direct.tick); expect(facade.read.time).toBe(direct.time);
    expect(facade.read.ship(b.id)).toEqual(direct.ship(a.id));
    expect(saveWorld(facade.read)).toEqual(saveWorld(direct));
    expect('setControls' in facade.read).toBe(false); expect('trackChanges' in facade.control).toBe(false);
    expect(() => { (facade.control as unknown as { tick: number }).tick = 99; }).toThrow();
    const prediction = facade.read.cloneForPrediction(); prediction.step();
    expect(facade.read.tick).toBe(20); expect(prediction.tick).toBe(21);
    prediction.dispose(); direct.dispose(); backing.dispose();
  });
  it('permits exact reconciliation rewind and owns one change consumer', () => {
    const world = new World(DEFAULT_UNIVERSE), { control } = worldFacade(world);
    control.restoreClock(7, 0.07000000000000001); control.restoreClock(2, 0.020000000000000004);
    expect(control.tick).toBe(2); expect(control.time).toBe(0.020000000000000004);
    expect(() => control.restoreClock(0.1, 0)).toThrow(); expect(() => control.restoreClock(2, Infinity)).toThrow();
    expect(control.tick).toBe(2);
    const changes = control.subscribeChanges(); expect(() => control.subscribeChanges()).toThrow('already');
    const ship = control.spawn({ ownerId: 'pilot' }); expect(changes.take().changed).toContain(ship.id);
    expect(changes.take().changed).toEqual([]); changes.dispose(); changes.dispose();
    expect(() => changes.take()).toThrow('disposed'); control.subscribeChanges().dispose(); control.dispose();
  });
  it('typechecks existing local controls and maneuver callbacks through the public session', () => {
    const factory = engineModuleServices().find(service => service.key.slot === CORE_WORLD.slot)!.service as WorldFactory;
    const world = factory.create(DEFAULT_UNIVERSE), session = browserSessionFactory.local(world, { name: 'Pilot', token: 'test-token' });
    const id = session.spawn(world.presetId(), false)!; let boundaries = 0;
    session.update(0.035, id, { turn: 0, throttle: 0, engine: false }, () => { boundaries++; return { turn: 0, throttle: 0, engine: true }; });
    expect(boundaries).toBe(3); expect(session.world.tick).toBe(3);
    const guest = session.local.seatGuest('Second pilot', 'guest-token');
    const guestShip = session.local.spawnGuest(guest, world.presetId()); expect(session.world.record(guestShip)?.ownerId).toBe(guest);
    expect(JSON.parse(session.local.snapshot()).t).toBe('snapshot');
    expect('local' in session).toBe(true); expect('host' in session).toBe(false);
    session.local.unseatGuest(guest); session.dispose(); session.dispose();
  });
});
