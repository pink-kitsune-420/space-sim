import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { deflateRawSync, gzipSync } from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { artifactDigest } from '../../packages/game-runtime/src/artifact';
import { serverModules } from '../../apps/server/src/modules';
import { DEFAULT_CONFIG } from '../../apps/server/src/config';
import { sha256Bytes, sha256Hex } from '../../packages/game-runtime/src/authoritative';
import { decodePackage, encodePackage, validatePackage, artifactModules, type GamePackage } from '../../packages/game-library/src/archive';
import { crc32, readZip, writeZip, validateFilePaths } from '../../packages/game-library/src/zip';
import { createIntegrity, encodeModuleFiles, inspectModuleFiles, decodeModulePackage, jsonBytes, packageFiles,
  parsePackageJson, wrapLegacyCode, wrapUniversePackage, wrapShaderPackage, modulePayload, textBytes } from '../../packages/game-library/src/portable';
import { decodeGamePackage } from '../../packages/game-library/src/game-package';
import { buildPortableModule, packModule, unpackPackage, newModule, readModuleFolder, buildGame, convertModule } from '../../packages/module-tools/package.mjs';
import { buildModule } from '../../packages/module-tools/author.mjs';
import { prepareGame, DEFAULT_PROFILE, loadInstalledWorld } from '../../packages/modules/src/index';
import { decodeUniverse } from '../../packages/game-library/src/universe';
import { saveWorld } from '../../packages/sim-core/src/save';
import builtin from '../../games/space-sim/game.json' with { type: 'json' };
import gentle from '../../examples/modules/gentle-flight.json' with { type: 'json' };

let directory: string;
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-portable-tests-'));
  for (const name of ['force', 'numerical', 'telemetry', 'state']) await buildPortableModule(resolve(`examples/packages/${name}/module.json`), undefined, { typecheck: false });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
