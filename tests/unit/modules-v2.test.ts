import { describe, expect, it } from 'vitest';
import type { HostService, ManifestV2, ModuleInitializationV2, ModuleProfileV2, RegisteredModuleV2, ServiceKey, TextConnection } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, ModuleResolutionError, ModuleRuntimeV2, moduleAssets, validateManifestV2 } from '../../packages/game-runtime/src/index';

function manifest(id: string, extra: Partial<ManifestV2> = {}): ManifestV2 {
  return { format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', id, name: id, version: '1.0.0',
    kind: 'provider', tier: 'platform', environments: ['browser', 'offline', 'node'], dependencies: [], conflicts: [],
    provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'MIT', ...extra };
}
function profile(ids: string[], extra: Partial<ModuleProfileV2> = {}): ModuleProfileV2 {
  return { format: 'space-sim-profile/2', id: 'test.profile', modules: ids.map(id => ({ id, version: '1.0.0' })),
    providers: {}, capabilities: {}, settings: {}, ...extra };
}
function register(registry: ModuleRegistryV2, id: string, extra: Partial<ManifestV2> = {}, initialize: RegisteredModuleV2['initialize'] = () => {}) {
  registry.register({ manifest: manifest(id, extra), initialize });
}
const seats = { name: 'session.local-seats', version: '1.0.0' };
const session: ServiceKey<{ seats: number }> = { slot: 'session', version: '1.0.0' };
const serviceManifest: Partial<ManifestV2> = { slots: ['session'], provides: [{ name: 'session', version: '1.0.0' }], tier: 'network' };

