import { describe, expect, it } from 'vitest';
import type { CommandExtension, CommandHook, ModuleManifest, RegisteredModule, WorldEvent, WorldRuleHook } from '../../packages/game-api/src/index';
import { ModuleRegistry, captureCommand, captureCommands, commandArguments } from '../../packages/game-runtime/src/index';
import { prepareGame } from '../../packages/modules/src/index';
import { GAME_EXAMPLES } from '../../examples/modules/index';
import { HostSession, SessionError } from '../../packages/net/src/host';
import { PROTOCOL, ProtocolError, parseClientMessage } from '../../packages/net/src/protocol';
import { Game } from '../helpers/net-harness';
import { checkCommandKeys, CommandBar } from '../../apps/web/src/commands';
import { createFlightSessions } from '../../modules/session-flight/src/index';
import { flightSessionServices } from '../../packages/net/src/session-services';
import { presentationCommands } from '../../apps/web/src/presentation-commands';
import { createPresentationControls } from '../../apps/web/src/presentation-controls';
import { createPlayerController } from '../../modules/player-controller/src/index';

const TOKEN = '0123456789abcdef0123456789abcdef';
const BASE = [{ id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }];
function manifest(id: string): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id, version: '1.0.0', kind: 'provider',
    authority: 'authoritative', environments: ['browser', 'offline', 'node'], dependencies: [], slots: [], provides: [], requires: [],
    settings: {}, before: [], after: [], license: 'LicenseRef-Project' };
}
function worldWith(code: readonly RegisteredModule[], ids: readonly string[], soloPreview?: boolean) {
  const prepared = prepareGame({ environment: 'node', id: 'w-commands', code, ...(soloPreview !== undefined ? { soloPreview } : {}),
    profile: { format: 'space-sim-profile/1', id: 'test.commands', modules: [...BASE, ...ids.map(id => ({ id, version: code.find(m => m.manifest.id === id)!.manifest.version }))],
      providers: { content: 'builtin.content', motion: 'builtin.motion' }, settings: {} } });
  prepared.runtime.activate(prepared.candidate);
  return prepared.world;
}
const examples = (soloPreview?: boolean) => worldWith(GAME_EXAMPLES, ['example.maneuvers'], soloPreview);

