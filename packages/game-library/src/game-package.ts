import type { ModuleProfile } from '../../game-api/src/index';
import type { LabPackage, GamePackage, PackageInfo } from './archive';
import { canonicalJson } from '../../game-runtime/src/authoritative';
import { freezeJson, keys, object, string } from '../../game-runtime/src/validation';
import { satisfies, validRange } from '../../game-runtime/src/semver';
import { createBuiltinRegistry } from '../../modules/src/index';
import { artifactModules, validatePackage } from './archive';
import { createIntegrity, decodeModulePackage, encodeModuleFiles, inspectModuleFiles, jsonBytes, parsePackageJson, requiredFile, verifyIntegrity,
  wrapLegacyCode, wrapLegacyData, packageFiles, copyPackageFiles, type InspectedModule, type ShippedPackageOptions } from './portable';
import { readZip, writeZip, type PackageFiles, type ZipOptions } from './zip';
import { attachRuntimeFiles, runtimeReferences, runtimeSelectionFiles, type RuntimeSelection } from './runtime-selection';

export interface GameRequirement { readonly id: string; readonly version: string; readonly role: 'required' | 'optional'; readonly path?: string }
/** Legacy base profiles and explicit v2 target plans travel together; hosts resolve v2
 * services against their real adapters before executing any selected initializer. */