describe('v2 metadata and capability resolution', () => {
  it('validates four tiers, exact provides, ranged needs, dotted slots and reserved engine declarations', () => {
    for (const tier of ['authoritative', 'presentation', 'platform', 'network'] as const) expect(validateManifestV2(manifest('test.module', { tier })).tier).toBe(tier);
    expect(validateManifestV2(manifest('test.module', { slots: ['ui.shell'], requires: [{ ...seats, version: '^1.0.0', optional: true }] })).slots).toEqual(['ui.shell']);
    for (const extra of [{ tier: 'other' }, { slots: ['core.world'] }, { slots: ['transport'] }, { provides: [{ ...seats, version: '^1.0.0' }] },
      { provides: [{ name: 'core.world', version: '1.0.0' }] }, { requires: [{ ...seats, version: 'one' }] }, { format: 'space-sim-module/1' },
      { provides: [seats, seats] }, { requires: [{ ...seats, optional: 'yes' }] }, { typo: 1 }]) {
      expect(() => validateManifestV2({ ...manifest('test.module'), ...extra })).toThrow();
    }
    const raw = manifest('test.module', { afterIfPresent: ['test.other'] }), checked = validateManifestV2(raw);
    (raw.afterIfPresent as string[]).push('test.another'); expect(checked.afterIfPresent).toEqual(['test.other']); expect(Object.isFrozen(checked.requires)).toBe(true);
  });
  it('orders capability providers first and records exact bindings independent of installation/profile order', () => {
    for (const ids of [['test.a-consumer', 'test.z-provider'], ['test.z-provider', 'test.a-consumer']]) {
      const registry = new ModuleRegistryV2();
      for (const id of ids) register(registry, id, id === 'test.z-provider' ? { tier: 'network', provides: [seats] } : { requires: [{ ...seats, version: '^1.0.0' }] });
      const lock = registry.resolve(profile(ids), 'node');
      expect(lock.order).toEqual(['test.z-provider', 'test.a-consumer']);
      expect(lock.capabilities['test.a-consumer']!['session.local-seats']).toEqual({ ...seats, provider: { id: 'test.z-provider', version: '1.0.0' } });
      expect(Object.isFrozen(lock.capabilities['test.a-consumer'])).toBe(true);
    }
  });
  it('suggests compatible installations without enabling them and requires an explicit ambiguous choice', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.split', { requires: [{ ...seats, version: '^1.0.0' }] });
    register(registry, 'test.seats-a', { provides: [seats] }); register(registry, 'test.seats-b', { provides: [seats] });
    register(registry, 'test.new-seats', { provides: [{ ...seats, version: '2.0.0' }] });
    try { registry.resolve(profile(['test.split']), 'node'); throw new Error('expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(ModuleResolutionError);
      expect((error as ModuleResolutionError).diagnostic.candidates.map(c => c.id)).toEqual(['test.seats-a', 'test.seats-b']);
      expect((error as Error).message).toContain('Enable test.seats-a or test.seats-b');
    }
    expect(() => registry.resolve(profile(['test.split', 'test.seats-a', 'test.seats-b']), 'node')).toThrow('Choose a compatible provider');
    const p = profile(['test.split', 'test.seats-a', 'test.seats-b'], { capabilities: { 'test.split': { 'session.local-seats': 'test.seats-b' } } });
    expect(registry.resolve(p, 'node').capabilities['test.split']!['session.local-seats']!.provider.id).toBe('test.seats-b');
  });
  it('keeps optional needs optional and enforces tier boundaries for IDs and capabilities', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.optional', { requires: [{ ...seats, optional: true }] });
    expect(registry.resolve(profile(['test.optional']), 'node').capabilities['test.optional']).toEqual({});
    register(registry, 'test.net', { tier: 'network', provides: [seats] });
    register(registry, 'test.authority', { tier: 'authoritative', dependencies: [{ id: 'test.net', version: '*' }] });
    register(registry, 'test.display', { tier: 'presentation', requires: [seats] });
    expect(() => registry.resolve(profile(['test.authority', 'test.net']), 'node')).toThrow('cannot depend');
    expect(() => registry.resolve(profile(['test.display', 'test.net']), 'node')).toThrow('needs session.local-seats');
    register(registry, 'test.data', { kind: 'data', provides: [seats] });
    expect(() => registry.resolve(profile(['test.display', 'test.data']), 'node')).toThrow('needs session.local-seats');
  });
  it('ignores inactive singleton capabilities and reports actual capability/ordering cycles', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.a', { slots: ['session'], provides: [seats] });
    register(registry, 'test.b', { slots: ['session'] });
    register(registry, 'test.user', { requires: [seats] });
    expect(() => registry.resolve(profile(['test.a', 'test.b', 'test.user'], { providers: { session: 'test.b' } }), 'node')).toThrow('needs session.local-seats');
    register(registry, 'test.cycle-a', { provides: [seats], after: ['test.cycle-b'] });
    register(registry, 'test.cycle-b', { requires: [seats] });
    try { registry.resolve(profile(['test.cycle-a', 'test.cycle-b']), 'node'); throw new Error('expected failure'); }
    catch (error) { expect((error as ModuleResolutionError).diagnostic.chain?.join(' ')).toContain('capability session.local-seats'); }
    register(registry, 'test.strict', { after: ['test.absent'] }); register(registry, 'test.soft', { afterIfPresent: ['test.absent'] });
    expect(() => registry.resolve(profile(['test.strict']), 'node')).toThrow('not enabled');
    expect(registry.resolve(profile(['test.soft']), 'node').order).toEqual(['test.soft']);
  });
  it('validates versions, environments, conflicts, settings and stale capability choices before initialization', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.a', { environments: ['node'], conflicts: [{ id: 'test.b', version: '^1.0.0' }],
      settings: { gain: { type: 'number', default: 1, minimum: 0, maximum: 2 } } }); register(registry, 'test.b');
    expect(() => registry.resolve(profile(['test.a']), 'browser')).toThrow('cannot run');
    expect(() => registry.resolve(profile(['test.a', 'test.b']), 'node')).toThrow('conflicts');
    expect(() => registry.resolve(profile(['test.a'], { modules: [{ id: 'test.a', version: '2.0.0' }] }), 'node')).toThrow('installed 1.0.0');
    expect(() => registry.resolve(profile(['test.a'], { settings: { 'test.a': { gain: 3 } } }), 'node')).toThrow('between');
    expect(() => registry.resolve(profile(['test.a'], { settings: { 'test.a': { gain: NaN } } }), 'node')).toThrow('finite');
    expect(() => registry.resolve(profile(['test.a'], { capabilities: { 'test.a': { undeclared: 'test.b' } } }), 'node')).toThrow('does not declare');
  });
});

