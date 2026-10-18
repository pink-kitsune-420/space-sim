import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ManifestV2, ModuleProfileV2 } from '../../packages/game-api/src/index';
import { buildInputsDigest, createIntegrity, encodeModuleFiles, jsonBytes, textBytes, type ModulePackageDescriptor } from '../../packages/game-library/src/portable';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { InstalledGameRuntime, prepareInstalledGame, type EngineAdapters, type InstalledGamePlan } from '../../packages/game-runtime/src/game-loader';
import { installPackage, MemoryPackageStore } from '../../packages/game-runtime/src/package-store';
import { FilePackageStore } from '../../apps/server/src/package-store';
import { buildPortableModule, buildGame, newModule, unpackPackage } from '../../packages/module-tools/package.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { normalizeLegacyModule } from '../../packages/game-runtime/src/loader';
import { moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { BASE_GAME_MODULES } from '../../packages/modules/src/index';
import { createModuleWorld } from '../../packages/sim-core/src/module-world';
import type { World } from '../../packages/sim-core/src/world';
import { attachRuntimeFiles, installRuntimeSelection, runtimeSelectionFiles, validateRuntimeSelection } from '../../packages/game-library/src/runtime-selection';
import { decodePackage, encodePackage, type GamePackage } from '../../packages/game-library/src/archive';
import { decodeGamePackage } from '../../packages/game-library/src/game-package';
import { validatePackage } from '../../packages/game-library/src/archive';
import { prepareInstalledWorld, verifyInstalledWorldCandidate } from '../../packages/modules/src/installed';
import { saveWorld } from '../../packages/sim-core/src/save';
import { serverModules } from '../../apps/server/src/modules';
import { DEFAULT_CONFIG } from '../../apps/server/src/config';
import { startServer } from '../../apps/server/src/server';
import builtin from '../../games/space-sim/game.json' with { type: 'json' };

const temporary: string[] = [];
afterEach(async () => { for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); delete (globalThis as Record<string, unknown>).__phase2Code; });
const manifest = (id: string, tier: ManifestV2['tier'] = 'platform'): ManifestV2 => ({ format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2',
  id, name: id, version: '1.0.0', kind: 'provider', tier, environments: ['browser', 'offline', 'node'], dependencies: [], conflicts: [],
  provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'MIT' });
async function archive(id: string, tier: ManifestV2['tier'] = 'platform', source = 'var SpaceSimModule = { default: function() { globalThis.__phase2Code = (globalThis.__phase2Code || 0) + 1; } };'): Promise<Uint8Array<ArrayBuffer>> {
  const files = new Map([['src/main.ts', textBytes('export default function initialize() {}')], ['LICENSE', textBytes('MIT')], ['NOTICE', textBytes('Test authors')],
    ['dist/module.js', textBytes(source)]]);
  let descriptor: ModulePackageDescriptor = { format: 'spacelab-module-package/1', manifest: manifest(id, tier), entry: 'src/main.ts',
    compatibility: { deterministic: true, multiplayer: true }, assets: [], data: [], guides: [], inputs: [], sourceStatus: 'included',
    build: { bundle: 'dist/module.js', toolchain: 'test', inputsDigest: '0'.repeat(64) } };
  descriptor = { ...descriptor, build: { ...descriptor.build!, inputsDigest: buildInputsDigest(files, descriptor) } };
  files.set('module.json', jsonBytes(descriptor)); files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return encodeModuleFiles(files);
}
const policy = { environment: 'node' as const, allowRuntimeCode: true, approvedDigests: new Set<string>() };
const provenance = { source: 'Local test', installedAt: '2026-10-18T00:00:00Z' };
const profile = (id: string): ModuleProfileV2 => ({ format: 'space-sim-profile/2', id: 'local.test', modules: [{ id, version: '1.0.0' }], providers: {}, capabilities: {}, settings: {} });
const adapters = (construct: EngineAdapters['construct'] = () => ({ async start() {}, dispose() {} })): EngineAdapters => ({
  hostServices: [], staticModules: [], inspect: inspectRuntimePackage, construct });