/** Independent minimal ZIP fixture, allowing malicious claims the production writer refuses. */
function fixture(path = 'assets/file.bin', data = Buffer.from([0, 128, 255]), options: { method?: number; flags?: number; mode?: number; descriptor?: boolean; size?: number; packed?: Buffer } = {}): Uint8Array<ArrayBuffer> {
  const name = Buffer.from(path), packed = options.packed ?? (options.method === 8 ? deflateRawSync(data) : data), method = options.method ?? 0;
  const size = options.size ?? data.length, crc = crc32(data), flags = (options.flags ?? 0x800) | (options.descriptor ? 8 : 0);
  const h = Buffer.alloc(30 + name.length); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(method, 8);
  if (!options.descriptor) { h.writeUInt32LE(crc, 14); h.writeUInt32LE(packed.length, 18); h.writeUInt32LE(size, 22); }
  h.writeUInt16LE(name.length, 26); name.copy(h, 30);
  const d = Buffer.alloc(options.descriptor ? 16 : 0);
  if (options.descriptor) { d.writeUInt32LE(0x08074b50, 0); d.writeUInt32LE(crc, 4); d.writeUInt32LE(packed.length, 8); d.writeUInt32LE(size, 12); }
  const c = Buffer.alloc(46 + name.length); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(flags, 8); c.writeUInt16LE(method, 10);
  c.writeUInt32LE(crc, 16); c.writeUInt32LE(packed.length, 20); c.writeUInt32LE(size, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(((options.mode ?? 0o100644) << 16) >>> 0, 38); name.copy(c, 46);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(c.length, 12); end.writeUInt32LE(h.length + packed.length + d.length, 16);
  return new Uint8Array(Buffer.concat([h, packed, d, c, end]));
}
function resign(files: Map<string, Uint8Array<ArrayBuffer>>) { files.set('integrity.json', jsonBytes(createIntegrity(files))); return files; }

describe('bounded standard ZIP and binary identities', () => {
  it('matches standard SHA-256 for binary and UTF-8 including block boundaries', () => {
    for (const n of [0, 1, 55, 56, 63, 64, 65, 1024, 1048576]) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 71) & 255);
      expect(sha256Bytes(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
    }
    expect(sha256Hex('🚀\r\n')).toBe(createHash('sha256').update('🚀\r\n').digest('hex'));
  });
  it('reads independent raw-deflate/data-descriptor ZIP entries and writes reproducibly', async () => {
    const bytes = fixture('assets/a.bin', Buffer.from([0, 255, 128]), { method: 8, descriptor: true });
    const files = await readZip(bytes);
    expect([...files.get('assets/a.bin')!]).toEqual([0, 255, 128]);
    expect(await writeZip(files)).toEqual(await writeZip(new Map([...files].reverse())));
    expect(await readZip(await writeZip(files, { compression: 'store' }))).toEqual(files);
  });
  it('interoperates with Python zipfile, including recompression and ordinary directory entries', async () => {
    const input = join(directory, 'ordinary.zip'), output = join(directory, 'python.zip');
    const files = new Map([['assets/a.bin', new Uint8Array([0, 128, 255])], ['LICENSE', textBytes('MIT')]]);
    await writeFile(input, await writeZip(files));
    execFileSync('python3', ['-c', `import sys,zipfile
with zipfile.ZipFile(sys.argv[1]) as src, zipfile.ZipFile(sys.argv[2],'w',zipfile.ZIP_DEFLATED) as dst:
 dst.mkdir('assets/')
 for name in reversed(src.namelist()): dst.writestr(name,src.read(name))
`, input, output]);
    expect(await readZip(new Uint8Array(await readFile(output)))).toEqual(files);
  });
  it.each(['../escape', '/root/file', 'C:/file', 'a\\b', 'a//b', '.hidden/a', 'a/../b', 'a/./b', 'a/é'])('rejects unsafe paths: %s', async path => {
    await expect(readZip(fixture(path))).rejects.toThrow();
  });
  it('rejects duplicates, case-folded parents, and file-directory conflicts', () => {
    for (const paths of [['a', 'a'], ['a', 'A'], ['a', 'a/b'], ['a/b', 'a'], ['A/b', 'a/c'], ['a/', 'a']]) expect(() => validateFilePaths(paths)).toThrow();
  });
  it.each([0o120777, 0o020644, 0o100755])('rejects symlink/device/executable attributes: %s', async mode => {
    await expect(readZip(fixture('a', undefined, { mode }))).rejects.toThrow('regular files');
  });
  it('rejects encryption, unsupported methods, bad CRC, advertised size lies, truncation, ZIP64 and disk fields', async () => {
    await expect(readZip(fixture('a', undefined, { flags: 1 }))).rejects.toThrow();
    await expect(readZip(fixture('a', undefined, { method: 99 }))).rejects.toThrow();
    await expect(readZip(fixture('a', undefined, { size: 2 }))).rejects.toThrow('CRC');
    const bytes = fixture(); bytes[30 + 'assets/file.bin'.length] = bytes[30 + 'assets/file.bin'.length]! ^ 1;
    await expect(readZip(bytes)).rejects.toThrow('CRC');
    await expect(readZip(bytes.slice(0, -1))).rejects.toThrow();
    const zip64 = fixture(); new DataView(zip64.buffer).setUint16(zip64.length - 12, 65535, true);
    await expect(readZip(zip64)).rejects.toThrow();
    const disk = fixture(); new DataView(disk.buffer).setUint16(disk.length - 18, 1, true);
    await expect(readZip(disk)).rejects.toThrow('Multipart');
  });
  it('rejects overlapping local ranges and mismatched local headers', async () => {
    const bytes = await writeZip(new Map([['a', new Uint8Array([1, 2])], ['b', new Uint8Array([3, 4])]]), { compression: 'store' });
    const view = new DataView(bytes.buffer), central = view.getUint32(bytes.length - 6, true), dataStart = 31, size = central - dataStart;
    const crc = crc32(bytes.subarray(dataStart, central));
    view.setUint32(14, crc, true); view.setUint32(18, size, true); view.setUint32(22, size, true);
    view.setUint32(central + 16, crc, true); view.setUint32(central + 20, size, true); view.setUint32(central + 24, size, true);
    await expect(readZip(bytes)).rejects.toThrow('Overlapping');
    const mismatch = fixture(); new DataView(mismatch.buffer).setUint16(8, 8, true);
    await expect(readZip(mismatch)).rejects.toThrow('header mismatch');
  });
  it('bounds actual DEFLATE expansion, shared nested budgets, entry counts and cancellation', async () => {
    const bomb = fixture('assets/bomb', Buffer.alloc(9 * 1024 * 1024), { method: 8, size: 1 });
    await expect(readZip(bomb)).rejects.toThrow('expanded size');
    await expect(readZip(fixture(), { budget: { bytes: 64 * 1024 * 1024 - 2, files: 0 } })).rejects.toThrow('expanded size');
    await expect(readZip(fixture(), { maxFiles: 0 })).rejects.toThrow('file count');
    const abort = new AbortController(); abort.abort();
    await expect(readZip(fixture(), { signal: abort.signal })).rejects.toThrow();
    await expect(writeZip(new Map(), { signal: abort.signal })).rejects.toThrow();
  });
  it('bounds JSON byte size and nesting before parsing', () => {
    expect(() => parsePackageJson(textBytes('['.repeat(65) + '0' + ']'.repeat(65)), 'test')).toThrow('complexity');
    expect(() => parsePackageJson(textBytes('{}'), 'test', 1)).toThrow('size');
    expect(parsePackageJson(textBytes('{"text":"[[["}'), 'test')).toEqual({ text: '[[[' });
  });
});