describe('view-bound presentation commands', () => {
  it('routes repeated held input through PlayerController before stepping and releases it on handoff', () => {
    const controls: RegisteredModule = { manifest: manifest('test.pilot'), initialize(c) {
      c.contributeCommand({ name: 'eva-input', label: 'EVA input', parameters: {
        turn: { type: 'number', default: 0, minimum: -1, maximum: 1 },
        throttle: { type: 'number', default: 0, minimum: -1, maximum: 1 },
        engine: { type: 'number', default: 0, minimum: 0, maximum: 1, integer: true },
      }, resolve: ({ args }) => ({ moduleEvent: { type: 'eva-input', payload: { ...args } } }) });
      c.contributeWorldRule({ modelIdentity: 'owned-input/test', seed: 7, initialState: { version: 1, value: {} },
        evaluate({ state, events }) {
          const input = events.filter(e => e.type === 'module').at(-1);
          return { state: input?.type === 'module' ? { version: 1, value: input.moduleEvent.payload } : state };
        } });
    } };
    const world = worldWith([controls], ['test.pilot'], false), provider = createFlightSessions(flightSessionServices());
    const session = provider.local(world, { name: 'Pilot' });
    const router = createPresentationControls({ create: createPlayerController });
    try {
      const ship = session.spawn('pad', false)!, heading = world.ship(ship)!.state.heading;
      const target = { entityId: `${ship}/astronaut`, commandId: 'test.pilot/eva-input' };
      const held = { turn: -1, throttle: 0, engine: false };
      for (let i = 0; i < 60; i++) session.update(.016, ship, router.route(session, session.playerId, ship, held, target, true));
      expect(world.ship(ship)!.state.heading).toBe(heading);
      expect(world.moduleState['test.pilot']!.state.value).toEqual({ turn: -1, throttle: 0, engine: 0 });
      session.update(.02, ship, router.route(session, session.playerId, ship, held, target, false));
      expect(world.moduleState['test.pilot']!.state.value).toEqual({ turn: 0, throttle: 0, engine: 0 });
      // Returning to the ship first releases the astronaut and requires neutral intent.
      session.update(.02, ship, router.route(session, session.playerId, ship, held, undefined, true));
      expect(world.ship(ship)!.state.heading).toBe(heading);
      router.route(session, session.playerId, ship, { turn: 0, throttle: 0, engine: false }, undefined, true);
      session.update(.02, ship, router.route(session, session.playerId, ship, held, undefined, true));
      expect(world.ship(ship)!.state.heading).not.toBe(heading);
      // A failed selector consumes controls; it never falls through to flight.
      expect(router.route(session, session.playerId, ship, held, null, true)).toEqual({ turn: 0, throttle: 0, engine: false });
    } finally { router.dispose(); session.dispose(); provider.dispose(); world.dispose(); }
  });
  it('uses real host validation and refuses foreign ships even in a local multi-seat session', () => {
    const world = examples();
    const sessions = createFlightSessions(flightSessionServices());
    const session = sessions.local(world, { name: 'Ada', token: TOKEN });
    try {
      const own = session.spawn('pad', false)!;
      const guest = session.local.seatGuest('Bo', 'fedcba9876543210fedcba9876543210');
      const other = session.local.spawnGuest(guest, 'pad', false);
      session.setThrottle(own, 1);
      session.local.setGuestThrottle(guest, other, 1);
      const sender = presentationCommands(session, session.playerId, own, () => true);
      expect(sender.issue('example.maneuvers/trim-throttle', { step: -.25 })).toBe(true);
      expect(world.ship(own)!.state.throttle).toBe(.75);
      expect(sender.issue('example.maneuvers/trim-throttle', { step: NaN })).toBe(false);
      expect(sender.issue('example.maneuvers/trim-throttle', { step: 2 })).toBe(false);
      expect(sender.issue('example.maneuvers/unknown')).toBe(false);
      expect(world.ship(own)!.state.throttle).toBe(.75);
      expect(presentationCommands(session, session.playerId, other, () => true).issue('example.maneuvers/cut-throttle')).toBe(false);
      expect(world.ship(other)!.state.throttle).toBe(1);
      expect(presentationCommands(session, guest, other, () => true).issue('example.maneuvers/cut-throttle')).toBe(true);
      expect(world.ship(other)!.state.throttle).toBe(0);
      let current = true;
      const oldView = presentationCommands(session, session.playerId, own, () => current);
      current = false;
      expect(oldView.issue('example.maneuvers/cut-throttle')).toBe(false);
      expect(world.ship(own)!.state.throttle).toBe(.75);
      session.spawn('pad', false);
      session.remove(own);
      expect(sender.issue('example.maneuvers/cut-throttle')).toBe(false);
    } finally { session.dispose(); sessions.dispose(); world.dispose(); }
  });
});

