// Local authoring only. None of this bundler/tooling code ships in the game.
import { rolldown } from 'rolldown';
import { parseSync } from 'rolldown/utils';
import { readFile, writeFile, realpath, stat, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const api = resolve(project, 'packages/game-api/src');
const digest = text => createHash('sha256').update(text).digest('hex');
let contracts;
export async function authorContracts() {
  if (!contracts) contracts = (async () => {
    const bundle = await rolldown({ input: resolve(project, 'packages/game-runtime/src/artifact.ts') });
    try {
      const { output } = await bundle.generate({ format: 'esm' });
      return import(`data:text/javascript;base64,${Buffer.from(output[0].code).toString('base64')}`);
    } finally { await bundle.close(); }
  })();
  return contracts;
}
async function locate(path) {
  for (const candidate of [path, `${path}.ts`, `${path}.js`, resolve(path, 'index.ts')]) {
    if ((await stat(candidate).catch(() => undefined))?.isFile()) return realpath(candidate);
  }
  throw new Error(`Missing module input ${path}`);
}
export function inspectAuthorSource(source, path) {
  const parsed = parseSync(path, source);
  if (parsed.errors.length) throw new Error(`${path}: ${parsed.errors[0].message}`);
  const imports = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ImportExpression' || node.type === 'TSImportEqualsDeclaration'
      || (node.type === 'CallExpression' && node.callee?.name === 'require')) throw new Error(`${path}: dynamic imports and require are unsupported; bundle static local inputs`);
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'TSImportType'].includes(node.type) && node.source) {
      if (node.source.type !== 'Literal') throw new Error(`${path}: computed import`);
      imports.push(node.source.value);
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v === 'object') visit(v);
    }
  }
  visit(parsed.program);
  return imports;
}
/** module.json = { manifest, entry, assets?, compatibility, attribution, inputs? }.
 * inputs overrides licensing/attribution for vendored files; dependencies must be vendored.
 * All paths are portable and relative to module.json; only the public API may be outside. */