describe('v2 candidate services and lifecycle', () => {
  it('binds typed selected services and rejects undeclared access, late registration and incompatible versions', () => {
    const registry = new ModuleRegistryV2(); let captured: ModuleInitializationV2 | undefined, count = 0;
    register(registry, 'test.session', serviceManifest, c => c.provide(session, { seats: 4 }));
    register(registry, 'test.split', { requires: [{ name: 'session', version: '^1.0.0' }] }, c => { captured = c; count = c.use(session).seats; });
    const candidate = registry.prepare(profile(['test.split', 'test.session']), 'node'); expect(count).toBe(4);
    expect(() => captured!.provide(session, { seats: 1 })).toThrow('sealed'); candidate.dispose();
    register(registry, 'test.undeclared', {}, c => c.use(session));
    expect(() => registry.prepare(profile(['test.undeclared', 'test.session']), 'node')).toThrow('undeclared');
    register(registry, 'test.wrong-version', { requires: [{ name: 'session', version: '*' }] }, c => c.use({ ...session, version: '2.0.0' }));
    expect(() => registry.prepare(profile(['test.wrong-version', 'test.session']), 'node')).toThrow('incompatible');
  });
  it('returns optional absence only for valid unbound declarations and keeps strict access strict', () => {
    const registry = new ModuleRegistryV2(); let captured!: ModuleInitializationV2;
    register(registry, 'test.optional-access', { requires: [{ name: 'session', version: '^1.0.0', optional: true }] }, c => {
      captured = c; expect(c.tryUse(session)).toBeUndefined();
      expect(() => c.use(session)).toThrow('undeclared');
      expect(() => c.tryUse({ ...session, version: '2.0.0' })).toThrow('incompatible');
      expect(() => c.tryUse({ ...session, slot: 'not declared' })).toThrow();
      expect(() => c.tryUse({ ...session, version: '*' })).toThrow();
    });
    const candidate = registry.prepare(profile(['test.optional-access']), 'node');
    expect(() => captured.tryUse(session)).toThrow('sealed'); candidate.dispose();
    register(registry, 'test.undeclared-optional', {}, c => c.tryUse(session));
    expect(() => registry.prepare(profile(['test.undeclared-optional']), 'node')).toThrow('undeclared');
    register(registry, 'test.required-optional', { requires: [{ name: 'session', version: '*' }] }, c => c.tryUse(session));
    register(registry, 'test.session', serviceManifest, c => c.provide(session, { seats: 1 }));
    expect(() => registry.prepare(profile(['test.required-optional', 'test.session']), 'node')).toThrow('optional service');
  });
  it('supports compatible optional substitution and disposes enhancements on graph replacement', () => {
    const registry = new ModuleRegistryV2(), runtime = new ModuleRuntimeV2(registry, 'node');
    const closed: number[] = []; let received: number | undefined;
    for (const [id, seats] of [['test.session-a', 1], ['test.session-b', 4]] as const)
      register(registry, id, serviceManifest, c => c.provide(session, { seats }));
    register(registry, 'test.optional-access', { requires: [{ name: 'session', version: '^1.0.0', optional: true }] }, c => {
      const bound = c.tryUse(session); received = bound?.seats;
      if (bound) c.own({ dispose() { closed.push(bound.seats); } });
    });
    for (const [id, count] of [['test.session-a', 1], ['test.session-b', 4], [undefined, undefined]] as const) {
      const candidate = runtime.prepare(profile(['test.optional-access', ...id ? [id] : []], id ? { providers: { session: id } } : {}));
      runtime.activate(candidate); expect(received).toBe(count);
    }
    expect(closed).toEqual([1, 4]); runtime.dispose();
  });
  it('does not disguise broken, ambiguous or explicitly invalid optional providers as absence', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.optional-access', { requires: [{ name: 'session', version: '^1.0.0', optional: true }] }, c => c.tryUse(session));
    register(registry, 'test.broken', { provides: [{ name: 'session', version: '1.0.0' }] });
    register(registry, 'test.other', { provides: [{ name: 'session', version: '1.0.0' }] }, c => c.provide(session, { seats: 2 }));
    expect(() => registry.prepare(profile(['test.optional-access', 'test.broken']), 'node')).toThrow('not available from test.broken');
    expect(() => registry.prepare(profile(['test.optional-access', 'test.broken', 'test.other']), 'node')).toThrow('Choose');
    expect(() => registry.prepare(profile(['test.optional-access'], { capabilities: { 'test.optional-access': { session: 'test.other' } } }), 'node')).toThrow();
  });
  it('restricts reserved engine façades to declared needs, allowed tiers and environments', () => {
    const world: HostService = { key: { slot: 'core.world', version: '1.0.0' }, service: { name: 'world' }, tiers: ['network'], environments: ['node'] };
    const registry = new ModuleRegistryV2([world]); let received: unknown;
    register(registry, 'test.host', { tier: 'network', requires: [{ name: 'core.world', version: '^1.0.0' }] }, c => { received = c.use(world.key); });
    const candidate = registry.prepare(profile(['test.host']), 'node'); expect(received).toBe(world.service); candidate.dispose();
    expect(() => registry.resolve(profile(['test.host']), 'browser')).toThrow('needs core.world');
    register(registry, 'test.instrument', { tier: 'presentation', requires: [{ name: 'core.world', version: '*' }] });
    expect(() => registry.resolve(profile(['test.instrument']), 'node')).toThrow('needs core.world');
  });
  it('preserves the active candidate, disposes failed resources in reverse order and rejects async initialization', async () => {
    const registry = new ModuleRegistryV2(), runtime = new ModuleRuntimeV2(registry, 'node'), closed: number[] = [];
    register(registry, 'test.old'); register(registry, 'test.good');
    register(registry, 'test.bad', {}, c => { c.own({ dispose() { closed.push(1); } }); c.own({ dispose() { closed.push(2); throw new Error('cleanup failed'); } }); throw new Error('prepare failed'); });
    const old = runtime.prepare(profile(['test.old'])); runtime.activate(old);
    expect(() => runtime.prepare(profile(['test.bad']))).toThrow('prepare failed'); expect(closed).toEqual([2, 1]); expect(runtime.active).toBe(old); expect(old.available).toBe(true);
    register(registry, 'test.async', {}, async c => { await Promise.resolve(); c.contributeActions([]); });
    expect(() => runtime.prepare(profile(['test.async']))).toThrow('synchronous'); await Promise.resolve();
    const good = runtime.prepare(profile(['test.good'])); runtime.activate(good); expect(old.available).toBe(false);
    runtime.dispose(); runtime.dispose(); expect(good.available).toBe(false);
  });
  it('copies declared assets and rejects invalid UTF-8 and unavailable object URLs', () => {
    const bytes = new TextEncoder().encode('hello'), assets = moduleAssets(new Map([['assets/text', bytes], ['assets/bad', new Uint8Array([255])]]));
    bytes[0] = 0; const read = assets.bytes('assets/text'); read[0] = 0;
    expect(assets.text('assets/text')).toBe('hello'); expect(() => assets.text('../private')).toThrow('Unsafe');
    expect(() => assets.text('assets/missing')).toThrow('Undeclared'); expect(() => assets.text('assets/bad')).toThrow(); expect(() => assets.url('assets/text')).toThrow('browser');
  });
});

