// Local filesystem/bundler adapter. Archive inspection never evaluates package JavaScript.
import { rolldown } from 'rolldown';
import { readFile, writeFile, lstat, readdir, mkdir, realpath } from 'node:fs/promises';
import { resolve, dirname, relative, sep, parse } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModule } from './author.mjs';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let contractPromise;
export async function packageContracts() {
  return contractPromise ??= (async () => {
    const bundle = await rolldown({ input: resolve(project, 'packages/game-library/src/tooling.ts') });
    try {
      const { output } = await bundle.generate({ format: 'esm' });
      return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
    } finally { await bundle.close(); }
  })();
}
/** Walk real parents before creating anything. No symlink traversal on read or unpack. */
async function safeParents(path) {
  const target = resolve(path), root = parse(target).root;
  let current = root;
  for (const part of relative(root, target).split(sep)) {
    current = resolve(current, part);
    const info = await lstat(current).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (info?.isSymbolicLink()) throw new Error(`Symlink path forbidden: ${current}`);
  }
  return target;
}
export async function readModuleFolder(directory) {
  const kit = await packageContracts(), root = await realpath(await safeParents(directory)), files = new Map();
  let total = 0;
  async function walk(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const local = resolve(path, entry.name), portable = relative(root, local).replaceAll('\\', '/');
      kit.artifactPath(portable);
      const info = await lstat(local);
      if (info.isSymbolicLink() || !info.isDirectory() && !info.isFile()) throw new Error(`Regular files only: ${portable}`);
      if (info.isDirectory()) { await walk(local); continue; }
      if (info.mode & 0o111) throw new Error(`Executable file permissions forbidden: ${portable}`);
      if (files.size >= 1024 || info.size > kit.fileLimit(portable) || (total += info.size) > kit.MAX_EXPANDED_BYTES) throw new Error('Folder exceeds package limits');
      files.set(portable, new Uint8Array(await readFile(local)));
    }
  }
  await walk(root);
  kit.validateFilePaths([...files.keys()]);
  return files;
}
async function writeOutput(path, bytes) {
  const output = await safeParents(path);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, bytes);
}
/** Build editable package folders using the existing static-import/typecheck/IIFE toolchain. */
export async function buildPortableModule(configPath, outputPath, options = {}) {
  const kit = await packageContracts(), path = resolve(configPath), root = dirname(path);
  const raw = JSON.parse(await readFile(path, 'utf8'));
  if (raw.format !== kit.PACKAGE_FORMAT && raw.format !== kit.DATA_PACKAGE_FORMAT) {
    throw new Error('Legacy source descriptor: choose module:build with output.module.json, or migrate with module:convert before packing');
  }
  const descriptor = kit.validateDescriptor(raw);
  if (descriptor.sourceStatus === 'legacy-unavailable') throw new Error('Original editable source is unavailable; supply source in a new creator package to rebuild');
  const files = await readModuleFolder(root);
  if (descriptor.manifest.kind === 'provider') {
    const artifact = await buildModule(path, undefined, options);
    files.set('dist/module.js', kit.textBytes(artifact.source));
    const toolchain = `rolldown/${JSON.parse(await readFile(resolve(project, 'node_modules/rolldown/package.json'), 'utf8')).version};typescript/${JSON.parse(await readFile(resolve(project, 'node_modules/typescript/package.json'), 'utf8')).version};api/${descriptor.manifest.format === 'space-sim-module/2' ? '2' : '1'}`;
    const binary = descriptor.assets.filter(a => !a.mediaType.startsWith('text/') && a.mediaType !== 'application/json');
    const binaryInputs = binary.map(a => {
      const old = descriptor.inputs.find(i => i.path === a.path);
      return { path: a.path, sha256: kit.sha256Bytes(files.get(a.path)), license: old?.license ?? descriptor.manifest.license, attribution: old?.attribution ?? 'Local binary asset; see LICENSE and NOTICE' };
    });
    let updated = { ...descriptor, inputs: [...artifact.inputs, ...binaryInputs], build: { bundle: 'dist/module.js', toolchain, inputsDigest: '0'.repeat(64) } };
    updated = { ...updated, build: { ...updated.build, inputsDigest: kit.buildInputsDigest(files, updated) } };
    files.set('module.json', kit.textBytes(JSON.stringify(updated, null, 2) + '\n'));
  }
  files.set('integrity.json', kit.jsonBytes(kit.createIntegrity(files)));
  const inspected = kit.inspectModuleFiles(files);
  const descriptorFile = files.has('data.json') ? 'data.json' : 'module.json';
  await writeOutput(resolve(root, descriptorFile), files.get(descriptorFile));
  if (files.has('dist/module.js')) await writeOutput(resolve(root, 'dist/module.js'), files.get('dist/module.js'));
  await writeOutput(resolve(root, 'integrity.json'), files.get('integrity.json'));
  if (outputPath) {
    if (outputPath.endsWith('.module.json') && inspected.code) await writeOutput(outputPath, kit.jsonBytes(inspected.code));
    else await writeOutput(outputPath, await kit.encodeModuleFiles(files));
  }
  return inspected;
}
export async function packModule(directory, outputPath, { compression = 'auto' } = {}) {
  const kit = await packageContracts(), root = resolve(directory), output = resolve(outputPath);
  if (output.startsWith(root + sep)) throw new Error('Write the archive outside its source folder');
  const files = await readModuleFolder(root);
  files.set('integrity.json', kit.jsonBytes(kit.createIntegrity(files)));
  let checked;
  if (files.has('save.json')) checked = kit.inspectSaveFiles(files);
  else if (files.has('game.json')) checked = await kit.inspectGameFiles(files, kit.validatePackage, { budget: { bytes: [...files.values()].reduce((n, value) => n + value.length, 0), files: files.size } });
  else if (files.has('data.json')) checked = kit.inspectDataFiles(files);
  else checked = kit.inspectModuleFiles(files);
  const bytes = await kit.writeZip(files, { compression });
  await writeOutput(output, bytes);
  return checked;
}
/** Archive is fully checked before destination creation; existing nonempty folders are refused. */
export async function unpackPackage(input, directory) {
  const kit = await packageContracts(), bytes = new Uint8Array(await readFile(input));
  const budget = { bytes: 0, files: 0 }, files = await kit.readZip(bytes, { budget });
  if (files.has('game.json')) await kit.inspectGameFiles(files, kit.validatePackage, { budget });
  else if (files.has('save.json')) kit.inspectSaveFiles(files);
  else if (files.has('data.json')) kit.inspectDataFiles(files);
  else kit.inspectModuleFiles(files, false);
  const target = await safeParents(directory), existing = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (existing && (!existing.isDirectory() || (await readdir(target)).length)) throw new Error('Unpack destination must be a new or empty directory');
  await mkdir(target, { recursive: true });
  for (const [path, contents] of files) {
    const output = resolve(target, path);
    if (!output.startsWith(target + sep)) throw new Error('Extraction outside destination');
    await safeParents(output); await mkdir(dirname(output), { recursive: true });
    await writeFile(output, contents, { flag: 'wx', mode: 0o644 });
  }
  return files;
}
export async function newModule(id, directory = id) {
  const kit = await packageContracts();
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(id) || id.startsWith('builtin.')) throw new Error('Choose a creator namespace such as local.my-module');
  const root = await safeParents(directory);
  if (await lstat(root).catch(error => { if (error.code !== 'ENOENT') throw error; })) throw new Error('Scaffold destination already exists');
  const manifest = { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id, version: '0.1.0', kind: 'provider', authority: 'authoritative',
    environments: ['browser', 'offline', 'node'], dependencies: [], provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license: 'MIT' };
  const descriptor = { format: kit.PACKAGE_FORMAT, manifest, entry: 'src/main.ts', compatibility: { deterministic: true, multiplayer: false }, assets: [], data: [], guides: [], inputs: [], sourceStatus: 'included' };
  await mkdir(resolve(root, 'src'), { recursive: true });
  await writeFile(resolve(root, 'module.json'), JSON.stringify(descriptor, null, 2) + '\n');
  await writeFile(resolve(root, 'src/main.ts'), "import type { ModuleInitialization } from '@space-sim/game-api';\nexport default function initialize(_context: ModuleInitialization): void {}\n");
  await writeFile(resolve(root, 'LICENSE'), await readFile(resolve(project, 'LICENSE')));
  await writeFile(resolve(root, 'NOTICE'), `Module ${id}, licensed under MIT. Replace with your author attribution.\nPublic game-api inputs: Space Sim contributors, MIT (LICENSE).\n`);
  return descriptor;
}
/** Convert legacy author folders using actual local source, never fabricated TypeScript. */
export async function convertModule(configPath, directory, options = {}) {
  const kit = await packageContracts(), root = dirname(resolve(configPath)), original = new Uint8Array(await readFile(configPath));
  const config = /\.(frag|glsl)$/i.test(configPath)
    ? { format: 'space-sim-shaders/1', name: configPath.split(/[\\/]/).pop().slice(0, 80), passes: { scene: { fragment: new TextDecoder('utf-8', { fatal: true }).decode(original) } } }
    : await kit.readJsonFile(original);
  if (config.format || config.systems || config.bodies) {
    const needsLicense = config.format !== 'space-sim-code-module/1';
    if (needsLicense && !options.licenseFile) throw new Error('Data conversion requires --license-file with the original author license text; universe/shader conversion also requires --license');
    if ((config.format === 'space-sim-shaders/1' || !config.format) && !options.license) throw new Error('Specify the original author license with --license');
    const license = options.licenseFile ? await readFile(options.licenseFile, 'utf8') : '';
    let files;
    if (config.format === 'space-sim-code-module/1') files = kit.wrapLegacyCode(kit.parseCodeArtifact(JSON.stringify(config)));
    else if (config.format === 'space-sim-data-module/1') files = kit.wrapLegacyData(config, license);
    else if (config.format === 'space-sim-shaders/1') files = kit.wrapShaderPackage(config, license, options.license);
    else if (!config.format && (config.systems || config.bodies)) files = kit.wrapUniversePackage(config, license, options.license);
    else throw new Error('A legacy collection/profile converts with game:build; one .spacemod holds one module');
    // Keep the supplied bytes available for provenance/diagnosis, including compressed inputs.
    files.set('legacy/original.bin', original);
    files.set('integrity.json', kit.jsonBytes(kit.createIntegrity(files)));
    const checked = kit.inspectModuleFiles(files), target = await safeParents(directory);
    if (await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; })) throw new Error('Conversion destination already exists');
    for (const [path, bytes] of files) await writeOutput(resolve(target, path), bytes);
    return checked;
  }
  await readModuleFolder(root);
  const artifact = await buildModule(configPath, undefined, options);
  await newModule(artifact.manifest.id, directory);
  const assets = new Set(config.assets ?? []), inputs = [], mappings = new Map();
  for (const input of artifact.inputs) {
    if (input.path.startsWith('game-api/')) continue;
    const path = (assets.has(input.path) ? 'assets/' : 'src/') + input.path;
    mappings.set(input.path, path);
    await safeParents(resolve(root, input.path));
    await writeOutput(resolve(directory, path), await readFile(resolve(root, input.path)));
    inputs.push({ ...input, path });
  }
  // Existing source uses context.assets keys. Keep its v1 names through a tiny editable entry adapter.
  const sourceEntry = mappings.get(config.entry);
  const adapter = `import initialize from './${relative(resolve('src'), resolve(sourceEntry)).replaceAll('\\', '/').replace(/\.[cm]?[jt]sx?$/, '')}';\nimport type { ModuleInitialization } from '@space-sim/game-api';\nexport default function entry(context: ModuleInitialization): void {\n  initialize({ ...context, assets: { ...context.assets, ${[...assets].map(path => `${JSON.stringify(path)}: context.assets[${JSON.stringify('assets/' + path)}]!`).join(', ')} } });\n}\n`;
  await writeFile(resolve(directory, 'src/entry.ts'), adapter);
  const descriptor = { format: kit.PACKAGE_FORMAT, manifest: artifact.manifest, entry: 'src/entry.ts', compatibility: artifact.compatibility,
    assets: [...assets].map(path => ({ path: 'assets/' + path, mediaType: 'text/plain' })), data: [], guides: [], inputs, sourceStatus: 'included' };
  await writeFile(resolve(directory, 'module.json'), JSON.stringify(descriptor, null, 2) + '\n');
  await writeFile(resolve(directory, 'NOTICE'), artifact.inputs.map(i => `${i.path}\n${i.license}\n${i.attribution}`).join('\n\n') + '\n');
  return buildPortableModule(resolve(directory, 'module.json'), undefined, options);
}
export async function buildGame(inputPath, outputPath) {
  const kit = await packageContracts(), bytes = new Uint8Array(await readFile(inputPath));
  const input = await kit.readJsonFile(bytes), authored = new Map();
  let raw, sourceDescriptor;
  if (input.format === 'spacelab-game/2') {
    sourceDescriptor = input;
    if (Object.keys(input).some(key => !['format', 'info', 'engineApi', 'modules', 'targets', 'settings', 'content', 'legacy', 'runtime'].includes(key))) throw new Error('Unknown game source field');
    const root = dirname(resolve(inputPath));
    if (input.legacy?.path !== 'legacy/package.json' || !Array.isArray(input.modules) || input.modules.length > 256) throw new Error('Invalid game source descriptor');
    const old = kit.validatePackage(await kit.readJsonFile(new Uint8Array(await readFile(await safeParents(resolve(root, input.legacy.path))))));
    const modules = [], runtimeFiles = new Map();
    const runtime = input.runtime ? kit.validateRuntimeSelection(input.runtime) : undefined;
    const runtimeIds = new Set(runtime ? kit.runtimeReferences(runtime).map(ref => ref.id) : []);
    for (const ref of input.modules) {
      if (Object.keys(ref).some(key => !['id', 'version', 'role', 'path'].includes(key)) || !['required', 'optional'].includes(ref.role)) throw new Error('Invalid game requirement');
      if (ref.path !== `modules/${ref.id}.spacemod` && ref.path !== `data/${ref.id}.spacedata`) throw new Error('Game references must use modules/<id>.spacemod or data/<id>.spacedata');
      kit.artifactPath(ref.path);
      const bytes = new Uint8Array(await readFile(await safeParents(resolve(root, ref.path))));
      const module = await kit.decodeModulePackage(bytes);
      if (module.descriptor.manifest.id !== ref.id || !kit.satisfies(module.descriptor.manifest.version, ref.version)) throw new Error('Game module version mismatch');
      if (runtimeIds.has(ref.id)) runtimeFiles.set(ref.path, bytes);
      else { authored.set(ref.id, module.files); modules.push(module); }
    }
    if (runtime) kit.attachRuntimeFiles(runtime, runtimeFiles);
    const data = modules.filter(m => m.content).map(m => m.content), code = modules.filter(m => m.code).map(m => m.code);
    if (modules.length !== data.length + code.length) throw new Error('This payload has no v1 game adapter; import reusable shader/universe data through its dedicated control');
    const versions = new Map(modules.map(m => [m.descriptor.manifest.id, m.descriptor.manifest.version]));
    const profile = value => ({ ...value, modules: value.modules.map(ref => ({ ...ref, version: versions.get(ref.id) ?? ref.version })),
      settings: Object.fromEntries(Object.entries(input.settings).filter(([id]) => value.modules.some(ref => ref.id === id))) });
    if (old.format === 'space-lab-game/1' && Object.keys(input.settings).some(id => ![...old.bundle.profile.modules, ...(old.bundle.presentation?.modules ?? [])].some(ref => ref.id === id))) throw new Error('Settings must belong to a selected module');
    raw = kit.validatePackage(old.format === 'space-lab-game/1'
      ? { ...old, ...(runtime ? { runtime } : {}), info: input.info, plugins: code, bundle: { ...old.bundle, modules: data, selection: input.content,
        profile: profile(old.bundle.profile),
        ...(old.bundle.presentation ? { presentation: profile(old.bundle.presentation) } : {}),
        code: code.map(m => ({ id: m.manifest.id, version: m.manifest.version, digest: m.digest })) } }
      : { ...old, info: input.info, data, code });
    const generated = await kit.createGameFiles(raw, authored);
    const expected = JSON.parse(new TextDecoder().decode(generated.get('game.json')));
    if (JSON.stringify(input.targets) !== JSON.stringify(expected.targets)) {
      if (kit.canonicalJson(input.targets) !== kit.canonicalJson(expected.targets)) throw new Error('Target changes require a matching legacy profile; edit legacy/package.json before rebuilding');
    }
  } else if (input.format === 'space-sim-module-profile/1' || input.format === 'space-sim-profile/1') {
    const bundle = input.format === 'space-sim-module-profile/1' ? input : { format: 'space-sim-module-profile/1', profile: input, modules: [], selection: { universe: 'builtin.content/default-universe' } };
    raw = kit.validatePackage({ format: 'space-lab-game/1', info: { id: 'local.imported-profile', name: 'Imported profile', description: '' }, bundle, plugins: [] });
  } else raw = kit.validatePackage(input);
  const files = await kit.createGameFiles(raw, authored);
  if (sourceDescriptor) {
    const generated = JSON.parse(new TextDecoder().decode(files.get('game.json')));
    files.set('game.json', kit.jsonBytes({ ...generated, engineApi: sourceDescriptor.engineApi,
      modules: generated.modules.map(ref => sourceDescriptor.modules.find(m => m.id === ref.id)) }));
    files.set('integrity.json', kit.jsonBytes(kit.createIntegrity(files)));
  }
  const output = await kit.writeZip(files);
  const checked = await kit.decodeGamePackage(output, kit.validatePackage);
  await writeOutput(outputPath, output);
  return checked;
}

