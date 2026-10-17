import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildModule, inspectAuthorSource } from '../../packages/module-tools/author.mjs';
import { artifactDigest, enableCodeArtifact, parseCodeArtifact, ModuleRegistry, type CodeArtifact } from '../../packages/game-runtime/src/index';
import { DEFAULT_PROFILE, loadInstalledWorld, prepareGame } from '../../packages/modules/src/index';
import { ModuleLibrary } from '../../apps/web/src/module-library';
import { steadyLift } from '../../examples/modules/motion';
import { saveWorld } from '../../packages/sim-core/src/save';
import { ClientSession } from '../../packages/net/src/client';
import { HostSession } from '../../packages/net/src/host';
import { loopback } from '../../packages/net/src/connection';
import { startServer } from '../../apps/server/src/server';

const artifacts = new Map<string, CodeArtifact>();
let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-sim-code-tests-'));
  for (const name of ['force', 'numerical', 'telemetry', 'state']) artifacts.set(name,
    await buildModule(resolve(`examples/modules/${name}/module.json`), undefined, { typecheck: false }));
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
function artifact(name = 'force') { return artifacts.get(name)!; }
function edit(changes: Partial<CodeArtifact>, name = 'force'): CodeArtifact {
  const { digest: _, ...body } = { ...artifact(name), ...changes };
  return { ...body, digest: artifactDigest(body) };
}
function prepared(name = 'force', environment: 'browser' | 'offline' | 'node' = 'node') {
  const module = enableCodeArtifact(artifact(name), environment);
  return prepareGame({ environment, code: [module], profile: { ...DEFAULT_PROFILE, id: 'local.test',
    modules: [...DEFAULT_PROFILE.modules, { id: module.manifest.id, version: module.manifest.version }],
    providers: { ...DEFAULT_PROFILE.providers, ...(name === 'numerical' ? { dynamics: module.manifest.id } : {}) } } });
}