function peer(): TextConnection & { closes: number } {
  return { label: 'test', bufferedAmount: 0, onmessage: null, onclose: null, closes: 0, send() {}, close() { this.closes++; } };
}
describe('v2 contributions', () => {
  it('clamps successful samples and rejects a retained sink outside sampling', () => {
    const registry = new ModuleRegistryV2(); let retained!: { set(action: string, value: number): void };
    register(registry, 'test.keys', {}, context => {
      context.contributeActions([{ id: 'test.keys/engine', label: 'Engine', category: 'flight', mode: 'held', defaultKeys: [] }]);
      context.contributeInput({ name: 'keyboard', sample(_frame, sink) { retained = sink; sink.set('test.keys/engine', 3); }, release() {}, dispose() {} });
    });
    const candidate = registry.prepare(profile(['test.keys']), 'node'), values: number[] = [];
    candidate.contributions('input')[0]!.value.sample({ elapsed: .01, pilot: 0, flightAllowed: true, shortcutsAllowed: true }, { set(_action, value) { values.push(value); } });
    expect(values).toEqual([1]); expect(() => retained.set('test.keys/engine', 1)).toThrow('outside'); candidate.dispose();
  });
  it('coexists across input/transports, clamps input and releases a failed source once', () => {
    const registry = new ModuleRegistryV2(); let released = 0, closed = 0;
    register(registry, 'test.keys', {}, c => {
      c.contributeActions([{ id: 'test.keys/engine', label: 'Engine', category: 'flight', mode: 'held', defaultKeys: ['Space'] }]);
      c.contributeInput({ name: 'keyboard', sample(_frame, sink) { sink.set('test.keys/engine', 3); throw new Error('sample failed'); }, release() { released++; }, dispose() { closed++; } });
    });
    register(registry, 'test.net', { tier: 'network' }, c => {
      for (const name of ['websocket', 'tab']) c.contributeTransport({ name, schemes: [name], async connect() { return peer(); } });
    });
    const candidate = registry.prepare(profile(['test.keys', 'test.net']), 'node'), input = candidate.contributions('input')[0]!.value, values: number[] = [];
    const frame = { elapsed: .01, pilot: 0, flightAllowed: true, shortcutsAllowed: true };
    input.sample(frame, { set(_action, value) { values.push(value); } }); input.sample(frame, { set() { throw new Error('disabled'); } });
    expect(values).toEqual([]); expect(released).toBe(1); expect(closed).toBe(1); expect(candidate.hooks.faults[0]!.message).toBe('sample failed');
    expect(candidate.contributions('transport')).toHaveLength(2); candidate.dispose(); expect(closed).toBe(1);
  });
  it('rejects wrong-tier hooks, unknown window actions, duplicate controls and effect conflicts', () => {
    for (const initialize of [
      (c: ModuleInitializationV2) => c.contributeTransport({ name: 'ws', schemes: ['ws'], async connect() { return peer(); } }),
      (c: ModuleInitializationV2) => c.contributeWindow({ name: 'window', title: 'Window', controls: [{ kind: 'button', id: 'go', label: 'Go', action: 'test.module/unknown' }] }),
      (c: ModuleInitializationV2) => c.contributeWindow({ name: 'window', title: 'Window', controls: [{ kind: 'text', id: 'same', text: 'a' }, { kind: 'text', id: 'same', text: 'b' }] }),
    ]) { const registry = new ModuleRegistryV2(); register(registry, 'test.module', {}, initialize); expect(() => registry.prepare(profile(['test.module']), 'node')).toThrow(); }
    const registry = new ModuleRegistryV2(), assets = moduleAssets(new Map([['assets/fragment.glsl', new TextEncoder().encode('void main() {}')]]));
    registry.register({ manifest: manifest('test.effects', { tier: 'presentation' }), initialize(c) {
      for (const name of ['one', 'two']) c.contributeMaterial({ name, bodyIds: ['planet'], fragmentAsset: 'assets/fragment.glsl', uniforms: {} });
    } }, assets);
    expect(() => registry.prepare(profile(['test.effects']), 'node')).toThrow('conflicting materials');
  });
  it('closes late connections and listeners when the candidate is disposed during pending IO', async () => {
    const registry = new ModuleRegistryV2(); let resolvePeer!: (value: TextConnection) => void, signal: AbortSignal | undefined, listenerCloses = 0;
    let resolveListener!: (value: { dispose(): void }) => void;
    register(registry, 'test.net', { tier: 'network' }, c => c.contributeTransport({ name: 'ws', schemes: ['ws'],
      connect(_address, s) { signal = s; return new Promise(resolve => { resolvePeer = resolve; }); },
      listen() { return new Promise(resolve => { resolveListener = resolve; }); },
    }));
    const candidate = registry.prepare(profile(['test.net']), 'node'), transport = candidate.contributions('transport')[0]!.value;
    const connecting = transport.connect('ws://local', new AbortController().signal), listening = transport.listen!('ws://local', () => {}, new AbortController().signal);
    const rejectedConnection = expect(connecting).rejects.toThrow('cancelled'), rejectedListener = expect(listening).rejects.toThrow('cancelled');
    candidate.dispose(); expect(signal!.aborted).toBe(true);
    const p = peer(); resolvePeer(p); resolveListener({ dispose() { listenerCloses++; } });
    await Promise.all([rejectedConnection, rejectedListener]); expect(p.closes).toBe(1); expect(listenerCloses).toBe(1);
  });
  it('cancels established transport lifetimes, detaches on peer close and rejects late accepts', async () => {
    const registry = new ModuleRegistryV2(), peers: ReturnType<typeof peer>[] = []; let listenerCloses = 0, accept!: (peer: TextConnection) => void;
    register(registry, 'test.net', { tier: 'network' }, c => c.contributeTransport({ name: 'ws', schemes: ['ws'],
      async connect() { const p = peer(); peers.push(p); return p; },
      async listen(_address, receive) { accept = receive; return { dispose() { listenerCloses++; } }; },
    }));
    const candidate = registry.prepare(profile(['test.net']), 'node'), transport = candidate.contributions('transport')[0]!.value;
    const firstSignal = new AbortController(), first = await transport.connect('ws://local', firstSignal.signal);
    firstSignal.abort(); expect(peers[0]!.closes).toBe(1); expect(() => first.send('late')).toThrow('closed');
    const secondSignal = new AbortController(), second = await transport.connect('ws://local', secondSignal.signal);
    let closed = ''; second.onclose = reason => { closed = reason; }; peers[1]!.onclose?.('remote closed'); secondSignal.abort();
    expect(closed).toBe('remote closed'); expect(peers[1]!.closes).toBe(0); expect(() => second.send('late')).toThrow('closed');
    const listeningSignal = new AbortController(); await transport.listen!('ws://local', () => { throw new Error('must not accept'); }, listeningSignal.signal);
    listeningSignal.abort(); expect(listenerCloses).toBe(1); const late = peer(); accept(late); expect(late.closes).toBe(1);
    candidate.dispose(); expect(listenerCloses).toBe(1); expect(peers.map(p => p.closes)).toEqual([1, 0]);
  });
  it('isolates discovery validation faults and never emits after cancellation', async () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.discovery', { tier: 'network' }, c => c.contributeDiscovery({ name: 'lan', async scan(emit) {
      emit({ id: 'local', name: 'Local', address: 'ws://local', players: -1, maxPlayers: 4, protocol: '1' });
    } }));
    const candidate = registry.prepare(profile(['test.discovery']), 'node');
    await expect(candidate.contributions('discovery')[0]!.value.scan(() => { throw new Error('must not emit'); }, new AbortController().signal)).rejects.toThrow('player counts');
    expect(candidate.hooks.faults[0]!.kind).toBe('discovery'); candidate.dispose();
  });
});

