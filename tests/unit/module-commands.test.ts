import { describe, expect, it } from 'vitest';
import type { CommandHook, ModuleManifest, RegisteredModule } from '../../packages/game-api/src/index';
import { ModuleRegistry, captureCommand, captureCommands, commandArguments } from '../../packages/game-runtime/src/index';
import { prepareGame } from '../../packages/modules/src/index';
import { GAME_EXAMPLES } from '../../examples/modules/index';
import { HostSession, SessionError } from '../../packages/net/src/host';
import { PROTOCOL, ProtocolError, parseClientMessage } from '../../packages/net/src/protocol';
import { Game } from '../helpers/net-harness';
import { checkCommandKeys } from '../../apps/web/src/commands';

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
    const command = (key: string) => captureCommand('test.module', '1.0.0', { name: 'go', label: 'Go', key, resolve: () => ({ throttle: 1 }) });
    expect(() => checkCommandKeys([command('KeyP')])).toThrow('Module test.module command test.module/go: key P is reserved by the flight console');
    expect(() => checkCommandKeys([command('KeyV'), command('Digit1')])).not.toThrow();
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
});

describe('commands over the network', () => {
  it('parses command requests strictly and bumps the protocol', () => {
    expect(PROTOCOL).toBe('space-sim-net/5');
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