async function installed(id = 'test.platform', tier: ManifestV2['tier'] = 'platform') {
  const bytes = await archive(id, tier), store = new MemoryPackageStore();
  const entry = await installPackage(bytes, store, inspectRuntimePackage, provenance, policy);
  const plan: InstalledGamePlan = { profile: profile(id), packages: [{ id, version: entry.version, digest: entry.digest }], requiredSlots: [] };
  return { store, entry, bytes, plan, policy: { ...policy, approvedDigests: new Set([entry.digest]) } };
}

describe('verified installed-game lifecycle', () => {
  it('installs/replays inertly, requires exact consent, and blocks code-disabled builds', async () => {
    const value = await installed();
    expect((globalThis as Record<string, unknown>).__phase2Code).toBeUndefined();
    await expect(prepareInstalledGame(value.plan, value.store, policy, adapters(), new AbortController().signal)).rejects.toThrow('approve this exact');
    await expect(prepareInstalledGame(value.plan, value.store, { ...value.policy, allowRuntimeCode: false }, adapters(), new AbortController().signal)).rejects.toThrow('does not allow');
    expect((globalThis as Record<string, unknown>).__phase2Code).toBeUndefined();
    const runtime = new InstalledGameRuntime(value.store, value.policy, adapters());
    await runtime.replace(value.plan);
    expect((globalThis as Record<string, unknown>).__phase2Code).toBe(1);
    runtime.dispose();
    await expect(runtime.replace(value.plan)).rejects.toThrow('disposed');
  });
  it('rejects tampered replay and non-pinned selections before initialization', async () => {
    const value = await installed(), record = (await value.store.get(value.entry.digest))!;
    const altered = record.bytes.slice(); altered[40] = altered[40]! ^ 1;
    await value.store.putVerified({ ...record, bytes: altered });
    await expect(prepareInstalledGame(value.plan, value.store, value.policy, adapters(), new AbortController().signal)).rejects.toThrow();
    expect((globalThis as Record<string, unknown>).__phase2Code).toBeUndefined();
    await expect(prepareInstalledGame({ ...value.plan, packages: [] }, value.store, value.policy, adapters(), new AbortController().signal)).rejects.toThrow('exact package digest');
  });
  it('rolls back failed startup, retaining the old game until a replacement starts', async () => {
    const value = await installed(), events: string[] = []; let number = 0, fail = false;
    const runtime = new InstalledGameRuntime(value.store, value.policy, adapters(() => {
      const id = ++number;
      return { async start(signal) { expect(signal.aborted).toBe(false); events.push(`start ${id}`); if (fail) throw new Error('socket failed'); }, dispose() { events.push(`close ${id}`); } };
    }));
    const old = await runtime.replace(value.plan); fail = true;
    await expect(runtime.replace(value.plan)).rejects.toThrow('socket failed');
    expect(runtime.active).toBe(old); expect(old.available).toBe(true); expect(events).toEqual(['start 1', 'start 2', 'close 2']);
    fail = false; await runtime.replace(value.plan);
    expect(old.available).toBe(false); expect(events.slice(-2)).toEqual(['start 3', 'close 1']);
    runtime.dispose(); runtime.dispose(); expect(events.filter(e => e === 'close 3')).toHaveLength(1);
  });
  it('cancels an in-flight replacement without allowing it to activate later', async () => {
    const value = await installed(); let release!: () => void, starts = 0, closes = 0;
    const runtime = new InstalledGameRuntime(value.store, value.policy, adapters(() => ({
      async start() { if (++starts === 1) await new Promise<void>(resolve => { release = resolve; }); }, dispose() { closes++; } })));
    const pending = runtime.replace(value.plan);
    // Wait for the real lifecycle boundary, not elapsed wall time.
    while (!release) await new Promise(resolve => setTimeout(resolve, 0));
    const latest = await runtime.replace(value.plan); release();
    await expect(pending).rejects.toThrow(); expect(runtime.active).toBe(latest); expect(closes).toBe(1); runtime.dispose();
  });
  it('retains the new active candidate when old resource cleanup throws', async () => {
    const value = await installed(); let number = 0;
    const runtime = new InstalledGameRuntime(value.store, value.policy, adapters(() => {
      const id = ++number; return { async start() {}, dispose() { if (id === 1) throw new Error('cleanup failed'); } };
    }));
    const previous = await runtime.replace(value.plan), next = await runtime.replace(value.plan);
    expect(runtime.active).toBe(next); expect(next.ready).toBe(true); expect(previous.available).toBe(false);
    expect(previous.disposalErrors).toHaveLength(1); runtime.dispose();
  });
  it('keeps platform settings/packages outside authoritative identity', async () => {
    const a = await installed('test.platform'), b = await installed('test.other');
    const ca = await prepareInstalledGame(a.plan, a.store, a.policy, adapters(), new AbortController().signal);
    const cb = await prepareInstalledGame(b.plan, b.store, b.policy, adapters(), new AbortController().signal);
    expect(ca.identity.authoritativeDigest).toBe(cb.identity.authoritativeDigest);
    expect(ca.identity.gameLockDigest).not.toBe(cb.identity.gameLockDigest); ca.dispose(); cb.dispose();
  });
  it('persists exact versions and source in an inert filesystem store', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2-store-')); temporary.push(directory);
    const store = new FilePackageStore(directory), bytes = await archive('test.file');
    const entry = await installPackage(bytes, store, inspectRuntimePackage, provenance, policy);
    const reopened = new FilePackageStore(directory), record = await reopened.get(entry.digest);
    expect(record!.bytes).toEqual(bytes); expect(record!.provenance).toEqual(provenance);
    expect(await reopened.list()).toEqual([entry]); expect((globalThis as Record<string, unknown>).__phase2Code).toBeUndefined();
    await expect(reopened.get('../escape')).rejects.toThrow('digest');
    await reopened.remove(entry.digest); expect(await reopened.get(entry.digest)).toBeUndefined();
  });
  it('builds an editable v2 module with the real public API toolchain', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2-author-')); temporary.push(directory);
    const source = join(directory, 'module'); await newModule('test.authored', source);
    const path = join(source, 'module.json'), descriptor = JSON.parse(await readFile(path, 'utf8'));
    descriptor.manifest = manifest('test.authored'); await writeFile(path, JSON.stringify(descriptor));
    await writeFile(join(source, 'src/main.ts'), "import type { ModuleInitializationV2 } from '@space-sim/game-api';\nexport default function initialize(context: ModuleInitializationV2): void { context.contributeActions([{ id: 'test.authored/ping', label: 'Ping', category: 'system', mode: 'press', defaultKeys: [] }]); }\n");
    const output = join(directory, 'module.spacemod'); await buildPortableModule(path, output);
    const checked = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    expect(checked.manifest.apiVersion).toBe('space-sim-game-api/2'); expect(checked.containsCode).toBe(true);
  }, 30000);
  it('constructs deterministic headless worlds from mixed v1/v2 modules and binds authority separately from devices', async () => {
    const builtins = BASE_GAME_MODULES.map(module => normalizeLegacyModule(module, moduleAssets()));
    async function prepare(id: string, tier: ManifestV2['tier']) {
      const store = new MemoryPackageStore(), bytes = await archive(id, tier, tier === 'authoritative'
        ? "var SpaceSimModule = { default: function(c) { c.contributeForce({ modelIdentity: 'test-lift', initialState: {version: 1, value: null}, evaluate: function() { return {x: 0, y: 0.01}; } }); } };"
        : 'var SpaceSimModule = { default: function() {} };');
      const entry = await installPackage(bytes, store, inspectRuntimePackage, provenance, policy);
      const plan = { profile: { ...profile(id), modules: [...builtins.map(m => ({ id: m.manifest.id, version: m.manifest.version })), ...profile(id).modules] },
        packages: [{ id, version: entry.version, digest: entry.digest }], requiredSlots: ['motion', 'content'] };
      let world!: World;
      const candidate = await prepareInstalledGame(plan, store, { ...policy, approvedDigests: new Set([entry.digest]) }, {
        hostServices: [], staticModules: builtins, inspect: inspectRuntimePackage,
        construct(modules, identity) { world = createModuleWorld(modules, identity); return { async start() {}, dispose() { world.dispose(); } }; },
      }, new AbortController().signal);
      return { world, candidate };
    }
    const a = await prepare('test.first-device', 'platform'), b = await prepare('test.second-device', 'platform'), force = await prepare('test.force', 'authoritative');
    expect(a.world.simulationFingerprint).toBe(b.world.simulationFingerprint);
    expect(a.world.simulationFingerprint).not.toBe(force.world.simulationFingerprint);
    expect(force.world.forces).toHaveLength(1); expect(force.world.soloPreview).toBe(false);
    expect(force.world.context.capabilities.rails).toBe(false);
    const ship = force.world.spawn({ ownerId: 'pilot' }); force.world.step(); expect(force.world.record(ship.id)).toBeDefined();
    a.candidate.dispose(); b.candidate.dispose(); force.candidate.dispose();
  });
});