describe('v2 cleanup and captured declarations', () => {
  it('cleans late async allocations and captures resource disposal once', async () => {
    const registry = new ModuleRegistryV2(); let closes = 0;
    register(registry, 'test.late', {}, async c => { await Promise.resolve(); c.own({ dispose() { closes++; } }); });
    expect(() => registry.prepare(profile(['test.late']), 'node')).toThrow('synchronous'); await Promise.resolve(); expect(closes).toBe(1);
    register(registry, 'test.once', {}, c => {
      const resource = { dispose() { closes++; } }; c.own(resource); c.own(resource);
      resource.dispose = () => { throw new Error('changed after capture'); };
    });
    const candidate = registry.prepare(profile(['test.once']), 'node'); candidate.dispose(); candidate.dispose(); expect(closes).toBe(2);
  });
  it('resolves capability names that shadow Object.prototype', () => {
    const registry = new ModuleRegistryV2();
    register(registry, 'test.provider', { provides: [{ name: 'constructor', version: '1.0.0' }] });
    register(registry, 'test.consumer', { requires: [{ name: 'constructor', version: '*' }] });
    expect(registry.resolve(profile(['test.consumer', 'test.provider']), 'node').order).toEqual(['test.provider', 'test.consumer']);
  });
  it('isolates a late listener callback fault and closes every connection from that provider', async () => {
    const registry = new ModuleRegistryV2(); let receive!: (peer: TextConnection) => void, listenersClosed = 0;
    register(registry, 'test.net', { tier: 'network' }, c => c.contributeTransport({ name: 'ws', schemes: ['ws'], async connect() { return peer(); },
      async listen(_address, accept) { receive = accept; return { dispose() { listenersClosed++; } }; },
    }));
    const candidate = registry.prepare(profile(['test.net']), 'node'), transport = candidate.contributions('transport')[0]!.value;
    const connection = await transport.connect('ws://local', new AbortController().signal);
    const listening = await transport.listen!('ws://local', () => { throw new Error('accept failed'); }, new AbortController().signal);
    const incoming = peer(); expect(() => receive(incoming)).not.toThrow(); expect(incoming.closes).toBe(1); expect(listenersClosed).toBe(1);
    expect(candidate.hooks.faults[0]!.message).toBe('accept failed'); expect(() => connection.send('closed')).toThrow('closed');
    const late = peer(); receive(late); expect(late.closes).toBe(1); listening.dispose(); candidate.dispose(); expect(listenersClosed).toBe(1);
  });
  it('detaches and freezes window declarations and sorts post effects before exposing a sealed candidate', () => {
    const registry = new ModuleRegistryV2(), assets = moduleAssets(new Map([['assets/fragment.glsl', new TextEncoder().encode('void main() {}')]]));
    const controls = [{ kind: 'text' as const, id: 'hello', text: 'Hello' }];
    register(registry, 'test.ui', {}, c => c.contributeWindow({ name: 'ui', title: 'UI', controls }));
    registry.register({ manifest: manifest('test.effects', { tier: 'presentation' }), initialize(c) {
      c.contributePostEffect({ name: 'last', fragmentAsset: 'assets/fragment.glsl', after: ['test.effects/first'], scale: 1, uniforms: {} });
      c.contributePostEffect({ name: 'first', fragmentAsset: 'assets/fragment.glsl', after: [], scale: .5, uniforms: {} });
    } }, assets);
    const candidate = registry.prepare(profile(['test.effects', 'test.ui']), 'node'); controls[0]!.text = 'Changed';
    expect(candidate.contributions('window')[0]!.value.controls[0]).toMatchObject({ text: 'Hello' });
    expect(candidate.contributions('post').map(p => p.id)).toEqual(['test.effects/first', 'test.effects/last']);
    expect(candidate.renderEffects().post.map(effect => [effect.id,effect.fragment])).toEqual([['test.effects/first','void main() {}'],['test.effects/last','void main() {}']]);
    candidate.dispose(); expect(candidate.effectSources.size).toBe(0); expect(() => candidate.renderEffects()).toThrow('disposed');
  });
});

