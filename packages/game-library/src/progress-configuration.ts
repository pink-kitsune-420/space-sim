import type { CodeArtifact } from '../../game-runtime/src/artifact';
import { decodeModulePackage } from './portable';
import { loadCodeModules } from '../../game-runtime/src/loader';
import type { DataModule, ModuleProfile, RegisteredModule, WorldSave, ModuleEnvironment } from '../../game-api/src/index';
import { canonicalJson, sha256Hex } from '../../game-runtime/src/authoritative';
import type { PackageStore } from '../../game-runtime/src/package-store';
import { packageDigest } from '../../game-runtime/src/package-store';
import { freezeJson, keys, moduleId, object, validateProfile, version } from '../../game-runtime/src/validation';
import { attachRuntimeFiles, runtimeReferences, validateRuntimeSelection, type RuntimeSelection } from './runtime-selection';
import { inspectRuntimePackage } from './runtime-package';

/** Exact configuration only. Content definitions and executable bytes belong in the inert
 * installed library; progress retains its existing universe snapshot and physical identity. */
export type ProgressConfiguration = import('../../game-api/src/index').SavedGameConfiguration;
export function validateProgressConfiguration(raw: unknown): ProgressConfiguration {
  const value = object(raw, 'Progress configuration');
  keys(value, ['format', 'profile', 'runtime', 'data', 'code'], 'Progress configuration');
  if (value.format !== 'spacelab-progress-configuration/2') throw new Error('Unsupported progress configuration');
  const profile = validateProfile(value.profile);
  const references = (raw: unknown) => {
    if (!Array.isArray(raw) || raw.length > 256) throw new Error('Invalid progress package references');
    const refs = raw.map(raw => {
      const ref = object(raw, 'Progress package'); keys(ref, ['id', 'version', 'digest'], 'Progress package');
      const id = moduleId(ref.id, 'Progress package'), exact = version(ref.version, 'Progress version');
      if (!profile.modules.some(m => m.id === id && m.version === exact)) throw new Error(`Progress package ${id} is not selected exactly`);
      return { id, version: exact, digest: packageDigest(ref.digest as string) };
    });
    if (new Set(refs.map(r => r.id)).size !== refs.length) throw new Error('Duplicate progress package');
    return refs;
  };
  return freezeJson({ format: value.format, profile, runtime: validateRuntimeSelection(value.runtime), data: references(value.data), code: references(value.code) });
}
export function progressConfiguration(profile: ModuleProfile, data: readonly DataModule[], code: readonly RegisteredModule[], runtime: RuntimeSelection): ProgressConfiguration {
  const selected = new Set(profile.modules.map(ref => ref.id));
  return validateProgressConfiguration({ format: 'spacelab-progress-configuration/2', profile, runtime,
    data: data.filter(m => selected.has(m.manifest.id)).map(m => ({ id: m.manifest.id, version: m.manifest.version, digest: sha256Hex(canonicalJson(m)) })),
    code: code.filter(m => selected.has(m.manifest.id) && m.contentDigest).map(m => ({ id: m.manifest.id, version: m.manifest.version, digest: m.contentDigest })) });
}
export function savedProgressConfiguration(raw: unknown): ProgressConfiguration | undefined {
  if (!raw || typeof raw !== 'object' || !('configuration' in raw)) return undefined;
  return validateProgressConfiguration(raw.configuration);
}
export function withProgressConfiguration(save: WorldSave, configuration: ProgressConfiguration | undefined): WorldSave & { readonly configuration?: ProgressConfiguration } {
  return configuration ? { ...save, configuration: validateProgressConfiguration(configuration) } : save;
}
/** Reconstruct from installed bytes only, without selecting a game or granting consent.
 * All digest/legacy checks complete before callers enter candidate preparation. */