export async function run(args) {
  try {
    const [command, input, output] = args;
    let result;
    if (command === 'new' && input) result = await newModule(input, output);
    else if (command === 'convert' && input && output) {
      const rest = args.slice(3), options = {};
      while (rest.length) {
        const flag = rest.shift(), value = rest.shift();
        if (!value || !['--license', '--license-file'].includes(flag)) throw new Error('Conversion options: --license SPDX --license-file path');
        options[flag === '--license' ? 'license' : 'licenseFile'] = value;
      }
      result = await convertModule(input, output, options);
    }
    else if (command === 'build' && input) {
      const raw = JSON.parse(await readFile(input, 'utf8'));
      if (raw.format === 'spacelab-module-package/1' || raw.format === 'spacelab-data-package/1') result = await buildPortableModule(input, output);
      else {
        if (!output?.endsWith('.module.json')) throw new Error('Legacy source descriptor: choose output.module.json, or migrate with module:convert before packing');
        result = await buildModule(input, output);
      }
    }
    else if (command === 'pack' && input && output) result = await packModule(input, output, { compression: args.includes('--store') ? 'store' : 'auto' });
    else if (command === 'unpack' && input && output) result = await unpackPackage(input, output);
    else if (command === 'game-build' && input && output) result = await buildGame(input, output);
    else if ((command === 'validate' || command === 'game-validate') && input) {
      const kit = await packageContracts(), info = await lstat(input);
      if (info.isDirectory()) {
        const files = await readModuleFolder(input);
        result = files.has('save.json') ? kit.inspectSaveFiles(files) : files.has('data.json') ? kit.inspectDataFiles(files) : kit.inspectModuleFiles(files);
      } else {
        if (info.size > kit.MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds 32 MiB');
        const bytes = new Uint8Array(await readFile(input));
        if (kit.isZip(bytes)) {
          const budget = { bytes: 0, files: 0 }, files = await kit.readZip(bytes, { budget });
          result = files.has('game.json') ? await kit.inspectGameFiles(files, kit.validatePackage, { budget })
            : files.has('save.json') ? kit.inspectSaveFiles(files) : files.has('data.json') ? kit.inspectDataFiles(files) : kit.inspectModuleFiles(files);
          if (command === 'game-validate' && !files.has('game.json')) throw new Error('Expected a .spacegame collection');
        }
        else {
          const raw = await kit.readJsonFile(bytes);
          result = command === 'game-validate' ? kit.validatePackage(raw) : kit.parseCodeArtifact(JSON.stringify(raw));
        }
      }
    } else throw new Error('Usage: module:new id [folder] | module:convert module.json folder | module:build module.json [output.spacemod] | module:pack folder output.spacemod | module:unpack file folder | module:validate file-or-folder | game:build game.json output.spacegame | game:validate file');
    console.log(`Completed ${command}: ${result?.integrity?.digest ?? result?.digest ?? input}. Code was not executed.`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run(process.argv.slice(2));