describe('v2 imported declarations', () => {
  it('accepts only bounded structured Manual assets that match the declared page', () => {
    const page = { id: 'help', audience: 'creators' as const, title: 'Help', summary: 'Example', asset: 'docs/creators/help.json' };
    const document = { id: 'help', audience: 'creators', title: 'Help', summary: 'Example', blocks: [{ type: 'paragraph', text: 'Plain text' }] };
    const prepare = (text: string, tier: ManifestV2['tier'] = 'platform') => {
      const registry = new ModuleRegistryV2();
      registry.register({ manifest: manifest('test.guides', { tier }), initialize(c) { c.contributeGuide(page); } }, moduleAssets(new Map([[page.asset, new TextEncoder().encode(text)]])));
      return registry.prepare(profile(['test.guides']), 'node');
    };
    const good = prepare(JSON.stringify(document)); expect(good.contributions('guide')[0]!.id).toBe('test.guides/help'); good.dispose();
    for (const tier of ['network', 'authoritative', 'presentation'] as const) {
      const headless = prepare(JSON.stringify(document), tier);
      expect(headless.guideDocuments.get('test.guides/help')).toBe(JSON.stringify(document)); headless.dispose();
    }
    expect(() => prepare(JSON.stringify({ ...document, audience: 'players' }))).toThrow('mismatch');
    expect(() => prepare(JSON.stringify({ ...document, blocks: [{ type: 'html', text: '<script>bad()</script>' }] }))).toThrow('Unsupported guide block');
    expect(() => prepare(JSON.stringify({ ...document, blocks: [{ type: 'paragraph', text: 'x'.repeat(65536) }] }))).toThrow('64 KiB');
  });
  it('rejects cyclic post effects before an active candidate can be replaced', () => {
    const registry = new ModuleRegistryV2();
    registry.register({ manifest: manifest('test.effects', { tier: 'presentation' }), initialize(c) {
      for (const [name, after] of [['a', 'test.effects/b'], ['b', 'test.effects/a']]) c.contributePostEffect({ name: name!, after: [after!], scale: 1, fragmentAsset: 'assets/f.glsl', uniforms: {} });
    } }, moduleAssets(new Map([['assets/f.glsl', new TextEncoder().encode('void main() {}')]])));
    expect(() => registry.prepare(profile(['test.effects']), 'node')).toThrow('ordering cycle');
  });
});