export interface PortableGame {
  readonly format: 'spacelab-game/2'; readonly info: PackageInfo; readonly engineApi: string;
  readonly modules: readonly GameRequirement[];
  readonly targets: Readonly<Record<'browser' | 'offline' | 'node', readonly string[]>>;
  readonly settings: ModuleProfile['settings']; readonly content: GamePackage['bundle']['selection'];
  readonly legacy: { readonly format: 'space-lab-game/1' | 'space-lab-plugin/1'; readonly path: 'legacy/package.json' };
  readonly runtime?: RuntimeSelection;
}
export interface GamePackageLock {
  readonly format: 'spacelab-game-lock/1'; readonly resolution: 'legacy-v1' | 'mixed-v2';
  readonly modules: readonly { readonly id: string; readonly version: string; readonly digest: string; readonly legacyDigest?: string }[];
  readonly targets: PortableGame['targets']; readonly settings: ModuleProfile['settings'];
  /** Legacy adapter order. Exact v2 schedules/bindings are resolved by the target host. */
  readonly order: Readonly<Record<'browser' | 'offline' | 'node', readonly string[]>>;
  readonly services: Readonly<Record<string, string>>; readonly bindings: Readonly<Record<string, string>>;
  readonly runtime?: RuntimeSelection;
}
export interface InspectedGame { readonly manifest: PortableGame; readonly lock: GamePackageLock; readonly modules: readonly InspectedModule[]; readonly legacy: LabPackage; readonly files: PackageFiles }
const projectLicense = 'Legacy content retained under its declared license; consult the original author for license text.';
function selected(raw: LabPackage, environment: 'browser' | 'offline' | 'node', includeRuntime = true): string[] {
  if (raw.format === 'space-lab-plugin/1') return [...raw.data, ...raw.code].filter(m => m.manifest.environments.includes(environment)).map(m => m.manifest.id);
  const refs = [...raw.bundle.profile.modules, ...(environment === 'node' ? [] : raw.bundle.presentation?.modules ?? [])];
  const custom = [...raw.bundle.modules, ...raw.plugins];
  // All selected modules are required by this legacy profile. Omitting an incompatible
  // authoritative module would silently turn it into a different game.
  if (refs.some(ref => custom.some(m => m.manifest.id === ref.id && !m.manifest.environments.includes(environment)))) return [];
  // Builtin engine providers remain supplied by the v1 host; they are not fabricated packages.
  if (raw.runtime && !raw.runtime.plans[environment]) return [];
  return [...new Set([...refs.map(ref => ref.id), ...(includeRuntime ? raw.runtime?.plans[environment]?.profile.modules.map(ref => ref.id) ?? [] : [])])];
}
function runtime(raw: LabPackage): RuntimeSelection | undefined { return raw.format === 'space-lab-game/1' ? raw.runtime : undefined; }
function exactModules(modules: readonly InspectedModule[]): GamePackageLock['modules'] {
  return modules.map(m => ({ id: m.descriptor.manifest.id, version: m.descriptor.manifest.version, digest: m.integrity.digest,
    ...(m.code ? { legacyDigest: m.code.digest } : {}) }));
}
/** Both legacy profile scopes are pinned, while the simulation lock remains authoritative-only. */
function gameSettings(raw: LabPackage): ModuleProfile['settings'] {
  if (raw.format !== 'space-lab-game/1') return {};
  const settings: Record<string, Readonly<Record<string, number>>> = { ...raw.bundle.profile.settings };
  for (const [id, values] of Object.entries(raw.bundle.presentation?.settings ?? {})) {
    if (settings[id] && canonicalJson(settings[id]) !== canonicalJson(values)) throw new Error(`Conflicting legacy settings for ${id}`);
    settings[id] = values;
  }
  return settings;
}
function runtimeResolution(raw: LabPackage): { order: GamePackageLock['order']; services: Record<string, string> } {
  if (raw.format === 'space-lab-plugin/1') return { order: { browser: selected(raw, 'browser'), offline: selected(raw, 'offline'), node: selected(raw, 'node') }, services: {} };
  const registry = createBuiltinRegistry(raw.bundle.modules, artifactModules(raw.plugins.filter(m => m.manifest.authority === 'authoritative'), 'node'));
  const targets = { browser: selected(raw, 'browser', false), offline: selected(raw, 'offline', false), node: selected(raw, 'node', false) };
  let nodeOrder: readonly string[] = [];
  let compatible = false;
  for (const environment of ['browser', 'offline', 'node'] as const) {
    if (!targets[environment].length) continue;
    const resolved = registry.resolve(raw.bundle.profile, environment, ['motion', 'content']);
    compatible = true;
    if (environment === 'node') nodeOrder = resolved.order;
  }
  if (!compatible) throw new Error('No target can run this complete module selection; choose modules with a shared environment');
  return { order: { browser: targets.browser, offline: targets.offline, node: nodeOrder }, services: Object.fromEntries([
    ...Object.entries(raw.bundle.profile.providers).map(([slot, id]) => [`authoritative.${slot}`, id]),
    ...Object.entries(raw.bundle.presentation?.providers ?? {}).map(([slot, id]) => [`presentation.${slot}`, id]),
  ]) };
}
export async function createGameFiles(raw: LabPackage, authored: ReadonlyMap<string, PackageFiles> = new Map(), options: ShippedPackageOptions = {}): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  const data = raw.format === 'space-lab-game/1' ? raw.bundle.modules : raw.data, code = raw.format === 'space-lab-game/1' ? raw.plugins : raw.code;
  const files = new Map<string, Uint8Array<ArrayBuffer>>(), modules: InspectedModule[] = [];
  const requirements: GameRequirement[] = [];
  for (const m of [...data, ...code]) {
    const contents = authored.get(m.manifest.id) ?? packageFiles(m) ?? (m.format === 'space-sim-code-module/1' ? wrapLegacyCode(m) : wrapLegacyData(m, projectLicense));
    const module = inspectModuleFiles(contents, true, options), path = m.manifest.kind === 'data' ? `data/${m.manifest.id}.spacedata` : `modules/${m.manifest.id}.spacemod`;
    if (module.descriptor.manifest.id !== m.manifest.id || module.descriptor.manifest.version !== m.manifest.version
      || m.format === 'space-sim-code-module/1' && module.code?.digest !== m.digest
      || m.format === 'space-sim-data-module/1' && canonicalJson(module.content) !== canonicalJson(m)) throw new Error(`Authored module differs from legacy runtime selection: ${m.manifest.id}`);
    modules.push(module); files.set(path, await encodeModuleFiles(contents, options));
    requirements.push({ id: m.manifest.id, version: m.manifest.version, role: 'required', path });
  }
  const selection = runtime(raw);
  if (selection) for (const ref of runtimeReferences(selection)) {
    const path = `modules/${ref.id}.spacemod`, bytes = runtimeSelectionFiles(selection).get(path);
    if (!bytes) throw new Error(`Missing exact runtime package ${ref.id}`);
    const module = await decodeModulePackage(bytes, options);
    if (module.descriptor.manifest.id !== ref.id || module.descriptor.manifest.version !== ref.version || module.integrity.digest !== ref.digest) throw new Error(`Runtime package identity mismatch: ${ref.id}`);
    if (module.descriptor.manifest.kind === 'data') throw new Error('Put reusable content in the game data profile; runtime target extras require code modules');
    modules.push(module); files.set(path, bytes.slice());
    requirements.push({ id: ref.id, version: ref.version, role: 'required', path });
  }
  const targets = { browser: selected(raw, 'browser'), offline: selected(raw, 'offline'), node: selected(raw, 'node') };
  const manifest: PortableGame = { format: 'spacelab-game/2', info: raw.info, engineApi: selection ? '^2.0.0' : '^1.0.0', modules: requirements, targets,
    settings: gameSettings(raw), content: raw.format === 'space-lab-game/1' ? raw.bundle.selection : { universe: 'builtin.content/default-universe' },
    legacy: { format: raw.format, path: 'legacy/package.json' }, ...(selection ? { runtime: selection } : {}) };
  const resolution = runtimeResolution(raw);
  const lock: GamePackageLock = { format: 'spacelab-game-lock/1', resolution: selection ? 'mixed-v2' : 'legacy-v1', modules: exactModules(modules),
    targets, settings: manifest.settings, order: resolution.order, services: resolution.services, bindings: {}, ...(selection ? { runtime: selection } : {}) };
  files.set('game.json', jsonBytes(manifest)); files.set('game.lock.json', jsonBytes(lock)); files.set('legacy/package.json', jsonBytes(raw));
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return files;
}
/** Validation compares package identities and legacy identities separately, without evaluating code.
 * The v1 resolver validates authoritative dependencies/order. Viewer activation stays in its host. */
