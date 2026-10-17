import { beforeAll, describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { artifactModules, decodePackage, encodePackage, MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, validatePackage, type GamePackage } from '../../packages/game-library/src/archive';
import { artifactDigest, type CodeArtifact } from '../../packages/game-runtime/src/artifact';
import { buildModule } from '../../packages/module-tools/author.mjs';
import { createBuiltinRegistry, DEFAULT_PROFILE, prepareGame } from '../../packages/modules/src/index';
import { createPresentationRegistry, DEFAULT_PRESENTATION_PROFILE } from '../../packages/modules/src/browser';
import builtinGame from '../../games/space-sim/game.json' with { type: 'json' };
import builtinOrbitSandbox from '../../games/orbit-sandbox/game.json' with { type: 'json' };
import gentle from '../../examples/modules/gentle-flight.json' with { type: 'json' };
import { startServer } from '../../apps/server/src/server';
import { parseCommandLine } from '../../apps/server/src/config';

let force: CodeArtifact;
beforeAll(async () => { force = await buildModule(resolve('examples/modules/force/module.json'), undefined, { typecheck: false }); });
function game(): GamePackage {
  return validatePackage({ ...builtinGame, info: { ...builtinGame.info, id: 'local.test' }, plugins: [force], bundle: {
    ...builtinGame.bundle, code: [{ id: force.manifest.id, version: force.manifest.version, digest: force.digest }],
    profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id: force.manifest.id, version: force.manifest.version }] },
  } }) as GamePackage;
}

describe('Spacelab portable games and plugins', () => {
  it('ships Space Sim as an ordinary descriptor matching the default simulation and presentation', () => {
    const builtin = validatePackage(builtinGame) as GamePackage;
    expect(builtin.bundle.profile).toEqual(DEFAULT_PROFILE);
    expect(builtin.bundle.presentation).toEqual(DEFAULT_PRESENTATION_PROFILE);
    createBuiltinRegistry().resolve(builtin.bundle.profile, 'offline', ['motion', 'content']);
    createPresentationRegistry().resolve(builtin.bundle.presentation, 'offline', ['renderer']);
    const world = prepareGame({ environment: 'node', universeKey: builtin.bundle.selection.universe, profile: builtin.bundle.profile });
    expect(world.world.systemId).toBeTruthy();
    world.candidate.dispose();
  });
  it('ships Orbit Sandbox as an ordinary selectable game descriptor', () => {
    const sandbox = validatePackage(builtinOrbitSandbox) as GamePackage;
    expect(sandbox.info.id).toBe('builtin.orbit-sandbox');
    expect(sandbox.info.name).toBe('Orbit Sandbox');
    expect(sandbox.bundle.profile).toEqual(DEFAULT_PROFILE);
    expect(sandbox.bundle.presentation).toEqual(DEFAULT_PRESENTATION_PROFILE);
  });
  it('round trips a self-contained compressed game with code, data, settings and exact identity', async () => {
    const source = game();
    const bytes = await encodePackage(source);
    expect([...bytes.slice(0, 2)]).toEqual([0x1f, 0x8b]);
    expect(bytes.length).toBeLessThan(JSON.stringify(source).length);
    const restored = await decodePackage(bytes);
    expect(restored).toEqual(source);
    expect(Object.isFrozen(restored)).toBe(true);
    const options = { environment: 'node' as const, profile: source.bundle.profile,
      code: artifactModules(source.plugins, 'node'), universeKey: source.bundle.selection.universe };
    const first = prepareGame(options), second = prepareGame(options);
    expect(first.world.simulationFingerprint).toBe(second.world.simulationFingerprint);
    first.candidate.dispose(); second.candidate.dispose();
  });
  it('round trips compressed data and code plugin packs without executing source', async () => {
    const body = { ...force, source: 'throw new Error("MUST NOT EXECUTE ON IMPORT");' };
    const artifact = { ...body, digest: artifactDigest((({ digest: _, ...rest }) => rest)(body)) };
    const pack = validatePackage({ format: 'space-lab-plugin/1', info: { id: 'local.pack', name: 'Mixed pack', description: '' }, data: [gentle], code: [artifact] });
    expect(await decodePackage(await encodePackage(pack))).toEqual(pack);
    expect(artifactModules([artifact], 'offline')[0]!.manifest.id).toBe(force.manifest.id);
  });
  it('refuses duplicate IDs, missing embedded code and altered code digests', () => {
    const source = game();
    expect(() => validatePackage({ ...source, plugins: [force, force] })).toThrow('duplicate');
    expect(() => validatePackage({ ...source, plugins: [] })).toThrow('missing exact plugin');
    expect(() => validatePackage({ ...source, plugins: [{ ...force, source: force.source + ' ' }] })).toThrow('digest mismatch');
    expect(() => validatePackage({ ...source, bundle: { ...source.bundle, code: [] } })).toThrow('exact code requirement');
  });
  it('rejects unsupported versions, empty packs, malformed JSON and truncated gzip', async () => {
    expect(() => validatePackage({ ...builtinGame, format: 'space-lab-game/99' })).toThrow('Unsupported');
    expect(() => validatePackage({ format: 'space-lab-plugin/1', info: builtinGame.info, data: [], code: [] })).toThrow('empty');
    await expect(decodePackage(new Uint8Array(gzipSync('{broken')))).rejects.toThrow();
    const bytes = await encodePackage(game());
    await expect(decodePackage(bytes.slice(0, bytes.length - 8))).rejects.toThrow();
  });
  it('bounds both compressed input and streamed expansion', async () => {
    await expect(decodePackage(new Uint8Array(MAX_ARCHIVE_BYTES + 1))).rejects.toThrow('compressed size');
    const bomb = gzipSync(new Uint8Array(MAX_EXPANDED_BYTES + 1));
    await expect(decodePackage(new Uint8Array(bomb))).rejects.toThrow('size limit');
  }, 15000);
  it('hosts a compressed game with the same simulation identity and restores its world', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'space-lab-server-'));
    try {
      const source = game();
      await writeFile(resolve(directory, 'flight.spacegame'), await encodePackage(source));
      const options = { dataDir: directory, overrides: { ...parseCommandLine(['--game', 'flight.spacegame']).overrides,
        port: 0, host: '127.0.0.1' }, log: () => {} };
      const reference = prepareGame({ environment: 'node', profile: source.bundle.profile, code: artifactModules(source.plugins, 'node') });
      const expected = reference.world.simulationFingerprint;
      reference.candidate.dispose();
      const server = await startServer(options);
      let world: string;
      try { expect(server.host.world.simulationFingerprint).toBe(expected); world = server.host.world.id; await server.save(true); }
      finally { await server.stop(); }
      const restored = await startServer(options);
      try { expect(restored.host.world.id).toBe(world); expect(restored.host.world.simulationFingerprint).toBe(expected); }
      finally { await restored.stop(); }
      await expect(startServer({ ...options, overrides: { ...options.overrides, moduleProfile: 'legacy.json' } })).rejects.toThrow('choose --game');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