describe('local code artifact contract', () => {
  it('builds the same package bytes twice, embeds assets and preserves attribution', async () => {
    expect(await buildModule(resolve('examples/modules/force/module.json'), undefined, { typecheck: false })).toEqual(artifact());
    expect(parseCodeArtifact(JSON.stringify(artifact('telemetry'))).assets['color.txt']).toBe('#55ccff\n');
    expect(artifact().inputs.some(i => i.path === 'game-api/index.ts')).toBe(true);
    expect(artifact().inputs.every(i => i.attribution.length > 0 && i.sha256.length === 64)).toBe(true);
  });
  it('never executes code while inspecting/installing and defers source to explicit initialization', () => {
    const global = globalThis as typeof globalThis & { moduleWasExecuted?: number };
    const changed = edit({ manifest: { ...artifact().manifest, dependencies: [], requires: [] }, source: 'globalThis.moduleWasExecuted = 1; var SpaceSimModule = { default: () => {} };' });
    const library = new ModuleLibrary();
    library.install(JSON.stringify(changed));
    const registry = new ModuleRegistry();
    for (const module of library.modules('node')) registry.register(module);
    const profile = { ...DEFAULT_PROFILE, modules: [{ id: changed.manifest.id, version: changed.manifest.version }], providers: {} };
    registry.resolve(profile, 'node');
    expect(() => library.requireProfile(profile, undefined)).toThrow('exact code requirement');
    expect(library.requireProfile(profile, undefined, [{ id: changed.manifest.id, version: changed.manifest.version, digest: changed.digest }])).toBe(true);
    expect(global.moduleWasExecuted).toBeUndefined();
    registry.prepare(profile, 'node').dispose();
    expect(global.moduleWasExecuted).toBe(1);
    delete global.moduleWasExecuted;
    expect(() => library.install(JSON.stringify(changed))).toThrow('already installed');
    library.remove(changed.manifest.id);
    expect(library.artifacts).toHaveLength(0);
  });
  it('rejects tampering, unsafe paths, oversized source, invalid dependencies, licenses and asset metadata without executing', () => {
    expect(() => parseCodeArtifact(JSON.stringify({ ...artifact(), source: 'throw 1' }))).toThrow('digest mismatch');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ assets: { '../bad.txt': 'bad' } })))).toThrow('Unsafe artifact path');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ assets: { 'bad.txt': 'bad' } })))).toThrow('matching licensed input');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ source: 'x'.repeat(4 * 1024 * 1024) })))).toThrow('4 MiB');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ inputs: [{ ...artifact().inputs[0]!, license: 'GPL-3.0' }] })))).toThrow('not approved');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ compatibility: { deterministic: false, multiplayer: true } })))).toThrow('determinism');
    expect(() => parseCodeArtifact(JSON.stringify(edit({ manifest: { ...artifact().manifest, dependencies: [{ id: 'local.foo', version: 'oops' }] } })))).toThrow('version range');
    expect(() => enableCodeArtifact(artifact('telemetry'), 'node')).toThrow('unsupported environment');
  });
  it('checks source boundaries, type-only imports, missing assets and vendored license terms', async () => {
    for (const source of ['import(name)', "require('node:fs')", "import x = require('x')"])
      expect(() => inspectAuthorSource(source, 'main.ts')).toThrow('unsupported');
    const config = JSON.parse(await readFile('examples/modules/force/module.json', 'utf8'));
    const configPath = join(directory, 'module.json');
    await writeFile(configPath, JSON.stringify({ ...config, entry: '../private.ts' }));
    await expect(buildModule(configPath, undefined, { typecheck: false })).rejects.toThrow('Unsafe artifact path');
    await writeFile(configPath, JSON.stringify(config));
    await writeFile(join(directory, 'main.ts'), `import type { World } from '${resolve('packages/sim-core/src/world')}'; export default () => {};`);
    await expect(buildModule(configPath, undefined, { typecheck: false })).rejects.toThrow('Unsupported import');
    await writeFile(join(directory, 'main.ts'), 'export default () => {};');
    await writeFile(configPath, JSON.stringify({ ...config, assets: ['absent.txt'] }));
    await expect(buildModule(configPath, undefined, { typecheck: false })).rejects.toThrow();
    await writeFile(configPath, JSON.stringify({ ...config, inputs: { 'main.ts': { license: 'UNKNOWN', attribution: 'unknown' } } }));
    await expect(buildModule(configPath, undefined, { typecheck: false })).rejects.toThrow('not approved');
  });
  it('bundles runtime public API imports without external code or network dependencies', async () => {
    const root = join(directory, 'public-math'); await mkdir(root);
    const config = JSON.parse(await readFile('examples/modules/force/module.json', 'utf8'));
    await writeFile(join(root, 'module.json'), JSON.stringify(config));
    await writeFile(join(root, 'main.ts'), `import { deterministicMath } from '@space-sim/game-api';
      import type { ModuleInitialization } from '@space-sim/game-api';
      export default function initialize(context: ModuleInitialization) {
        context.contributeForce({ modelIdentity: 'math-test/v1', initialState: { version: 1, value: 0 },
          evaluate: () => ({ x: deterministicMath.sin(0), y: deterministicMath.cos(0) * 2 }) });
      }`);
    const built = await buildModule(join(root, 'module.json'), undefined, { typecheck: false });
    const module = enableCodeArtifact(built, 'offline');
    const game = prepareGame({ environment: 'offline', code: [module], profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, { id: module.manifest.id, version: module.manifest.version }] } });
    expect(game.candidate.forceExtensions[0]!.hook.evaluate({} as any)).toEqual({ x: 0, y: 2 });
    game.candidate.dispose();
  });
  it('keeps the active world after missing dependencies or initializer failure and disposes owned resources', () => {
    const game = prepared();
    const bad = enableCodeArtifact(edit({ source: 'var SpaceSimModule = { default: context => { context.own({dispose(){globalThis.disposedCandidate = true}}); throw new Error("bad init") } };' }), 'node');
    expect(() => prepareGame({ environment: 'node', code: [bad], profile: game.profile })).toThrow('bad init');
    expect((globalThis as any).disposedCandidate).toBe(true);
    delete (globalThis as any).disposedCandidate;
    expect(game.candidate.available).toBe(true);
    expect(() => prepareGame({ environment: 'node', code: [enableCodeArtifact(edit({ manifest: { ...artifact().manifest,
      dependencies: [{ id: 'absent.library', version: '1.0.0' }] } }), 'node')], profile: game.profile })).toThrow('missing dependency');
    game.candidate.dispose();
  });
});