export async function inspectGameFiles(files: PackageFiles, validateLegacy: (raw: unknown) => LabPackage, options: ZipOptions & ShippedPackageOptions = {}): Promise<InspectedGame> {
  verifyIntegrity(files);
  const manifest = object(parsePackageJson(requiredFile(files, 'game.json'), 'Game descriptor'), 'Game');
  keys(manifest, ['format', 'info', 'engineApi', 'modules', 'targets', 'settings', 'content', 'legacy', 'runtime'], 'Game');
  if (manifest.format !== 'spacelab-game/2' || !validRange(string(manifest.engineApi, 'Engine API')) || !['1.0.0', '2.0.0'].some(v => satisfies(v, manifest.engineApi as string))) throw new Error('Unsupported game/API format');
  const legacy = object(manifest.legacy, 'Legacy game'); keys(legacy, ['format', 'path'], 'Legacy game');
  if (legacy.path !== 'legacy/package.json') throw new Error('Missing legacy runtime profile');
  const raw = validateLegacy(parsePackageJson(requiredFile(files, legacy.path), 'Legacy package', 4 * 1024 * 1024));
  if (legacy.format !== raw.format || canonicalJson(manifest.info) !== canonicalJson(raw.info)) throw new Error('Game metadata differs from legacy adapter');
  const selection = runtime(raw);
  if (canonicalJson(manifest.runtime ?? null) !== canonicalJson(selection ?? null) || selection && !satisfies('2.0.0', manifest.engineApi as string)) throw new Error('Game runtime selection mismatch');
  if (!Array.isArray(manifest.modules) || manifest.modules.length > 256) throw new Error('Game requires at most 256 modules');
  const modules: InspectedModule[] = [], seen = new Set<string>(), paths = new Set(['game.json', 'game.lock.json', 'integrity.json', legacy.path]);
  for (const value of manifest.modules) {
    const ref = object(value, 'Game module'); keys(ref, ['id', 'version', 'role', 'path'], 'Game module');
    const id = string(ref.id, 'Module ID');
    if (seen.has(id) || !validRange(string(ref.version, 'Module range')) || !['required', 'optional'].includes(ref.role as string)) throw new Error('Duplicate/invalid game requirement');
    seen.add(id);
    if (ref.path !== `modules/${id}.spacemod` && ref.path !== `data/${id}.spacedata`) throw new Error(`Import the missing exact package for ${id}; portable exports embed each selected module`);
    paths.add(ref.path as string);
    const module = await decodeModulePackage(requiredFile(files, ref.path as string), { ...options, maxFiles: 1024 });
    if ((module.descriptor.manifest.kind === 'data') !== (ref.path === `data/${id}.spacedata`)) throw new Error('Put data packages in data/ and code modules in modules/');
    if (module.descriptor.manifest.id !== id || !satisfies(module.descriptor.manifest.version, ref.version as string)) throw new Error('Embedded module identity/version mismatch');
    modules.push(module);
  }
  if ([...files.keys()].some(path => !paths.has(path))) throw new Error('Unexpected or nested game entry');
  const data = raw.format === 'space-lab-game/1' ? raw.bundle.modules : raw.data, code = raw.format === 'space-lab-game/1' ? raw.plugins : raw.code;
  const runtimeRefs = selection ? runtimeReferences(selection) : [];
  if (data.length + code.length + runtimeRefs.length !== modules.length) throw new Error('Game/legacy module selections differ');
  for (const module of modules) {
    const id = module.descriptor.manifest.id, originalCode = code.find(m => m.manifest.id === id), originalData = data.find(m => m.manifest.id === id);
    const ref = runtimeRefs.find(ref => ref.id === id);
    if (ref) {
      if (module.descriptor.manifest.kind === 'data') throw new Error('Runtime target extras require code modules');
      if (module.integrity.digest !== ref.digest || module.descriptor.manifest.version !== ref.version) throw new Error(`Runtime exact package mismatch: ${id}`);
      for (const [environment, plan] of Object.entries(selection!.plans)) if (plan.packages.some(p => p.id === id) && !module.descriptor.manifest.environments.includes(environment as 'browser' | 'offline' | 'node')) throw new Error(`Runtime package ${id} cannot run in ${environment}`);
      continue;
    }
    if (module.code ? module.code.digest !== originalCode?.digest : !module.content || canonicalJson(module.content) !== canonicalJson(originalData)) throw new Error('Game/legacy module digest mismatch');
    if (module.code && originalCode) copyPackageFiles(module.code, originalCode);
    if (module.content && originalData) copyPackageFiles(module.content, originalData);
  }
  if (selection) attachRuntimeFiles(selection, new Map(runtimeRefs.map(ref => {
    const path = `modules/${ref.id}.spacemod`; return [path, requiredFile(files, path).slice()];
  })));
  // Regenerate only metadata. Do not recompress inner archives or evaluate initializers.
  const targets = { browser: selected(raw, 'browser'), offline: selected(raw, 'offline'), node: selected(raw, 'node') };
  const settings = gameSettings(raw);
  const content = raw.format === 'space-lab-game/1' ? raw.bundle.selection : { universe: 'builtin.content/default-universe' };
  if (canonicalJson(manifest.targets) !== canonicalJson(targets) || canonicalJson(manifest.settings) !== canonicalJson(settings) || canonicalJson(manifest.content) !== canonicalJson(content)) throw new Error('Game target/settings/content mismatch');
  const resolution = runtimeResolution(raw);
  const expected: GamePackageLock = { format: 'spacelab-game-lock/1', resolution: selection ? 'mixed-v2' : 'legacy-v1', modules: exactModules(modules), targets, settings,
    order: resolution.order, services: resolution.services, bindings: {}, ...(selection ? { runtime: selection } : {}) };
  const lock = parsePackageJson(requiredFile(files, 'game.lock.json'), 'Game lock');
  if (canonicalJson(lock) !== canonicalJson(expected)) throw new Error('Game exact lock mismatch');
  return { manifest: freezeJson(manifest) as unknown as PortableGame, lock: freezeJson(expected), modules, legacy: raw, files };
}
export async function decodeGamePackage(bytes: Uint8Array<ArrayBuffer>, validateLegacy: (raw: unknown) => LabPackage, options: ZipOptions & ShippedPackageOptions = {}): Promise<InspectedGame> {
  const budget = options.budget ?? { bytes: 0, files: 0 };
  const files = await readZip(bytes, { ...options, budget });
  return inspectGameFiles(files, validateLegacy, { ...options, budget });
}
export async function encodeGamePackage(raw: LabPackage, options: ZipOptions & ShippedPackageOptions = {}, authored?: ReadonlyMap<string, PackageFiles>): Promise<Uint8Array<ArrayBuffer>> {
  const files = await createGameFiles(validatePackage(raw), authored, options);
  const bytes = [...files.values()].reduce((n, value) => n + value.length, 0);
  await inspectGameFiles(files, validatePackage, { ...options, budget: { bytes, files: files.size } });
  return writeZip(files, options);
}
