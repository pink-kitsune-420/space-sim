import type { DataModule } from '../../game-api/src/index';
import { parseCodeArtifact, type CodeArtifact } from '../../game-runtime/src/artifact';
import { freezeJson, keys, moduleId, object, string } from '../../game-runtime/src/validation';
import { parseModuleImport, type ModuleBundle } from '../../modules/src/profile';
import { validateDataModule } from '../../modules/src/data';

import { readJsonFile } from './compression';
import { encodeGamePackage, inspectGameFiles } from './game-package';
import { copyPackageFiles, inspectModuleFiles } from './portable';
import { DATA_FILE_FORMAT, inspectDataFiles } from './data-file';
import { inspectSaveFiles } from './save-package';
import { parsePackageJson, requiredFile } from './portable';
import { isZip, readZip } from './zip';
import { runtimeReferences, validateRuntimeSelection, type RuntimeSelection } from './runtime-selection';
export { MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES } from './compression';
export interface PackageInfo { readonly id: string; readonly name: string; readonly description: string }
export interface PluginPackage {
  readonly format: 'space-lab-plugin/1';
  readonly info: PackageInfo;
  readonly data: readonly DataModule[];
  readonly code: readonly CodeArtifact[];
}
export interface GamePackage {
  readonly format: 'space-lab-game/1';
  readonly info: PackageInfo;
  readonly bundle: ModuleBundle;
  readonly plugins: readonly CodeArtifact[];
  readonly runtime?: RuntimeSelection;
}
export type LabPackage = GamePackage | PluginPackage;

function freezePackage<T extends LabPackage>(raw: T): T {
  const frozen = freezeJson(raw);
  const before = raw.format === 'space-lab-game/1' ? [...raw.bundle.modules, ...raw.plugins] : [...raw.data, ...raw.code];
  const after = frozen.format === 'space-lab-game/1' ? [...frozen.bundle.modules, ...frozen.plugins] : [...frozen.data, ...frozen.code];
  before.forEach((module, i) => copyPackageFiles(module, after[i]!));
  if (raw.format === 'space-lab-game/1' && frozen.format === 'space-lab-game/1' && raw.runtime && frozen.runtime) copyPackageFiles(raw.runtime, frozen.runtime);
  return frozen;
}
function info(raw: unknown): PackageInfo {
  const value = object(raw, 'Package info');
  keys(value, ['id', 'name', 'description'], 'Package info');
  if (typeof value.description !== 'string' || value.description.length > 4096) throw new Error('Package description: expected at most 4096 characters');
  return { id: moduleId(value.id, 'Package ID'), name: string(value.name, 'Package name'), description: value.description };
}
function parseCode(raw: unknown): CodeArtifact {
  const parsed = parseCodeArtifact(JSON.stringify(raw));
  if (raw && typeof raw === 'object') copyPackageFiles(raw, parsed);
  return parsed;
}
function parseData(raw: unknown): DataModule {
  const parsed = validateDataModule(raw);
  if (raw && typeof raw === 'object') copyPackageFiles(raw, parsed);
  return parsed;
}
function list(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw) || raw.length > 256) throw new Error(`${label}: expected at most 256 entries`);
  return raw;
}
function unique(data: readonly DataModule[], code: readonly CodeArtifact[]): void {
  const ids = [...data, ...code].map(m => m.manifest.id);
  if (new Set(ids).size !== ids.length) throw new Error('Package contains duplicate plugin IDs');
}
/** Inspection validates every embedded artifact and exact requirement without evaluating code. */
export function validatePackage(raw: unknown): LabPackage {
  const value = object(raw, 'Spacelab package');
  const metadata = info(value.info);
  if (value.format === 'space-lab-plugin/1') {
    keys(value, ['format', 'info', 'data', 'code'], 'Plugin package');
    const data = list(value.data, 'Plugin data').map(parseData);
    const code = list(value.code, 'Plugin code').map(parseCode);
    if (!data.length && !code.length) throw new Error('Plugin package is empty');
    unique(data, code);
    return freezePackage({ format: value.format, info: metadata, data, code });
  }
  if (value.format !== 'space-lab-game/1') throw new Error('Unsupported Spacelab package format');
  keys(value, ['format', 'info', 'bundle', 'plugins', 'runtime'], 'Game package');
  const parsed = parseModuleImport(JSON.stringify(value.bundle));
  const originalBundle = object(value.bundle, 'Module bundle');
  if (Array.isArray(originalBundle.modules)) parsed.format === 'space-sim-module-profile/1' && parsed.modules.forEach((module, i) => {
    const original = originalBundle.modules as object[];
    if (original[i]) copyPackageFiles(original[i]!, module);
  });
  if (parsed.format !== 'space-sim-module-profile/1') throw new Error('Game requires a module profile');
  const plugins = list(value.plugins, 'Game plugins').map(parseCode);
  unique(parsed.modules, plugins);
  const requirements = parsed.code ?? [];
  if (new Set(requirements.map(r => r.id)).size !== requirements.length) throw new Error('Duplicate code requirement');
  for (const ref of requirements) {
    if (!plugins.some(p => p.manifest.id === ref.id && p.manifest.version === ref.version && p.digest === ref.digest))
      throw new Error(`Game is missing exact plugin ${ref.id}@${ref.version}`);
  }
  const selected = [...parsed.profile.modules, ...(parsed.presentation?.modules ?? [])];
  for (const plugin of plugins) if (selected.some(ref => ref.id === plugin.manifest.id)
    && !requirements.some(ref => ref.id === plugin.manifest.id && ref.digest === plugin.digest))
    throw new Error(`Game must declare exact code requirement ${plugin.manifest.id}`);
  const runtime = value.runtime === undefined ? undefined : validateRuntimeSelection(value.runtime);
  if (runtime) {
    const legacyIds = new Set([...parsed.profile.modules, ...(parsed.presentation?.modules ?? []), ...parsed.modules.map(m => m.manifest), ...plugins.map(m => m.manifest)].map(m => m.id));
    for (const ref of runtimeReferences(runtime)) if (legacyIds.has(ref.id)) throw new Error(`Runtime package duplicates legacy module ${ref.id}`);
    for (const plan of Object.values(runtime.plans)) for (const ref of plan.profile.modules) if (legacyIds.has(ref.id)) throw new Error(`Runtime selection duplicates legacy module ${ref.id}`);
  }
  return freezePackage({ format: value.format, info: metadata, bundle: parsed, plugins, ...(runtime ? { runtime } : {}) });
}