describe('command registration', () => {
  it('validates names, labels, keys and parameter schemas once, then freezes them', () => {
    const hook: CommandHook = { name: 'trim', label: 'Trim', key: 'KeyT', parameters: { step: { type: 'number', default: .1, minimum: -1, maximum: 1 } },
      resolve: () => ({ throttle: 0 }) };
    const command = captureCommand('test.module', '1.0.0', hook);
    expect(command.id).toBe('test.module/trim');
    expect(Object.isFrozen(command.hook.parameters)).toBe(true);
    expect(commandArguments(command)).toEqual({ step: .1 });
    expect(commandArguments(command, { step: -.5 })).toEqual({ step: -.5 });
    for (const [args, message] of [[{ step: 2 }, 'argument step: must be a number in [-1, 1]'], [{ stride: 1 }, 'unknown argument stride'],
      [{ step: NaN }, 'argument step'], [[1], 'arguments must be an object']] as const) {
      expect(() => commandArguments(command, args)).toThrow(message);
    }
    const bad: [Partial<CommandHook> & Record<string, unknown>, string][] = [
      [{ name: 'Trim' }, 'name must be'], [{ label: 'x'.repeat(33) }, 'label must contain'], [{ key: 'Enter' }, 'key must be'],
      [{ resolve: 1 as unknown as CommandHook['resolve'] }, 'resolve must be a function'], [{ shortcut: 'T' }, 'unknown field'],
      [{ parameters: { step: { type: 'number', default: 2, minimum: 0, maximum: 1 } } }, 'minimum ≤ default ≤ maximum'],
      [{ parameters: { count: { type: 'number', default: .5, minimum: 0, maximum: 1, integer: true } } }, 'integers'],
      [{ parameters: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`p${i}`, { type: 'number', default: 0, minimum: 0, maximum: 1 }])) }, 'at most 8 parameters'],
    ];
    for (const [change, message] of bad) expect(() => captureCommand('test.module', '1.0.0', { ...hook, ...change } as CommandHook)).toThrow(message);
    const integer = captureCommand('test.module', '1.0.0', { ...hook, parameters: { count: { type: 'number', default: 1, minimum: 0, maximum: 5, integer: true } } });
    expect(() => commandArguments(integer, { count: 1.5 })).toThrow('must be an integer in [0, 5]');
    expect(() => captureCommands([command, command])).toThrow('invalid or duplicate ID');
  });
  it('keeps one key per command and only authoritative modules may register them', () => {
    const registry = new ModuleRegistry();
    const go = (name: string, key?: string): CommandHook => ({ name, label: name, ...(key ? { key } : {}), resolve: () => ({ throttle: 1 }) });
    registry.register({ manifest: manifest('test.one'), initialize: c => c.contributeCommand(go('go', 'KeyG')) });
    registry.register({ manifest: manifest('test.two'), initialize: c => c.contributeCommand(go('also', 'KeyG')) });
    registry.register({ manifest: manifest('test.many'), initialize: c => { for (let i = 0; i < 33; i++) c.contributeCommand(go(`c${i}`)); } });
    registry.register({ manifest: { ...manifest('test.look'), authority: 'presentation' }, initialize: c => c.contributeCommand(go('look')) });
    const profile = (...ids: string[]) => ({ format: 'space-sim-profile/1' as const, id: 'test.p', modules: ids.map(id => ({ id, version: '1.0.0' })), providers: {}, settings: {} });
    expect(registry.prepare(profile('test.one'), 'node').commands.map(c => c.id)).toEqual(['test.one/go']);
    expect(() => registry.prepare(profile('test.one', 'test.two'), 'node')).toThrow('Command test.two/also: key KeyG is already bound to test.one/go');
    expect(() => registry.prepare(profile('test.many'), 'node')).toThrow('at most 32 commands');
    expect(() => registry.prepare(profile('test.look'), 'node')).toThrow('commands require authoritative scope');
  });
  it('rejects command keys that would take over the console before activation', () => {
    const command = (key: string, context?: 'flight' | 'eva' | 'editor' | 'all') =>
      captureCommand('test.module', '1.0.0', { name: 'go', label: 'Go', key, ...(context ? { context } : {}), resolve: () => ({ throttle: 1 }) });
    expect(() => checkCommandKeys([command('KeyP')])).toThrow('Module test.module command test.module/go: key P is reserved by the flight console');
    expect(() => checkCommandKeys([command('KeyV'), command('Digit1')])).not.toThrow();

    // Modal contexts allow KeyX or KeyR in EVA or Editor contexts without flight console collision
    expect(() => checkCommandKeys([command('KeyX', 'eva'), command('KeyR', 'editor')])).not.toThrow();
  });
  it('permits duplicate keys across distinct modal contexts but rejects within overlapping contexts', () => {
    const hook = (name: string, key: string, context: 'flight' | 'eva' | 'editor' | 'all'): CommandHook =>
      ({ name, label: name, key, context, resolve: () => ({ throttle: 1 }) });
    const cFlight = captureCommand('test.flight', '1.0.0', hook('fly', 'KeyU', 'flight'));
    const cEva = captureCommand('test.eva', '1.0.0', hook('walk', 'KeyU', 'eva'));
    // Different contexts: succeeds
    expect(() => captureCommands([cFlight, cEva])).not.toThrow();

    // Same context or 'all' context: throws collision error
    const cFlight2 = captureCommand('test.other', '1.0.0', hook('fly2', 'KeyU', 'flight'));
    expect(() => captureCommands([cFlight, cFlight2])).toThrow('Command test.other/fly2: key KeyU is already bound to test.flight/fly');

    const cAll = captureCommand('test.all', '1.0.0', hook('universal', 'KeyU', 'all'));
    expect(() => captureCommands([cEva, cAll])).toThrow('Command test.all/universal: key KeyU is already bound to test.eva/walk');
  });
});