describe('portable mixed games in real hosts', () => {
  async function game() {
    const bytes = await archive('test.portable-force', 'authoritative', "var SpaceSimModule = { default: function(c) { c.contributeForce({ modelIdentity: 'portable-lift', initialState: {version: 1, value: null}, evaluate: function() { return {x: 0, y: 0.01}; } }); } };");
    const inspected = await inspectRuntimePackage(bytes);
    const plan = { profile: profile(inspected.id), packages: [{ id: inspected.id, version: inspected.version, digest: inspected.digest }], requiredSlots: [] };
    const runtime = attachRuntimeFiles(validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: plan, offline: plan, node: plan } }),
      new Map([[`modules/${inspected.id}.spacemod`, bytes]]));
    return validatePackage({ ...builtin, runtime }) as GamePackage;
  }
  it('round trips exact packages and editable source without evaluating, including a second export', async () => {
    const original = await game(), bytes = await encodePackage(original), restored = await decodePackage(bytes) as GamePackage;
    expect(restored.runtime).toEqual(original.runtime);
    expect(runtimeSelectionFiles(restored.runtime!)).toEqual(runtimeSelectionFiles(original.runtime!));
    const inspected = await decodeGamePackage(await encodePackage(restored), validatePackage);
    expect(inspected.lock.resolution).toBe('mixed-v2');
    expect(inspected.manifest.targets.node).toContain('test.portable-force');
    expect(inspected.modules[0]!.files.has('src/main.ts')).toBe(true);
    const directory = await mkdtemp(join(tmpdir(), 'phase2-rebuild-game-')); temporary.push(directory);
    const input = join(directory, 'game.spacegame'), source = join(directory, 'source');
    await writeFile(input, bytes); await unpackPackage(input, source);
    const rebuilt = await buildGame(join(source, 'game.json'), join(directory, 'rebuilt.spacegame'));
    expect(rebuilt.lock).toEqual(inspected.lock);
    expect((globalThis as Record<string, unknown>).__phase2Code).toBeUndefined();
    const invalid = { ...original, runtime: attachRuntimeFiles(validateRuntimeSelection({ ...original.runtime, plans: {
      node: { ...original.runtime!.plans.node!, packages: [{ ...original.runtime!.plans.node!.packages[0]!, digest: '0'.repeat(64) }] },
    } }), runtimeSelectionFiles(original.runtime!)) };
    await expect(encodePackage(invalid)).rejects.toThrow('identity mismatch');
  });
  it('runs the same authority in browser and node adapters, restores state, and rejects a changed fingerprint', async () => {
    const value = await decodePackage(await encodePackage(await game())) as GamePackage;
    const prepare = async (environment: 'browser' | 'node', restore?: unknown) => {
      const store = new MemoryPackageStore();
      const plan = await installRuntimeSelection(value.runtime!, store, { environment, allowRuntimeCode: true }, 'Test game');
      return prepareInstalledWorld(plan, store, { environment, allowRuntimeCode: true, approvedDigests: new Set(plan.packages.map(p => p.digest)) },
        { profile: value.bundle.profile, inspect: inspectRuntimePackage, hostServices: [], restore }, new AbortController().signal);
    };
    const browser = await prepare('browser'), node = await prepare('node');
    try {
      expect(browser.loaded.world.simulationFingerprint).toBe(node.loaded.world.simulationFingerprint);
      const peer = { lock: node.loaded.world.lock, fingerprint: node.loaded.world.simulationFingerprint,
        universe: node.loaded.world.universe, systemId: node.loaded.world.systemId };
      expect(verifyInstalledWorldCandidate(browser.candidate, peer)).toEqual({ ok: true, simulationFingerprint: peer.fingerprint });
      expect(verifyInstalledWorldCandidate(browser.candidate, { ...peer, fingerprint: '0'.repeat(64) }).ok).toBe(false);
      node.loaded.world.spawn({ ownerId: 'pilot' }); node.loaded.world.step();
      const saved = saveWorld(node.loaded.world), resumed = await prepare('node', saved);
      expect(resumed.loaded.world.tick).toBe(1); expect(saveWorld(resumed.loaded.world).ships).toEqual(saved.ships);
      resumed.loaded.world.step(); node.loaded.world.step();
      expect(saveWorld(resumed.loaded.world).ships).toEqual(saveWorld(node.loaded.world).ships);
      resumed.loaded.world.dispose(); expect(resumed.candidate.available).toBe(false);
      await expect(prepare('node', { ...saved, simulationFingerprint: '0'.repeat(64) })).rejects.toThrow('differ');
    } finally { browser.loaded.world.dispose(); node.loaded.world.dispose(); }
  });
  it('loads an owner-configured game on the dedicated server and resumes its saved exact authority', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'phase2-server-game-')); temporary.push(directory);
    const path = join(directory, 'game.spacegame'); await writeFile(path, await encodePackage(await game()));
    const installed = await serverModules({ ...DEFAULT_CONFIG, gameFile: path }, directory);
    expect(await installed.runtime!.store.list()).toHaveLength(1);
    const start = () => startServer({ dataDir: directory, overrides: { gameFile: path, port: 0, host: '127.0.0.1' }, log() {} });
    const first = await start(); let worldId: string;
    try { worldId = first.host.world.id; expect(first.host.world.forces).toHaveLength(1); await first.save(true); }
    finally { await first.stop(); }
    const resumed = await start();
    try { expect(resumed.host.world.id).toBe(worldId!); expect(resumed.host.world.forces).toHaveLength(1); }
    finally { await resumed.stop(); }
  }, 30000);
  it('retains the v2 authority on headless targets that omit all device modules', async () => {
    const device = await installed('test.device-only'), empty = { ...device.plan, profile: { ...device.plan.profile, modules: [] }, packages: [] };
    const runtime = attachRuntimeFiles(validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: device.plan, node: empty } }),
      new Map([['modules/test.device-only.spacemod', device.bytes]]));
    const value = validatePackage({ ...builtin, runtime }) as GamePackage;
    const browser = await prepareInstalledWorld(device.plan, device.store, { ...device.policy, environment: 'browser' },
      { profile: value.bundle.profile, hostServices: [], inspect: inspectRuntimePackage }, new AbortController().signal);
    const directory = await mkdtemp(join(tmpdir(), 'phase2-headless-device-')); temporary.push(directory);
    const path = join(directory, 'game.spacegame'); await writeFile(path, await encodePackage(value));
    const installedNode = await serverModules({ ...DEFAULT_CONFIG, gameFile: path }, directory);
    const node = await prepareInstalledWorld(installedNode.runtime!.plan, installedNode.runtime!.store, policy,
      { profile: value.bundle.profile, hostServices: [], inspect: inspectRuntimePackage }, new AbortController().signal);
    try { expect(node.loaded.world.simulationFingerprint).toBe(browser.loaded.world.simulationFingerprint); }
    finally { browser.loaded.world.dispose(); node.loaded.world.dispose(); }
  });
});
