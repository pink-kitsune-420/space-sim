import type { ModuleEnvironment, ModuleInitialization, ModuleManifest, RegisteredModule } from '../../game-api/src/index';
import { canonicalJson, sha256Hex } from './authoritative';
import { freezeJson, keys, object, string, validateManifest } from './validation';

export { validateManifest } from './validation';

export const MAX_CODE_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const MODULE_LICENSES = ['LicenseRef-Project', 'MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Zlib', 'CC0-1.0', 'Unlicense'] as const;
export interface CodeArtifact {
  readonly format: 'space-sim-code-module/1';
  readonly manifest: ModuleManifest;
  /** Self-contained IIFE assigning SpaceSimModule.default, a synchronous initializer. */
  readonly source: string;
  readonly assets: Readonly<Record<string, string>>;
  readonly inputs: readonly { readonly path: string; readonly sha256: string; readonly license: string; readonly attribution: string }[];
  readonly compatibility: { readonly deterministic: boolean; readonly multiplayer: boolean };
  /** SHA-256 of canonical JSON of every other field; identical on all targets. */
  readonly digest: string;
}
export function artifactPath(value: unknown): string {
  const path = string(value, 'Artifact path');
  if (path.length > 240 || !/^[A-Za-z0-9_.\-/]+$/.test(path)
    || path.split('/').some(p => !p || p === '.' || p === '..' || p.startsWith('.')))
    throw new Error(`Unsafe artifact path: ${path}`);
  return path;
}
export function artifactDigest(raw: Omit<CodeArtifact, 'digest'>): string { return sha256Hex(canonicalJson(raw)); }
/** Data-only inspection. This function never evaluates source. */
export function parseCodeArtifact(text: string): CodeArtifact {
  if (new TextEncoder().encode(text).length > MAX_CODE_ARTIFACT_BYTES) throw new Error('Code artifact must be at most 4 MiB');
  const raw = object(JSON.parse(text), 'Code artifact');
  keys(raw, ['format', 'manifest', 'source', 'assets', 'inputs', 'compatibility', 'digest'], 'Code artifact');
  if (raw.format !== 'space-sim-code-module/1') throw new Error('Expected space-sim-code-module/1');
  const manifest = validateManifest(raw.manifest);
  if (manifest.kind !== 'provider' || manifest.id.startsWith('builtin.')) throw new Error(`Module ${manifest.id}: code artifacts require a non-builtin provider ID`);
  if (typeof raw.source !== 'string' || !raw.source.trim()) throw new Error('Artifact source must be nonempty JavaScript');
  const source = raw.source;
  const assets = object(raw.assets, 'Artifact assets');
  if (Object.keys(assets).length > 128) throw new Error('Artifact: at most 128 assets');
  for (const [path, value] of Object.entries(assets)) { artifactPath(path); if (typeof value !== 'string') throw new Error(`Asset ${path}: expected text`); }
  if (!Array.isArray(raw.inputs) || !raw.inputs.length || raw.inputs.length > 256) throw new Error('Artifact: expected 1–256 bundled inputs');
  const seen = new Set<string>();
  const inputs = raw.inputs.map((value: unknown) => {
    const input = object(value, 'Artifact input');
    keys(input, ['path', 'sha256', 'license', 'attribution'], 'Artifact input');
    const path = artifactPath(input.path);
    if (seen.has(path)) throw new Error(`Duplicate artifact input ${path}`);
    seen.add(path);
    const sha256 = string(input.sha256, `Input ${path} digest`);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Input ${path}: invalid SHA-256`);
    const license = string(input.license, `Input ${path} license`), attribution = input.attribution;
    if (typeof attribution !== 'string' || !attribution.trim() || attribution.length > 65536) throw new Error(`Input ${path}: expected attribution/license text`);
    if (!(MODULE_LICENSES as readonly string[]).includes(license)) throw new Error(`Input ${path}: license ${license} is not approved for distribution`);
    return { path, sha256, license, attribution };
  });
  for (const [path, value] of Object.entries(assets)) {
    if (!inputs.some(i => i.path === path && i.sha256 === sha256Hex(value as string))) throw new Error(`Asset ${path}: missing matching licensed input`);
  }
  if (!(MODULE_LICENSES as readonly string[]).includes(manifest.license)) throw new Error(`Module ${manifest.id}: license ${manifest.license} is not approved for distribution`);
  const compatibility = object(raw.compatibility, 'Artifact compatibility');
  keys(compatibility, ['deterministic', 'multiplayer'], 'Artifact compatibility');
  if (typeof compatibility.deterministic !== 'boolean' || typeof compatibility.multiplayer !== 'boolean'
    || (compatibility.multiplayer && !compatibility.deterministic)) throw new Error('Artifact multiplayer requires declared determinism');
  const body: Omit<CodeArtifact, 'digest'> = { format: 'space-sim-code-module/1', manifest, source,
    assets: assets as Record<string, string>, inputs, compatibility: compatibility as unknown as CodeArtifact['compatibility'] };
  const digest = artifactDigest(body);
  if (raw.digest !== digest) throw new Error(`Module ${manifest.id}: artifact digest mismatch`);
  return freezeJson({ ...body, digest });
}
/** Call only following a local enable action (or server-owner configuration).
 * Trusted JavaScript has full environment privileges. This is not a sandbox. */
export function enableCodeArtifact(artifact: CodeArtifact, environment: ModuleEnvironment): RegisteredModule {
  const checked = parseCodeArtifact(JSON.stringify(artifact));
  if (!checked.manifest.environments.includes(environment)) throw new Error(`Module ${checked.manifest.id}: unsupported environment ${environment}`);
  const initialize: unknown = new Function(`"use strict";\n${checked.source}\n;return SpaceSimModule.default;`)();
  if (typeof initialize !== 'function') throw new Error(`Module ${checked.manifest.id}: artifact must export a default initializer`);
  return Object.freeze({ manifest: checked.manifest, contentDigest: checked.digest, supportsMultiplayer: checked.compatibility.multiplayer,
    initialize: (context: ModuleInitialization) => initialize(Object.freeze({ ...context, assets: checked.assets })) });
}