export async function reconstructProgress(configuration: ProgressConfiguration, store: PackageStore, environment: ModuleEnvironment,
  installed: { readonly data: readonly DataModule[]; readonly code: readonly RegisteredModule[]; readonly approvedLegacyDigests?: ReadonlySet<string>; readonly allowRuntimeCode?: boolean }): Promise<{
    readonly runtime: RuntimeSelection; readonly profile: ModuleProfile; readonly data: readonly DataModule[]; readonly code: readonly RegisteredModule[];
    readonly artifacts: readonly CodeArtifact[];
    readonly executablePackages: readonly { readonly id: string; readonly version: string; readonly digest: string }[];
  }> {
  configuration = validateProgressConfiguration(configuration);
  const plan = configuration.runtime.plans[environment];
  if (!plan) throw new Error(`Progress has no ${environment} target. Load it with a compatible host.`);
  const availableData = [...installed.data], availableCode = [...installed.code], artifacts: CodeArtifact[] = [];
  if (configuration.data.length || configuration.code.length) for (const entry of await store.list()) {
    const stored = await store.get(entry.digest); if (!stored) continue;
    let checked;
    try { checked = await decodeModulePackage(Uint8Array.from(stored.bytes)); } catch { continue; }
    if (checked.integrity.digest !== entry.digest) continue;
    if (checked.content) availableData.push(checked.content);
    if (checked.code && configuration.code.some(ref => ref.id === checked.code!.manifest.id && ref.digest === checked.code!.digest)) {
      artifacts.push(checked.code);
      availableCode.push(...loadCodeModules([checked.code], { environment, allowRuntimeCode: installed.allowRuntimeCode ?? true,
        approvedDigests: installed.approvedLegacyDigests ?? new Set() }));
    }
  }
  const data = configuration.data.map(ref => {
    const module = availableData.find(m => m.manifest.id === ref.id && m.manifest.version === ref.version && sha256Hex(canonicalJson(m)) === ref.digest);
    if (!module) throw new Error(`Install exact data ${ref.id}@${ref.version} (${ref.digest}) before loading this progress`);
    return module;
  });
  const code = configuration.code.map(ref => {
    const module = availableCode.find(m => m.manifest.id === ref.id && m.manifest.version === ref.version && m.contentDigest === ref.digest);
    if (!module) throw new Error(`Install and approve exact legacy module ${ref.id}@${ref.version} (${ref.digest}) before loading this progress`);
    return module;
  });
  const executablePackages = configuration.code.filter(ref => !installed.code.some(m => m.manifest.id === ref.id && m.contentDigest === ref.digest));
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const ref of runtimeReferences(configuration.runtime)) {
    const entry = await store.get(ref.digest);
    if (!entry) {
      if (plan.packages.some(p => p.digest === ref.digest)) throw new Error(`Install exact package ${ref.id}@${ref.version} (${ref.digest}) before loading this progress. Import its .spacemod or game in the Library.`);
      continue;
    }
    let checked;
    try { checked = await inspectRuntimePackage(entry.bytes); }
    catch (error) { throw new Error(`Installed progress package ${ref.id} could not be verified: ${error instanceof Error ? error.message : String(error)}. Re-import the exact package (${ref.digest}).`); }
    if (checked.id !== ref.id || checked.version !== ref.version || checked.digest !== ref.digest) throw new Error(`Installed progress package ${ref.id} has a digest or identity mismatch; re-import the exact package`);
    if (plan.packages.some(p => p.digest === ref.digest) && !checked.manifest.environments.includes(environment)) throw new Error(`Progress package ${ref.id} cannot run in ${environment}`);
    if (checked.containsCode && plan.packages.some(p => p.digest === ref.digest)) executablePackages.push(ref);
    files.set(`modules/${ref.id}.spacemod`, Uint8Array.from(entry.bytes));
  }
  return { profile: configuration.profile, data, code, artifacts, executablePackages, runtime: attachRuntimeFiles(configuration.runtime, files) };
}