describe('editable packages and compatibility', () => {
  it('scaffolds, builds, packs, unpacks, edits and rebuilds complete source; inspection never evaluates', async () => {
    const source = join(directory, 'source'), archive = join(directory, 'module.spacemod'), target = join(directory, 'unpacked');
    await newModule('local.editable', source);
    await writeFile(join(source, 'src/main.ts'), 'throw new Error("DO NOT RUN"); export default () => {};\n');
    const built = await buildPortableModule(join(source, 'module.json'), undefined, { typecheck: false });
    expect(built.descriptor.sourceStatus).toBe('included');
    await packModule(source, archive);
    await unpackPackage(archive, target);
    expect(await readFile(join(target, 'src/main.ts'), 'utf8')).toContain('DO NOT RUN');
    expect((await decodeModulePackage(new Uint8Array(await readFile(archive)))).integrity.digest).toBe(built.integrity.digest);
    await writeFile(join(target, 'src/main.ts'), 'export default () => {};\n');
    await expect(packModule(target, join(directory, 'stale.spacemod'))).rejects.toThrow();
    const rebuilt = await buildPortableModule(join(target, 'module.json'), undefined, { typecheck: false });
    expect(rebuilt.integrity.digest).not.toBe(built.integrity.digest);
    await packModule(target, join(directory, 'edited.spacemod'));
  });
  it('refuses missing/stale bundles for play, permits source inspection, and binds every raw byte', async () => {
    const files = await readModuleFolder('examples/packages/force');
    const original = inspectModuleFiles(files);
    files.delete('dist/module.js'); resign(files);
    expect(() => inspectModuleFiles(files)).toThrow('Rebuild');
    expect(inspectModuleFiles(files, false).playable).toBe(false);
    const archive = await writeZip(files);
    expect((await decodeModulePackage(archive, { playable: false })).playable).toBe(false);
    const changed = new Map(original.files); changed.set('LICENSE', textBytes('Edited license text')); resign(changed);
    expect(() => inspectModuleFiles(changed)).toThrow('Rebuild');
    expect(createIntegrity(changed).digest).not.toBe(original.integrity.digest);
    const tampered = new Map(original.files); tampered.set('dist/module.js', textBytes('altered'));
    expect(() => inspectModuleFiles(tampered)).toThrow('digest');
  });
  it('retains binary assets and identity across stored/deflated recompression', async () => {
    const files = await readModuleFolder('examples/packages/force');
    // Inspection only: adding a byte asset requires a rebuild to authorize play.
    files.set('assets/raw.bin', new Uint8Array([255, 128, 0])); resign(files);
    const a = await decodeModulePackage(await writeZip(files, { compression: 'store' }), { playable: false });
    const b = await decodeModulePackage(await writeZip(files, { compression: 'deflate' }), { playable: false });
    expect(a.integrity.digest).toBe(b.integrity.digest);
    expect([...b.files.get('assets/raw.bin')!]).toEqual([255, 128, 0]);
  });
  it('refuses symlink parents, source links and nonempty unpack destinations before overwriting', async () => {
    const archive = join(directory, 'safe.spacemod'); await packModule('examples/packages/force', archive);
    const occupied = join(directory, 'occupied'); await mkdir(occupied); await writeFile(join(occupied, 'keep'), 'safe');
    await expect(unpackPackage(archive, occupied)).rejects.toThrow('empty');
    const link = join(directory, 'link'); await symlink(occupied, link);
    await expect(unpackPackage(archive, join(link, 'child'))).rejects.toThrow('Symlink');
    const source = join(directory, 'linked-source'); await mkdir(source); await symlink(join(occupied, 'keep'), join(source, 'file'));
    await expect(readModuleFolder(source)).rejects.toThrow('Regular files');
    expect(await readFile(join(occupied, 'keep'), 'utf8')).toBe('safe');
  });
  it('preserves source sidecars through validated runtime values, game export and re-import', async () => {
    const files = await readModuleFolder('examples/packages/force'), module = inspectModuleFiles(files);
    const game = validatePackage({ ...builtin, plugins: [module.code], bundle: { ...builtin.bundle,
      profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id: module.code!.manifest.id, version: module.code!.manifest.version }] },
      code: [{ id: module.code!.manifest.id, version: module.code!.manifest.version, digest: module.code!.digest }] } }) as GamePackage;
    expect(packageFiles(game.plugins[0]!)).toBeDefined();
    const archive = await encodePackage(game), restored = await decodePackage(archive) as GamePackage;
    expect(packageFiles(restored.plugins[0]!)?.get('src/main.ts')).toEqual(files.get('src/main.ts'));
    const packed = await decodeGamePackage(await encodePackage(restored), validatePackage);
    expect(packed.modules[0]!.descriptor.sourceStatus).toBe('included');
    expect(packed.lock.modules[0]!.digest).toBe(module.integrity.digest);
    expect(packed.lock.modules[0]!.legacyDigest).toBe(module.code!.digest);
  });
  it('wraps legacy code without claiming source and preserves saved-world identity', async () => {
    const artifact = await buildModule(resolve('examples/modules/force/module.json'), undefined, { typecheck: false });
    const files = wrapLegacyCode(artifact), restored = await decodeModulePackage(await encodeModuleFiles(files));
    expect(restored.descriptor.sourceStatus).toBe('legacy-unavailable'); expect(restored.code).toEqual(artifact);
    const options = { environment: 'node' as const, code: artifactModules([artifact], 'node'), profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, { id: artifact.manifest.id, version: artifact.manifest.version }] } };
    const first = prepareGame(options), second = prepareGame({ ...options, code: artifactModules([restored.code!], 'node') });
    expect(second.world.simulationFingerprint).toBe(first.world.simulationFingerprint);
    const saved = saveWorld(first.world), loaded = loadInstalledWorld(saved, { environment: 'node', code: artifactModules([restored.code!], 'node') });
    expect(loaded.world.lock).toEqual(first.world.lock);
    loaded.world.dispose(); first.candidate.dispose(); second.candidate.dispose();
    const bad = new Map(files); bad.set('dist/module.js', textBytes('changed')); resign(bad);
    expect(() => inspectModuleFiles(bad)).toThrow('Legacy wrapper');
  });
  it('reads raw JSON and gzip legacy packs losslessly, without changing legacy exports in place', async () => {
    for (const source of [builtin, { format: 'space-lab-plugin/1', info: builtin.info, data: [gentle], code: [] }]) {
      const checked = validatePackage(source);
      for (const bytes of [textBytes(JSON.stringify(checked)), new Uint8Array(gzipSync(JSON.stringify(checked)))]) expect(await decodePackage(bytes)).toEqual(checked);
      expect(await decodePackage(await encodePackage(checked))).toEqual(checked);
    }
  });
  it('migrates universe/system and shader data without rounding or inventing new shader passes', async () => {
    const raw = JSON.parse(await readFile('games/space-sim/universes/sandbox/default/universe.json', 'utf8'));
    raw.systems[0].bodies[0].mass = 1.2345678901234567e23;
    const universeFiles = wrapUniversePackage(raw, await readFile('LICENSE', 'utf8'));
    const restored = await decodeUniverse(await encodeModuleFiles(universeFiles));
    expect(restored.systems[0]!.bodies[0]!.mass).toBe(raw.systems[0].bodies[0].mass);
    const shader = JSON.parse(await readFile('examples/shaders/violet.json', 'utf8'));
    const packedShader = await decodeModulePackage(await encodeModuleFiles(wrapShaderPackage(shader, 'MIT license text')));
    expect(modulePayload(packedShader, 'shaders')).toEqual(shader);
    const source = join(directory, 'test.frag'); await writeFile(source, 'void main() {}');
    await expect(convertModule(source, join(directory, 'missing-license'))).rejects.toThrow('--license-file');
    const converted = await convertModule(source, join(directory, 'shader-source'), { license: 'MIT', licenseFile: resolve('LICENSE') });
    expect('descriptor' in converted && 'authority' in converted.descriptor.manifest && converted.descriptor.manifest.authority).toBe('presentation');
  });
  it('rebuilds an unpacked v2 game and explicitly converts legacy profiles', async () => {
    const root = join(directory, 'game-source'), input = join(directory, 'input.spacegame');
    await writeFile(input, await encodePackage(validatePackage(builtin)));
    await unpackPackage(input, root);
    const descriptorPath = join(root, 'game.json'), descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    descriptor.info.name = 'Rebuilt game'; await writeFile(descriptorPath, JSON.stringify(descriptor));
    const rebuilt = await buildGame(descriptorPath, join(directory, 'rebuilt.spacegame'));
    expect(rebuilt.manifest.info.name).toBe('Rebuilt game');
    const profile = join(directory, 'legacy-profile.json'); await writeFile(profile, JSON.stringify(DEFAULT_PROFILE));
    expect((await buildGame(profile, join(directory, 'profile.spacegame'))).legacy.format).toBe('space-lab-game/1');
  });
  it('pins presentation settings and scope-qualified service choices separately from the simulation lock', async () => {
    const game = validatePackage({ ...builtin, bundle: { ...builtin.bundle,
      presentation: { ...builtin.bundle.presentation, settings: { 'builtin.navball': { frame: 1, orientation: 0 } } } } });
    const inspected = await decodeGamePackage(await encodePackage(game), validatePackage);
    expect(inspected.lock.settings['builtin.navball']).toEqual({ frame: 1, orientation: 0 });
    expect(inspected.lock.services['authoritative.motion']).toBe('builtin.motion');
    expect(inspected.lock.services['presentation.renderer']).toBe('builtin.webgl');
    expect(inspected.manifest.settings).toEqual(inspected.lock.settings);
  });
  it('charges outer entries and expanded embedded modules to one game budget', async () => {
    const module = inspectModuleFiles(await readModuleFolder('examples/packages/force'));
    const game = validatePackage({ ...builtin, plugins: [module.code], bundle: { ...builtin.bundle,
      profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id: module.code!.manifest.id, version: module.code!.manifest.version }] },
      code: [{ id: module.code!.manifest.id, version: module.code!.manifest.version, digest: module.code!.digest }] } });
    const bytes = await encodePackage(game), outer = await readZip(bytes), innerBytes = outer.get(`modules/${module.code!.manifest.id}.spacemod`)!;
    const inner = await readZip(innerBytes), sum = (files: Map<string, Uint8Array<ArrayBuffer>>) => [...files.values()].reduce((n, value) => n + value.length, 0);
    const initial = 64 * 1024 * 1024 - sum(outer) - sum(inner) + 1;
    await expect(decodeGamePackage(bytes, validatePackage, { budget: { bytes: initial, files: 0 } })).rejects.toThrow('expanded size');
  });
  it('exports browser-only games without inventing an executable server target', async () => {
    const built = await buildModule(resolve('examples/modules/force/module.json'), undefined, { typecheck: false });
    const { digest: _oldDigest, ...body } = built;
    const restricted = { ...body, manifest: { ...built.manifest, environments: ['browser', 'offline'] as const } };
    const artifact = { ...restricted, digest: artifactDigest(restricted) };
    const game = validatePackage({ ...builtin, plugins: [artifact], bundle: { ...builtin.bundle,
      profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id: artifact.manifest.id, version: artifact.manifest.version }] },
      code: [{ id: artifact.manifest.id, version: artifact.manifest.version, digest: artifact.digest }] } });
    const bytes = await encodePackage(game), inspected = await decodeGamePackage(bytes, validatePackage);
    expect(inspected.manifest.targets.browser).toContain(artifact.manifest.id);
    expect(inspected.manifest.targets.offline).toContain(artifact.manifest.id);
    expect(inspected.manifest.targets.node).toEqual([]); expect(inspected.lock.order.node).toEqual([]);
    expect(await decodePackage(bytes)).toEqual(game);
    const prepared = prepareGame({ environment: 'browser', profile: game.format === 'space-lab-game/1' ? game.bundle.profile : DEFAULT_PROFILE,
      code: artifactModules([artifact], 'browser') });
    prepared.candidate.dispose();
    const path = join(directory, 'browser-only.spacegame'); await writeFile(path, bytes);
    await expect(serverModules({ ...DEFAULT_CONFIG, gameFile: path }, directory)).rejects.toThrow('cannot run on a Node server');
  });
  it('rejects mismatched exact package locks before accepting game contents', async () => {
    const files = await readZip(await encodePackage(validatePackage(builtin)));
    const lock = JSON.parse(new TextDecoder().decode(files.get('game.lock.json')));
    lock.order.node.reverse(); files.set('game.lock.json', jsonBytes(lock)); resign(files);
    await expect(decodePackage(await writeZip(files))).rejects.toThrow('exact lock');
  });
});