describe('imported authoritative modules', () => {
  it('uses the public force example identically on browser/offline/Node adapters, saves and prediction', () => {
    const games = ['browser', 'offline', 'node'].map(environment => prepared('force', environment as 'node'));
    const reference = prepareGame({ environment: 'node', code: [steadyLift], profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, { id: steadyLift.manifest.id, version: steadyLift.manifest.version }] } });
    for (const game of [...games, reference]) {
      const ship = game.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
      game.world.setControls(ship.id, { turn: .2, throttle: 0, engine: true });
    }
    for (let tick = 0; tick < 100; tick++) for (const game of [...games, reference]) game.world.step();
    const strip = (game: typeof games[number]) => { const { moduleState: _, ...state } = game.world.ships()[0]!.state; return state; };
    for (const game of games) {
      expect(strip(game)).toEqual(strip(reference));
      expect(game.world.context.capabilities.rails).toBe(false);
      expect(game.world.simulationFingerprint).toBe(games[0]!.world.simulationFingerprint);
    }
    const world = games[0]!.world, clone = world.cloneForPrediction(), saved = saveWorld(world);
    for (let tick = 0; tick < 25; tick++) { clone.step(); world.step(); }
    expect(clone.ships()).toEqual(world.ships());
    const loaded = loadInstalledWorld(saved, { environment: 'node', code: [enableCodeArtifact(artifact(), 'node')] });
    loaded.world.setControls('ship-1', world.ships()[0]!.controls);
    for (let tick = 0; tick < 25; tick++) loaded.world.step();
    expect(loaded.world.ships()).toEqual(world.ships());
    expect(() => loadInstalledWorld(saved, { environment: 'node' })).toThrow('not installed');
    const altered = structuredClone(saved) as any; altered.universe.systems[0].vehicleDefaults = { acceleration: 333 };
    expect(() => loadInstalledWorld(altered, { environment: 'node', code: [enableCodeArtifact(artifact(), 'node')] })).toThrow('differ');
    const changed = edit({ source: artifact().source + '\n// changed package' });
    expect(() => loadInstalledWorld(saved, { environment: 'node', code: [enableCodeArtifact(changed, 'node')] })).toThrow('differ');
    clone.dispose(); loaded.world.dispose(); for (const game of [...games, reference]) game.candidate.dispose();
  });
  it('keeps palette-only data outside a modded physical fingerprint and save requirements', () => {
    const game = prepared();
    const palette = { format: 'space-sim-data-module/1' as const,
      manifest: { ...artifact().manifest, id: 'local.palette', kind: 'data' as const, authority: 'presentation' as const,
        dependencies: [{ id: 'builtin.content', version: '0.1.0' }], requires: [], settings: {} },
      data: { appearance: [{ universe: 'builtin.content/default-universe', system: 'primus-system', body: 'planet',
        override: true as const, colors: { color: '#ff0055' } }] } };
    const plain = prepareGame({ environment: 'node' }), paletteOnly = prepareGame({ environment: 'node', data: [palette] });
    expect(paletteOnly.world.simulationFingerprint).toBe(plain.world.simulationFingerprint);
    plain.candidate.dispose(); paletteOnly.candidate.dispose();
    const visual = prepareGame({ environment: 'node', code: [enableCodeArtifact(artifact(), 'node')], data: [palette],
      profile: { ...game.profile, modules: [...game.profile.modules, { id: 'local.palette', version: '0.1.0' }] } });
    expect(visual.world.simulationFingerprint).toBe(game.world.simulationFingerprint);
    expect(visual.world.body('planet').color).toBe('#ff0055');
    const loaded = loadInstalledWorld(saveWorld(visual.world), { environment: 'node', code: [enableCodeArtifact(artifact(), 'node')] });
    expect(loaded.world.simulationFingerprint).toBe(game.world.simulationFingerprint);
    expect(loaded.world.body('planet').color).toBe('#ff0055');
    loaded.world.dispose(); visual.candidate.dispose(); game.candidate.dispose();
  });
  it('replaces dynamics and replays exact host/client state with the selected factory', () => {
    const game = prepared('numerical');
    let now = 0;
    const host = new HostSession(game.world, { snapshotEveryTicks: 1 }, { now: () => now });
    const [clientEnd, hostEnd] = loopback(deliver => deliver());
    const client = new ClientSession(clientEnd, { name: 'Pilot', now: () => now, lock: game.world.lock,
      simulationFingerprint: game.world.simulationFingerprint, createContext: game.createContext });
    host.accept(hostEnd);
    expect(client.phase).toBe('joined');
    game.world.respawn(client.ownShips()[0]!.id, 'planet-orbit');
    for (let tick = 0; tick < 100; tick++) { now += 10; host.step(); host.service(); client.update(); }
    const expected = game.world.cloneForPrediction();
    while (expected.tick < client.world!.tick) expected.step();
    expect(client.world!.tick - game.world.tick).toBeLessThanOrEqual(6);
    expect(client.world!.ships()).toEqual(expected.ships());
    expected.dispose();
    expect(client.world!.context.capabilities.analyticCoast).toBe(false);
    client.leave(); game.candidate.dispose();
  });
  it('owns sequential save-state migrations and leaves the source save unchanged', () => {
    const game = prepared('state');
    game.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    game.world.step();
    const saved = saveWorld(game.world), legacy = structuredClone(saved) as any;
    legacy.moduleState['local.flight-clock'].state = { version: 1, value: 5 };
    const before = JSON.stringify(legacy);
    const restored = loadInstalledWorld(legacy, { environment: 'node', code: [enableCodeArtifact(artifact('state'), 'node')] });
    expect(restored.world.moduleState['local.flight-clock']!.state).toEqual({ version: 2, value: { elapsed: 5 } });
    expect(JSON.stringify(legacy)).toBe(before);
    restored.world.step();
    expect(restored.world.moduleState['local.flight-clock']!.state.value).toEqual({ elapsed: 5.01 });
    restored.world.dispose(); game.candidate.dispose();
  });
  it('applies an owned migration to saved per-ship force state', () => {
    const migrated = edit({ source: `var SpaceSimModule = { default(context) {
      context.migrateState(1, value => Number(value) + 1);
      context.contributeForce({ modelIdentity: 'migration-test/v2', initialState: { version: 2, value: 0 },
        evaluate: () => ({ x: 0, y: 2 }) });
    } };` });
    const module = enableCodeArtifact(migrated, 'node');
    const game = prepareGame({ environment: 'node', code: [module], profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, { id: module.manifest.id, version: module.manifest.version }] } });
    game.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' }); game.world.step();
    const legacy = structuredClone(saveWorld(game.world)) as any;
    legacy.ships[0].moduleState[module.manifest.id] = { version: 1, value: 5 };
    const restored = loadInstalledWorld(legacy, { environment: 'node', code: [module] });
    expect(restored.world.ships()[0]!.state.moduleState![module.manifest.id]).toEqual({ version: 2, value: 6 });
    expect(legacy.ships[0].moduleState[module.manifest.id]).toEqual({ version: 1, value: 5 });
    restored.world.dispose(); game.candidate.dispose();
  });
  it('loads owner-installed artifacts on a dedicated server and restores their exact saved state', async () => {
    const dir = join(directory, 'server'); await mkdir(join(dir, 'modules'), { recursive: true });
    await writeFile(join(dir, 'modules', 'clock.module.json'), JSON.stringify(artifact('state')));
    const game = prepared('state');
    const profile = { format: 'space-sim-module-profile/1', modules: [], profile: game.profile,
      code: [{ id: artifact('state').manifest.id, version: '0.1.0', digest: artifact('state').digest },
        { id: artifact('telemetry').manifest.id, version: '0.1.0', digest: artifact('telemetry').digest }],
      selection: { universe: 'builtin.content/default-universe' } };
    await writeFile(join(dir, 'profile.json'), JSON.stringify(profile));
    game.candidate.dispose();
    const options = { dataDir: dir, overrides: { port: 0, host: '127.0.0.1', moduleDirectory: 'modules', moduleProfile: 'profile.json' }, log: () => {} };
    const server = await startServer(options);
    let before;
    try { server.host.world.step(); before = server.host.world.moduleState; await server.save(true); }
    finally { await server.stop(); }
    const restarted = await startServer(options);
    try { expect(restarted.host.world.moduleState).toEqual(before); expect(restarted.host.world.soloPreview).toBe(false); }
    finally { await restarted.stop(); }
  });
});