describe('complete dependency edit previews', () => {
  it('includes transitive ID and capability dependencies, requiring explicit ambiguous choices', async () => {
    const { previewModulesV2 } = await import('../../packages/game-runtime/src/preview-v2');
    const manifests = new Map([
      manifest('test.input', { dependencies: [{ id: 'test.actions', version: '^1.0.0' }], requires: [seats] }),
      manifest('test.actions'), manifest('test.session', { provides: [seats], dependencies: [{ id: 'test.protocol', version: '*' }] }),
      manifest('test.protocol'),
    ].map(m => [m.id, m]));
    const preview = previewModulesV2(manifests, profile(['test.input']), undefined, 'node', { includeDependencies: true });
    expect(preview.lock.order).toEqual(['test.actions', 'test.protocol', 'test.session', 'test.input']);
    expect(preview.dependencies).toContainEqual({ requester: 'test.input', provider: 'test.session', reason: 'session.local-seats@1.0.0' });
    manifests.set('test.other-session', manifest('test.other-session', { provides: [seats] }));
    expect(() => previewModulesV2(manifests, profile(['test.input']), undefined, 'node', { includeDependencies: true })).toThrow('Enable test.other-session or test.session');
    const chosen = previewModulesV2(manifests, profile(['test.input'], { capabilities: { 'test.input': { 'session.local-seats': 'test.session' } } }), undefined, 'node', { includeDependencies: true });
    expect(chosen.lock.capabilities['test.input']!['session.local-seats']!.provider.id).toBe('test.session');
  });
  it('previews reverse removals, provider replacement and conflicts without changing the applied graph', async () => {
    const { previewModulesV2, removeModuleDependents } = await import('../../packages/game-runtime/src/preview-v2');
    const manifests = new Map([
      manifest('test.session', { ...serviceManifest, provides: [seats] }), manifest('test.replacement', { ...serviceManifest, provides: [seats] }),
      manifest('test.split', { requires: [seats] }), manifest('test.hud', { dependencies: [{ id: 'test.split', version: '*' }] }),
      manifest('test.conflict', { conflicts: [{ id: 'test.split', version: '*' }] }),
    ].map(m => [m.id, m]));
    const original = profile(['test.session', 'test.split', 'test.hud']);
    const applied = previewModulesV2(manifests, original, undefined, 'node').lock;
    const removed = removeModuleDependents(manifests, profile(['test.split', 'test.hud']), applied);
    expect(removed.modules).toEqual([]);
    expect(previewModulesV2(manifests, removed, applied, 'node').removed).toEqual(['test.session', 'test.split', 'test.hud']);
    const replaced = profile(['test.replacement', 'test.split', 'test.hud'], { providers: { session: 'test.replacement' } });
    expect(removeModuleDependents(manifests, replaced, applied).modules).toEqual(replaced.modules);
    const preview = previewModulesV2(manifests, replaced, applied, 'node');
    expect(preview.providerChanges).toEqual(['session']); expect(preview.restartRequired).toBe(true);
    expect(() => previewModulesV2(manifests, profile(['test.session', 'test.split', 'test.conflict']), applied, 'node')).toThrow('conflicts');
    expect(applied.modules.map(m => m.id)).toEqual(['test.session', 'test.split', 'test.hud']);
  });
});
