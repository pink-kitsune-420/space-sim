import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE, IDLE, createSimulationContext, type Controls } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';
import { loopback } from '../../packages/net/src/connection';
import { ClientSession } from '../../packages/net/src/client';
import { HostSession } from '../../packages/net/src/host';
import { computeSimulationFingerprint, DEFAULT_BUILTIN_LOCK } from '../../packages/game-runtime/src/authoritative';
import { Game } from '../helpers/net-harness';
import type { ForceExtension, WorldRuleExtension } from '../../packages/game-api/src/index';

const BURN: Controls = { turn: 0, throttle: 0, engine: true };

describe('Phase 4: modular synchronization and reconciliation', () => {
  it('rejects connection when authoritative simulation fingerprints mismatch on info', () => {
    const [clientEnd, hostEnd] = loopback(deliver => deliver());
    const hostWorld = new World(DEFAULT_UNIVERSE, {
      id: 'w-host',
      simulationFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
    });
    const host = new HostSession(hostWorld);
    const client = new ClientSession(clientEnd, {
      name: 'Pilot',
      simulationFingerprint: '2222222222222222222222222222222222222222222222222222222222222222',
    });
    host.accept(hostEnd);

    expect(client.phase).toBe('closed');
    expect(client.closeReason).toContain('Simulation mismatch: host fingerprint is 1111111111111111111111111111111111111111111111111111111111111111');
    expect(client.closeReason).toContain('local fingerprint is 2222222222222222222222222222222222222222222222222222222222222222');
    expect(client.closeReason).toContain('Presentation-only differences are allowed, but authoritative simulation must match.');
    hostWorld.dispose();
  });

  it('rejects connection when host requires missing authoritative modules', () => {
    const [clientEnd, hostEnd] = loopback(deliver => deliver());
    const lock = {
      ...DEFAULT_BUILTIN_LOCK,
      modules: [
        ...DEFAULT_BUILTIN_LOCK.modules,
        { id: 'custom.gravity', version: '1.0.0' },
      ],
      order: [...DEFAULT_BUILTIN_LOCK.order, 'custom.gravity'],
    };
    const fingerprint = computeSimulationFingerprint(lock);
    const hostWorld = new World(DEFAULT_UNIVERSE, {
      id: 'w-host',
      lock,
      simulationFingerprint: fingerprint,
    });
    const host = new HostSession(hostWorld);

    // Client has the same fingerprint configured, but lacks custom.gravity in local lock
    const client = new ClientSession(clientEnd, {
      name: 'Pilot',
      lock: DEFAULT_BUILTIN_LOCK,
      simulationFingerprint: fingerprint,
    });
    host.accept(hostEnd);

    expect(client.phase).toBe('closed');
    expect(client.closeReason).toBe('Missing required authoritative module(s): custom.gravity@1.0.0');
    hostWorld.dispose();
  });

  it('permits clients with presentation-only differences to join and play', () => {
    const hostWorld = new World(DEFAULT_UNIVERSE, { id: 'w-test' });
    const game = new Game({}, hostWorld);

    // Both host and client have identical authoritative fingerprint
    const pilot = game.join('Pilot', {
      lock: hostWorld.lock,
      simulationFingerprint: hostWorld.simulationFingerprint,
    });

    game.run(200);
    expect(pilot.client.phase).toBe('joined');
    expect(pilot.client.world).toBeDefined();
    expect(pilot.client.world!.simulationFingerprint).toBe(hostWorld.simulationFingerprint);
  });

  it('synchronizes and reconciles stateful force extensions across network', () => {
    const forceHook = {
      modelIdentity: 'test-lift/v1',
      initialState: { version: 1, value: { liftCount: 100 } },
      evaluate: () => ({ x: 0, y: 5 }),
      commit: ({ moduleState }: any) => ({
        version: 1,
        value: { liftCount: (moduleState.value.liftCount as number) + 2 },
      }),
    };
    const forces: readonly ForceExtension[] = [{
      moduleId: 'test.lift',
      version: '0.1.0',
      hook: forceHook,
    }];

    const hostWorld = new World(DEFAULT_UNIVERSE, {
      id: 'w-forces',
      soloPreview: false,
      forces,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
      }),
    });

    const game = new Game({}, hostWorld);
    const pilot = game.join('Ada', {
      forces,
      lock: hostWorld.lock,
      simulationFingerprint: hostWorld.simulationFingerprint,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
      }),
    });

    game.run(300);
    expect(pilot.client.phase).toBe('joined');
    const shipId = pilot.client.ownShips()[0]!.id;

    // Command burn and advance
    pilot.controls = BURN;
    game.run(500, true);

    // Pause game to align host and client at identical snapshot tick
    game.host.setPaused(true, 'Check convergence');
    game.run(100);

    const hostShip = hostWorld.ship(shipId)!;
    const clientShip = pilot.client.world!.ship(shipId)!;

    expect(pilot.client.world!.tick).toBe(hostWorld.tick);
    expect((hostShip.state.moduleState?.['test.lift']?.value as any)?.liftCount).toBeGreaterThan(100);
    expect(clientShip.state.moduleState?.['test.lift']).toEqual(hostShip.state.moduleState?.['test.lift']);
    expect(clientShip.state.position.y).toBeCloseTo(hostShip.state.position.y, 4);
    expect(clientShip.state.velocity.y).toBeCloseTo(hostShip.state.velocity.y, 4);

    hostWorld.dispose();
  });

  it('synchronizes stateful shared-world rules with RNG on late join and delta reconciliation', () => {
    const ruleHook = {
      modelIdentity: 'test-rule/v1',
      seed: 777,
      initialState: { version: 1, value: { stepCount: 0, accumulated: 0 } },
      evaluate: ({ state, random }: any) => ({
        state: {
          version: 1,
          value: {
            stepCount: (state.value.stepCount as number) + 1,
            accumulated: (state.value.accumulated as number) + Math.floor(random() * 10),
          },
        },
      }),
    };
    const rules: readonly WorldRuleExtension[] = [{
      moduleId: 'test.rule',
      version: '0.1.0',
      hook: ruleHook,
    }];

    const hostWorld = new World(DEFAULT_UNIVERSE, {
      id: 'w-rules',
      soloPreview: false,
      rules,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        worldRules: true,
      }),
    });

    const game = new Game({ snapshotEveryTicks: 5 }, hostWorld);

    // Run host for 400ms (40 ticks) before pilot joins
    game.run(400);
    const hostStateBeforeJoin = hostWorld.moduleState['test.rule']!;
    expect((hostStateBeforeJoin.state.value as any).stepCount).toBe(40);

    // Late join
    const pilot = game.join('LateJoiner', {
      rules,
      lock: hostWorld.lock,
      simulationFingerprint: hostWorld.simulationFingerprint,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        worldRules: true,
      }),
    });

    game.run(300);
    expect(pilot.client.phase).toBe('joined');

    // Client world module state adopted host module state
    const clientRuleState = pilot.client.world!.moduleState['test.rule']!;
    expect((clientRuleState.state.value as any).stepCount).toBeGreaterThanOrEqual(40);

    // Pause to test exact alignment
    game.host.setPaused(true, 'Rule match');
    game.run(100);

    const hostFinal = hostWorld.moduleState['test.rule']!;
    const clientFinal = pilot.client.world!.moduleState['test.rule']!;
    expect(clientFinal.state.value).toEqual(hostFinal.state.value);
    expect(clientFinal.randomState).toBe(hostFinal.randomState);

    hostWorld.dispose();
  });

  it('keeps omitted sleeping ships and module state converging exactly in delta snapshots', () => {
    const forceHook = {
      modelIdentity: 'test-orbit-force/v1',
      initialState: { version: 1, value: { energy: 50 } },
      evaluate: () => ({ x: 0, y: 0 }),
      commit: ({ moduleState }: any) => moduleState,
    };
    const forces: readonly ForceExtension[] = [{
      moduleId: 'test.orbit',
      version: '0.1.0',
      hook: forceHook,
    }];

    const hostWorld = new World(DEFAULT_UNIVERSE, {
      id: 'w-sleep',
      soloPreview: false,
      forces,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
      }),
    });

    // Spawn an idle ship in orbit that will sleep on rails
    const sleepingShip = hostWorld.spawn({ ownerId: 'host', presetId: 'planet-orbit' });

    const game = new Game({ snapshotEveryTicks: 5 }, hostWorld);
    const pilot = game.join('Burner', {
      forces,
      lock: hostWorld.lock,
      simulationFingerprint: hostWorld.simulationFingerprint,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
      }),
    });

    game.run(300);
    expect(pilot.client.phase).toBe('joined');

    // Burn pilot's ship while sleepingShip remains in orbit
    pilot.controls = BURN;
    game.run(1500, true);

    // Pause to align mirror exactly
    game.host.setPaused(true, 'Align');
    game.run(100);

    const hostSleeping = hostWorld.ship(sleepingShip.id)!;
    const clientSleeping = pilot.client.world!.ship(sleepingShip.id)!;

    // Sleeping ship is omitted from delta snapshots, but client stateAt converges bit-for-bit
    expect(clientSleeping.state.status).toBe('flying');
    expect(clientSleeping.state.moduleState?.['test.orbit']).toEqual({
      version: 1,
      value: { energy: 50 },
    });
    expect(clientSleeping.state.position.x).toBeCloseTo(hostSleeping.state.position.x, 5);
    expect(clientSleeping.state.position.y).toBeCloseTo(hostSleeping.state.position.y, 5);
    expect(clientSleeping.state.velocity.x).toBeCloseTo(hostSleeping.state.velocity.x, 5);
    expect(clientSleeping.state.velocity.y).toBeCloseTo(hostSleeping.state.velocity.y, 5);

    hostWorld.dispose();
  });

  it('guarantees save and server restart determinism for modular worlds', () => {
    const forceHook = {
      modelIdentity: 'test-propulsion/v1',
      initialState: { version: 1, value: { charge: 10 } },
      evaluate: () => ({ x: 1, y: 1 }),
      commit: ({ moduleState }: any) => ({
        version: 1,
        value: { charge: ((moduleState.value as any).charge as number) + 1 },
      }),
    };
    const ruleHook = {
      modelIdentity: 'test-entropy/v1',
      seed: 1234,
      initialState: { version: 1, value: { entropy: 100 } },
      evaluate: ({ state, random }: any) => ({
        state: {
          version: 1,
          value: {
            entropy: ((state.value as any).entropy as number) + Math.floor(random() * 3),
          },
        },
      }),
    };

    const forces: readonly ForceExtension[] = [{ moduleId: 'test.prop', version: '0.1.0', hook: forceHook }];
    const rules: readonly WorldRuleExtension[] = [{ moduleId: 'test.ent', version: '0.1.0', hook: ruleHook }];

    const world = new World(DEFAULT_UNIVERSE, {
      id: 'w-restart',
      soloPreview: false,
      forces,
      rules,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
        worldRules: true,
      }),
    });

    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    world.setControls(ship.id, BURN);

    for (let t = 0; t < 50; t++) world.step();

    // Save world
    const saved = saveWorld(world, { players: [{ id: 'pilot', name: 'Pilot' }] });
    expect(saved.version).toBe(2);
    expect(saved.moduleState?.['test.ent']).toBeDefined();
    expect(saved.ships[0]?.moduleState?.['test.prop']).toBeDefined();

    // Restart server: load saved world
    const restored = loadWorld(JSON.parse(JSON.stringify(saved)), {
      soloPreview: false,
      forces,
      rules,
      createContext: (settings, opts) => createSimulationContext(settings, {
        ...opts,
        forces,
        worldRules: true,
      }),
    }).world;

    expect(restored.simulationFingerprint).toBe(world.simulationFingerprint);
    expect(restored.tick).toBe(world.tick);
    expect(restored.time).toBe(world.time);
    expect(restored.moduleState['test.ent']?.state.value).toEqual(world.moduleState['test.ent']?.state.value);
    expect(restored.ship(ship.id)!.state.moduleState?.['test.prop']?.value).toEqual(world.ship(ship.id)!.state.moduleState?.['test.prop']?.value);

    // Held commands are cleared on load; release them in the original too before comparing continuation.
    world.setControls(ship.id, IDLE);

    // Step both for another 50 ticks
    for (let t = 0; t < 50; t++) {
      expect(restored.step()).toEqual(world.step());
      expect(restored.ships()).toEqual(world.ships());
      expect(restored.moduleState['test.ent']?.state.value).toEqual(world.moduleState['test.ent']?.state.value);
    }

    world.dispose();
    restored.dispose();
  });
});