describe('commands on the authoritative host', () => {
  it('belong to the authoritative profile: the lock and fingerprint name the module, and the world gates sharing', () => {
    const world = examples(), plain = worldWith(GAME_EXAMPLES, []);
    expect(() => checkCommandKeys(world.commands)).not.toThrow();
    expect(world.commands.map(c => c.id)).toEqual(['example.maneuvers/full-throttle', 'example.maneuvers/cut-throttle', 'example.maneuvers/trim-throttle']);
    expect(world.lock!.modules.map(m => m.id)).toContain('example.maneuvers');
    expect(world.simulationFingerprint).not.toBe(plain.simulationFingerprint);
    expect(world.soloPreview).toBe(true);
    const clone = world.cloneForPrediction();
    expect(clone.commands.map(c => c.id)).toEqual(world.commands.map(c => c.id));
    clone.dispose(); world.dispose(); plain.dispose();
  });
  it('checks ownership and arguments, then applies the validated effect between steps', () => {
    const world = examples();
    const host = new HostSession(world);
    const ada = host.seatHost('Ada', TOKEN);
    const ship = host.spawnShip(ada, 'planet-orbit');
    for (let i = 0; i < 10; i++) host.step();
    world.takeChanges();
    host.command(ada, ship.id, 'example.maneuvers/full-throttle');
    expect(world.ship(ship.id)!.state.throttle).toBe(1);
    expect(world.takeChanges().changed).toEqual([ship.id]);
    host.command(ada, ship.id, 'example.maneuvers/trim-throttle', { step: -.25 });
    expect(world.ship(ship.id)!.state.throttle).toBe(.75);
    host.command(ada, ship.id, 'example.maneuvers/trim-throttle');
    expect(world.ship(ship.id)!.state.throttle).toBeCloseTo(.85, 12);
    const before = world.ship(ship.id), version = world.version;
    for (const [run, message] of [
      [() => host.command(ada, ship.id, 'example.maneuvers/trim-throttle', { step: 2 }), 'Throttle +10% was refused: Command example.maneuvers/trim-throttle argument step'],
      [() => host.command(ada, ship.id, 'example.maneuvers/trim-throttle', { stride: 1 }), 'unknown argument stride'],
      [() => host.command(ada, ship.id, 'example.maneuvers/warp'), 'This world has no command example.maneuvers/warp.'],
      [() => host.command('player-x', ship.id, 'example.maneuvers/cut-throttle'), 'Unknown player.'],
    ] as const) {
      expect(run).toThrow(SessionError);
      expect(run).toThrow(message);
    }
    const bea = host.seatHost('Bea', 'fedcba9876543210fedcba9876543210');
    expect(() => host.command(bea, ship.id, 'example.maneuvers/cut-throttle')).toThrow('You can only command your own ships.');
    expect(world.ship(ship.id)).toEqual(before);
    expect(world.version).toBe(version);
    world.dispose();
  });
  it('refuses a misbehaving command with module, command and tick, and changes nothing', () => {
    const calls: unknown[] = [];
    const faulty: RegisteredModule = { manifest: manifest('test.faulty'), initialize(c) {
      c.contributeCommand({ name: 'throws', label: 'Throws', resolve: () => { throw new Error('engine offline'); } });
      c.contributeCommand({ name: 'overdrive', label: 'Overdrive', resolve: () => ({ throttle: 2 }) });
      c.contributeCommand({ name: 'teleport', label: 'Teleport', resolve: () => ({ throttle: 1, position: { x: 0, y: 0 } }) as never });
      c.contributeCommand({ name: 'later', label: 'Later', resolve: (async () => ({ throttle: 1 })) as never });
      c.contributeCommand({ name: 'nothing', label: 'Nothing', resolve: () => ({}) });
      c.contributeCommand({ name: 'tamper', label: 'Tamper', resolve: ({ ship }) => { (ship.state as { throttle: number }).throttle = 1; return { throttle: 1 }; } });
      c.contributeCommand({ name: 'spy', label: 'Spy', parameters: { level: { type: 'number', default: .3, minimum: 0, maximum: 1 } },
        resolve: input => { calls.push(input); return { throttle: input.args.level!, controls: { turn: -1, throttle: 0, engine: false } }; } });
    } };
    const world = worldWith([faulty], ['test.faulty']);
    const host = new HostSession(world);
    const ada = host.seatHost('Ada', TOKEN);
    const ship = host.spawnShip(ada, 'pad');
    for (let i = 0; i < 3; i++) host.step();
    const before = world.ship(ship.id), version = world.version;
    for (const [name, message] of [['throws', 'engine offline'], ['overdrive', 'invalid command throttle'], ['teleport', 'invalid command effect'],
      ['later', 'invalid command effect'], ['nothing', 'empty effect'], ['tamper', 'read only']] as const) {
      expect(() => host.command(ada, ship.id, `test.faulty/${name}`)).toThrow(new RegExp(`was refused: Module test.faulty command test.faulty/${name} tick 3: .*${message}`, 'i'));
    }
    expect(world.ship(ship.id)).toEqual(before);
    expect(world.version).toBe(version);
    host.command(ada, ship.id, 'test.faulty/spy');
    const input = calls[0] as { tick: number; time: number; ship: { id: string }; args: Record<string, number> };
    expect(input).toMatchObject({ tick: 3, ship: { id: ship.id }, args: { level: .3 } });
    expect(input.time).toBeCloseTo(.03, 12);
    expect(Object.isFrozen(input.ship)).toBe(true);
    expect(world.ship(ship.id)!.state.throttle).toBe(.3);
    expect(world.ship(ship.id)!.controls).toEqual({ turn: -1, throttle: 0, engine: false });
    world.dispose();
  });
  it('preserves command controls across session.update polling until step runs (NTG-BUG-017)', () => {
    const eva: RegisteredModule = {
      manifest: manifest('test.eva'),
      initialize(c) {
        c.contributeCommand({
          name: 'disembark',
          label: 'Disembark',
          resolve: () => ({ controls: { turn: 0, throttle: 0.11, engine: false } }),
        });
      },
    };
    const world = worldWith([eva], ['test.eva']);
    const provider = createFlightSessions(flightSessionServices());
    const session = provider.local(world, { name: 'Pilot' });
    const shipId = session.spawn('pad', false)!;
    expect(world.ship(shipId)!.controls).toEqual({ turn: 0, throttle: 0, engine: false });

    // Pilot triggers command via shortcut/HUD button
    session.command(shipId, 'test.eva/disembark');
    expect(world.ship(shipId)!.controls).toEqual({ turn: 0, throttle: 0.11, engine: false });

    // Intervening animation frame (5ms < 10ms tick step) with momentary idle flight stick input
    const idle = { turn: 0, throttle: 0, engine: false };
    session.update(0.005, shipId, idle);

    // Controls must SURVIVE the intervening frame polling without being clobbered back to idle!
    expect(world.ship(shipId)!.controls).toEqual({ turn: 0, throttle: 0.11, engine: false });

    // Next frame advances past the 10ms threshold and executes step()
    session.update(0.006, shipId, idle);

    // Pending command controls were applied in the tick step and are now cleared for subsequent frames
    session.update(0.01, shipId, idle);
    expect(world.ship(shipId)!.controls).toEqual(idle);

    session.dispose();
    provider.dispose();
    world.dispose();
  });
  it('supports moduleEvent in CommandEffect and delivers it directly to WorldRuleHook.evaluate', () => {
    const observedEvents: WorldEvent[] = [];
    const ruleHook: WorldRuleHook = {
      modelIdentity: 'test.rule/v1',
      initialState: { version: 1, value: 0 },
      seed: 42,
      evaluate(input) {
        observedEvents.push(...input.events);
        return { state: input.state };
      },
    };
    const domainMod: RegisteredModule = {
      manifest: manifest('test.domain'),
      initialize(c) {
        c.contributeWorldRule(ruleHook);
        c.contributeCommand({
          name: 'switch-tool',
          label: 'Switch Tool',
          resolve: () => ({
            moduleEvent: {
              type: 'tool-change',
              payload: { tool: 'laser', power: 100 },
            },
          }),
        });
      },
    };
    const world = worldWith([domainMod], ['test.domain']);
    const host = new HostSession(world);
    const ada = host.seatHost('Ada', TOKEN);
    const ship = host.spawnShip(ada, 'pad');

    // Run a step first; verify no module events initially
    host.step();
    expect(observedEvents.some(e => e.type === 'module')).toBe(false);

    // Issue module command with domain event payload
    host.command(ada, ship.id, 'test.domain/switch-tool');

    // On the subsequent fixed step, WorldRuleHook.evaluate receives the moduleEvent directly!
    host.step();
    const modEvent = observedEvents.find(e => e.type === 'module');
    expect(modEvent).toBeDefined();
    expect(modEvent).toMatchObject({
      type: 'module',
      shipId: ship.id,
      moduleEvent: {
        type: 'tool-change',
        payload: { tool: 'laser', power: 100 },
      },
      event: {
        type: 'tool-change',
        payload: { tool: 'laser', power: 100 },
      },
    });

    world.dispose();
  });
});