/** New exports are ordinary ZIP collections; legacy JSON/gzip readers remain supported. */
export async function encodePackage(raw: LabPackage): Promise<Uint8Array<ArrayBuffer>> {
  return encodeGamePackage(validatePackage(raw));
}
/** One inert import route distinguishes setup, code, reusable data and saved progress by bytes. */
export async function decodeLabFile(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  if (!isZip(bytes)) return readJsonFile(bytes);
  const budget = { bytes: 0, files: 0 }, files = await readZip(bytes, { budget });
  if (files.has('save.json')) return inspectSaveFiles(files);
  if (files.has('game.json')) return (await inspectGameFiles(files, validatePackage, { budget })).legacy;
  if (files.has('data.json')) {
    const descriptor = parsePackageJson(requiredFile(files, 'data.json'), 'Data descriptor') as { format?: string };
    if (descriptor.format === DATA_FILE_FORMAT) return inspectDataFiles(files).value;
  }
  const module = inspectModuleFiles(files);
  if (!module.code && !module.content) throw new Error('Use Setup → Import for universe definitions, or Tools → Load shader for shaders');
  return { format: 'space-lab-plugin/1', info: { id: module.descriptor.manifest.id, name: module.descriptor.manifest.name, description: '' },
    data: module.content ? [module.content] : [], code: module.code ? [module.code] : [] };
}
export async function decodePackage(bytes: Uint8Array<ArrayBuffer>): Promise<LabPackage> {
  return validatePackage(await decodeLabFile(bytes));
}

// Keep existing imports compatible while execution policy lives in the pure runtime.
export { artifactModules } from '../../game-runtime/src/loader';