export async function buildModule(configPath, outputPath, { typecheck = true } = {}) {
  const kit = await authorContracts();
  configPath = await realpath(resolve(configPath));
  const root = dirname(configPath), config = JSON.parse(await readFile(configPath, 'utf8'));
  config.manifest = kit.validateManifest(config.manifest);
  for (const key of Object.keys(config)) if (!['manifest', 'entry', 'assets', 'compatibility', 'attribution', 'inputs'].includes(key)) throw new Error(`Unknown module.json field ${key}`);
  if (config.assets !== undefined && (!Array.isArray(config.assets) || config.assets.length > 128)) throw new Error('module.json assets: expected at most 128 paths');
  if (config.inputs !== undefined && (!config.inputs || typeof config.inputs !== 'object' || Array.isArray(config.inputs))) throw new Error('module.json inputs: expected license records');
  for (const [path, notice] of Object.entries(config.inputs ?? {})) {
    kit.artifactPath(path);
    if (!notice || typeof notice !== 'object' || Array.isArray(notice) || Object.keys(notice).some(key => !['license', 'attribution'].includes(key))
      || typeof notice.license !== 'string' || typeof notice.attribution !== 'string') throw new Error(`Input ${path}: expected license and attribution`);
  }
  const entry = await locate(resolve(root, kit.artifactPath(config.entry)));
  const inputs = new Map(), seen = new Set();
  async function inspect(path) {
    if (seen.has(path)) return;
    seen.add(path);
    const publicInput = path.startsWith(api + sep);
    if (!publicInput && !path.startsWith(root + sep)) throw new Error(`Unsupported private import ${path}; use the public game-api entry point`);
    const source = await readFile(path, 'utf8');
    const portable = publicInput ? `game-api/${relative(api, path).replaceAll('\\', '/')}` : relative(root, path).replaceAll('\\', '/');
    const notice = config.inputs?.[portable];
    if (publicInput && inputs.has(portable)) throw new Error(`Duplicate input path ${portable}`);
    if (!publicInput && portable.startsWith('game-api/')) throw new Error('game-api/ is reserved for public API provenance');
    inputs.set(portable, { path: portable, sha256: digest(source), license: publicInput ? 'LicenseRef-Project' : notice?.license ?? config.manifest.license,
      attribution: publicInput ? 'Space Sim first-party public API' : notice?.attribution ?? config.attribution });
    for (const raw of inspectAuthorSource(source, path)) {
      let target;
      if (raw === '@space-sim/game-api') target = resolve(api, 'index.ts');
      else if (raw.startsWith('.')) target = await locate(resolve(dirname(path), raw));
      else throw new Error(`Unsupported import ${raw}; vendor licensed inputs or use @space-sim/game-api`);
      if (target.startsWith(api + sep) && !publicInput && target !== resolve(api, 'index.ts')) throw new Error('Import only the public game-api entry point');
      await inspect(target);
    }
  }
  await inspect(entry);
  if (typecheck) {
    // A temporary tsconfig beside the entry makes the alias work without installing a package.
    const { mkdtemp, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const temporary = await mkdtemp(resolve(tmpdir(), 'space-sim-module-types-'));
    try {
      const path = resolve(temporary, 'tsconfig.json');
      await writeFile(path, JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, allowJs: true, checkJs: true,
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM'], types: [],
        paths: { '@space-sim/game-api': [resolve(api, 'index.ts')] } }, files: [entry] }));
      execFileSync(process.execPath, [resolve(project, 'node_modules/typescript/bin/tsc'), '-p', path], { stdio: 'pipe' });
    } catch (error) { throw new Error(`Module type check failed:\n${error.stdout?.toString() ?? ''}${error.stderr?.toString() ?? ''}\n${error.message}`); }
    finally { await rm(temporary, { recursive: true, force: true }); }
  }
  const bundle = await rolldown({ input: entry, platform: 'neutral', plugins: [{ name: 'public-api', resolveId(raw) {
    if (raw === '@space-sim/game-api') return resolve(api, 'index.ts');
  } }], onwarn(warning) { throw new Error(warning.message); } });
  let source;
  try {
    const { output } = await bundle.generate({ format: 'iife', name: 'SpaceSimModule', exports: 'named', codeSplitting: false });
    if (output.length !== 1 || output[0].type !== 'chunk' || output[0].imports.length || output[0].dynamicImports.length) throw new Error('Expected one self-contained script');
    if (!output[0].exports.includes('default')) throw new Error('Module entry must export a default initializer');
    source = output[0].code;
  } finally { await bundle.close(); }
  const assets = Object.create(null);
  for (const raw of config.assets ?? []) {
    const path = kit.artifactPath(raw), local = await realpath(resolve(root, path));
    if (!local.startsWith(root + sep)) throw new Error(`Asset outside module: ${path}`);
    if (inputs.has(path)) throw new Error(`Asset collides with source ${path}`);
    assets[path] = await readFile(local, 'utf8');
    const notice = config.inputs?.[path];
    inputs.set(path, { path, sha256: digest(assets[path]), license: notice?.license ?? config.manifest.license, attribution: notice?.attribution ?? config.attribution });
  }
  for (const path of Object.keys(config.inputs ?? {})) if (!inputs.has(path)) throw new Error(`License input ${path} was not bundled`);
  const body = { format: 'space-sim-code-module/1', manifest: config.manifest, source, assets,
    inputs: [...inputs.values()].sort((a, b) => a.path.localeCompare(b.path)), compatibility: config.compatibility };
  const artifact = kit.parseCodeArtifact(JSON.stringify({ ...body, digest: kit.artifactDigest(body) }));
  if (outputPath) {
    await mkdir(dirname(resolve(outputPath)), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(artifact, null, 2)}\n`);
  }
  return artifact;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, input, output] = process.argv.slice(2);
    if (command === 'build' && input && output) {
      const artifact = await buildModule(input, output);
      console.log(`Built ${artifact.manifest.id}@${artifact.manifest.version}: ${artifact.digest}\n${output}`);
    } else if (command === 'validate' && input) {
      const artifact = (await authorContracts()).parseCodeArtifact(await readFile(input, 'utf8'));
      console.log(`Valid ${artifact.manifest.id}@${artifact.manifest.version}: ${artifact.digest} (${artifact.inputs.length} licensed inputs); code was not executed`);
    } else throw new Error('Usage: npm run module:build -- module.json output.module.json\n       npm run module:validate -- output.module.json');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
