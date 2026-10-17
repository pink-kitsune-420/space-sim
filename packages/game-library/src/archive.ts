import type { DataModule, RegisteredModule } from '../../game-api/src/index';
import { enableCodeArtifact, parseCodeArtifact, type CodeArtifact } from '../../game-runtime/src/artifact';
import { freezeJson, keys, moduleId, object, string } from '../../game-runtime/src/validation';
import { parseModuleImport, type ModuleBundle } from '../../modules/src/profile';
import { validateDataModule } from '../../modules/src/data';

import { compressJson, readJsonFile } from './compression';
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
}
export type LabPackage = GamePackage | PluginPackage;

function info(raw: unknown): PackageInfo {
  const value = object(raw, 'Package info');
  keys(value, ['id', 'name', 'description'], 'Package info');
  if (typeof value.description !== 'string' || value.description.length > 4096) throw new Error('Package description: expected at most 4096 characters');
  return { id: moduleId(value.id, 'Package ID'), name: string(value.name, 'Package name'), description: value.description };
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
  const value = object(raw, 'Space Lab package');
  const metadata = info(value.info);
  if (value.format === 'space-lab-plugin/1') {
    keys(value, ['format', 'info', 'data', 'code'], 'Plugin package');
    const data = list(value.data, 'Plugin data').map(validateDataModule);
    const code = list(value.code, 'Plugin code').map(m => parseCodeArtifact(JSON.stringify(m)));
    if (!data.length && !code.length) throw new Error('Plugin package is empty');
    unique(data, code);
    return freezeJson({ format: value.format, info: metadata, data, code });
  }
  if (value.format !== 'space-lab-game/1') throw new Error('Unsupported Space Lab package format');
  keys(value, ['format', 'info', 'bundle', 'plugins'], 'Game package');
  const parsed = parseModuleImport(JSON.stringify(value.bundle));
  if (parsed.format !== 'space-sim-module-profile/1') throw new Error('Game requires a module profile');
  const plugins = list(value.plugins, 'Game plugins').map(m => parseCodeArtifact(JSON.stringify(m)));
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
  return freezeJson({ format: value.format, info: metadata, bundle: parsed, plugins });
}

/** Standard gzip over UTF-8 JSON; works in hosted and standalone offline builds. */
export async function encodePackage(raw: LabPackage): Promise<Uint8Array<ArrayBuffer>> {
  return compressJson(validatePackage(raw));
}
export async function decodePackage(bytes: Uint8Array<ArrayBuffer>): Promise<LabPackage> {
  return validatePackage(await readJsonFile(bytes, true));
}

/** Lazy wrappers are shared by game and standalone plugin loading. */
export function artifactModules(artifacts: readonly CodeArtifact[], environment: 'browser' | 'offline' | 'node'): RegisteredModule[] {
  return artifacts.map(artifact => ({ manifest: artifact.manifest, contentDigest: artifact.digest,
    supportsMultiplayer: artifact.compatibility.multiplayer,
    initialize(context) {
      // Evaluation only occurs when a user explicitly plays/applies this package.
      return enableCodeArtifact(artifact, environment).initialize(context);
    } }));
}