describe('commands over the network', () => {
  it('parses command requests strictly and bumps the protocol', () => {
    expect(PROTOCOL).toBe('space-sim-net/6');
    expect(parseClientMessage(JSON.stringify({ t: 'command', ship: 'ship-1', command: 'example.maneuvers/trim-throttle', args: { step: -.5 } })))
      .toEqual({ t: 'command', ship: 'ship-1', command: 'example.maneuvers/trim-throttle', args: { step: -.5 } });
    expect(parseClientMessage(JSON.stringify({ t: 'command', ship: 'ship-1', command: 'example.maneuvers/cut-throttle' })))
      .toEqual({ t: 'command', ship: 'ship-1', command: 'example.maneuvers/cut-throttle' });
    for (const bad of [{ command: 'cut-throttle' }, { command: 'Example.maneuvers/cut' }, { command: 'example.maneuvers/' },
      { command: 'example.maneuvers/cut', args: { step: '1' } }, { command: 'example.maneuvers/cut', args: { 'bad key': 1 } },
      { command: 'example.maneuvers/cut', args: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`a${i}`, 1])) },
      { command: 'example.maneuvers/cut', args: [1] }, { command: 'example.maneuvers/cut', ship: '../ship' }]) {
      expect(() => parseClientMessage(JSON.stringify({ t: 'command', ship: 'ship-1', ...bad }))).toThrow(ProtocolError);
    }
  });
  it('runs a remote pilot\'s command once, on the host, and converges the client from snapshots', () => {
    let resolves = 0;
    const counted: RegisteredModule = { manifest: manifest('test.counted'), initialize: c => c.contributeCommand({ name: 'full', label: 'Full',
      resolve: () => { resolves++; return { throttle: 1 }; } }) };
    const world = worldWith([counted], ['test.counted'], false);
    const game = new Game({}, world);
    const host = game.host.seatHost('Host', TOKEN);
    const hostShip = game.host.spawnShip(host, 'pad');
    const pilot = game.join('Ada', { lock: world.lock, simulationFingerprint: world.simulationFingerprint, commands: world.commands });
    game.run(400);
    expect(pilot.client.phase).toBe('joined');
    const ship = pilot.client.ownShips()[0]!.id;
    expect(pilot.client.world!.commands.map(c => c.id)).toEqual(['test.counted/full']);
    pilot.client.command(ship, 'test.counted/full');
    game.run(400);
    expect(resolves).toBe(1);
    expect(world.ship(ship)!.state.throttle).toBe(1);
    expect(pilot.client.world!.ship(ship)!.state.throttle).toBe(1);
    // Commanding someone else's ship is refused by the host with a notice; the pilot stays joined.
    const notices: string[] = [];
    pilot.client.onnotice = text => notices.push(text);
    const throttle = world.ship(hostShip.id)!.state.throttle;
    pilot.client.command(hostShip.id, 'test.counted/full');
    pilot.client.command(ship, 'test.counted/missing');
    game.run(400);
    expect(notices).toEqual(['You can only command your own ships.', 'This world has no command test.counted/missing.']);
    expect(world.ship(hostShip.id)!.state.throttle).toBe(throttle);
    expect(pilot.client.phase).toBe('joined');
    expect(resolves).toBe(1);
    world.dispose();
  });
});

describe('CommandBar key resolution', () => {
  it('falls back to command hook key when unmapped or empty, and respects configured keys', () => {
    const mockContainer = {
      addEventListener: () => {},
      replaceChildren: () => {},
      hidden: false,
      querySelectorAll: () => [],
    } as unknown as HTMLElement;
    const keybindings: Record<string, string[] | undefined> = {};
    const bar = new CommandBar(mockContainer, () => {}, id => keybindings[id]);
    const cmd1: CommandExtension = {
      id: 'mod/cmd1',
      moduleId: 'mod',
      version: '1.0.0',
      hook: { name: 'cmd1', label: 'Cmd 1', key: 'KeyU', resolve: () => ({}) },
    };
    const cmd2: CommandExtension = {
      id: 'mod/cmd2',
      moduleId: 'mod',
      version: '1.0.0',
      hook: { name: 'cmd2', label: 'Cmd 2', resolve: () => ({}) },
    };

    const prevDoc = (globalThis as unknown as { document?: unknown }).document;
    (globalThis as unknown as { document: unknown }).document = {
      createElement: () => ({ append: () => {}, setAttribute: () => {}, dataset: {} }),
    };
    try {
      bar.sync([cmd1, cmd2]);

      // Unconfigured falls back to hook.key
      expect(bar.commandKeys(cmd1)).toEqual(['KeyU']);
      expect(bar.commandKeys(cmd2)).toEqual([]);
      expect(bar.byKey('KeyU')).toBe(cmd1);
      expect(bar.byKey('KeyX')).toBeUndefined();

      // Explicit empty array still falls back to hook.key
      keybindings['mod/cmd1'] = [];
      expect(bar.commandKeys(cmd1)).toEqual(['KeyU']);
      expect(bar.byKey('KeyU')).toBe(cmd1);

      // Configured overrides hook.key
      keybindings['mod/cmd1'] = ['KeyX', 'KeyY'];
      expect(bar.commandKeys(cmd1)).toEqual(['KeyX', 'KeyY']);
      expect(bar.byKey('KeyX')).toBe(cmd1);
      expect(bar.byKey('KeyY')).toBe(cmd1);
      expect(bar.byKey('KeyU')).toBeUndefined();
    } finally {
      (globalThis as unknown as { document?: unknown }).document = prevDoc;
    }
  });

  it('filters active commands based on modal mode in CommandBar', () => {
    const prevDoc = (globalThis as unknown as { document?: unknown }).document;
    (globalThis as unknown as { document?: unknown }).document = {
      createElement: () => ({ append() {}, dataset: {}, title: '', type: '', hidden: false }),
    };
    const container = {
      addEventListener() {},
      replaceChildren() {},
      querySelectorAll: () => [],
      hidden: false,
    } as unknown as HTMLElement;
    const bar = new CommandBar(container, () => {});
    const cmdFlight = captureCommand('test.m', '1.0.0', { name: 'f', label: 'Flight', key: 'KeyF', context: 'flight', resolve: () => ({ throttle: 1 }) });
    const cmdEva = captureCommand('test.m', '1.0.0', { name: 'e', label: 'EVA', key: 'KeyE', context: 'eva', resolve: () => ({ throttle: 1 }) });
    const cmdAll = captureCommand('test.m', '1.0.0', { name: 'a', label: 'All', key: 'KeyA', context: 'all', resolve: () => ({ throttle: 1 }) });

    try {
      bar.sync([cmdFlight, cmdEva, cmdAll]);
      // Default mode is flight
      expect(bar.getMode()).toBe('flight');
      expect(bar.isCommandActive(cmdFlight)).toBe(true);
      expect(bar.isCommandActive(cmdEva)).toBe(false);
      expect(bar.isCommandActive(cmdAll)).toBe(true);
      expect(bar.byKey('KeyF')).toBe(cmdFlight);
      expect(bar.byKey('KeyE')).toBeUndefined();
      expect(bar.byKey('KeyA')).toBe(cmdAll);

      // Switch to eva mode
      bar.setMode('eva');
      expect(bar.getMode()).toBe('eva');
      expect(bar.isCommandActive(cmdFlight)).toBe(false);
      expect(bar.isCommandActive(cmdEva)).toBe(true);
      expect(bar.isCommandActive(cmdAll)).toBe(true);
      expect(bar.byKey('KeyF')).toBeUndefined();
      expect(bar.byKey('KeyE')).toBe(cmdEva);
      expect(bar.byKey('KeyA')).toBe(cmdAll);

      // Landed or flying player status switches to flight mode
      bar.setMode('landed');
      expect(bar.getMode()).toBe('flight');
      expect(bar.byKey('KeyF')).toBe(cmdFlight);
      expect(bar.byKey('KeyE')).toBeUndefined();
    } finally {
      (globalThis as unknown as { document?: unknown }).document = prevDoc;
    }
  });
});

