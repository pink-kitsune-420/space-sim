import type { ManifestV2, ModuleAssets, ModuleEnvironment, ModuleInitializationV2, RegisteredModule, RegisteredModuleV2 } from '../../game-api/src/index';
import { enableCodeArtifact, parseCodeArtifact, type CodeArtifact } from './artifact';
import { validateManifestV2 } from './validation-v2';
import { validateManifest } from './validation';
import { ALLOW_RUNTIME_CODE } from './build-policy';

export interface LoadPolicy {
  readonly environment: ModuleEnvironment;
  readonly allowRuntimeCode: boolean;
  readonly approvedDigests: ReadonlySet<string>;
}
/** One lazy execution gate shared by browser and server adapters. Inspection/registration
 * is inert; policy is enforced immediately before any JavaScript evaluation. The host
 * supplies approval after its local enable action or server-owner configuration. */
export function loadCodeModules(artifacts: readonly CodeArtifact[], policy: LoadPolicy): RegisteredModule[] {
  const { environment } = policy, allowRuntimeCode = ALLOW_RUNTIME_CODE && policy.allowRuntimeCode, approved = new Set(policy.approvedDigests);
  const checked = artifacts.map(artifact => parseCodeArtifact(JSON.stringify(artifact)));
  if (new Set(checked.map(a => a.manifest.id)).size !== checked.length) throw new Error('Duplicate code module ID');
  return checked.map(artifact => Object.freeze({ manifest: artifact.manifest, contentDigest: artifact.digest,
    supportsMultiplayer: artifact.compatibility.multiplayer,
    initialize: (context: Parameters<RegisteredModule['initialize']>[0]) => {
      if (!allowRuntimeCode) throw new Error(`Module ${artifact.manifest.id}: this build does not allow imported code`);
      if (!approved.has(artifact.digest)) throw new Error(`Module ${artifact.manifest.id}: approve this exact code digest before enabling it`);
      return enableCodeArtifact(artifact, environment).initialize(context);
    },
  }));
}
/** Compatibility adapter for existing locally enabled v1 games/profiles. The surrounding
 * app still owns their existing enable/consent UI; new orchestration uses loadCodeModules
 * with an explicit build/trust policy. Never use this adapter for unapproved server offers. */
export function artifactModules(artifacts: readonly CodeArtifact[], environment: ModuleEnvironment): RegisteredModule[] {
  return loadCodeModules(artifacts, { environment, allowRuntimeCode: true, approvedDigests: new Set(artifacts.map(a => a.digest)) });
}

export interface ExecutablePackageV2 {
  readonly manifest: ManifestV2;
  readonly digest: string;
  readonly source: string;
  readonly supportsMultiplayer: boolean;
}
/** Only verified package inspection may construct this record. The orchestrator reinspects
 * persisted bytes before registration; code evaluation remains deferred to preparation. */
export function loadCodeModuleV2(module: ExecutablePackageV2, policy: LoadPolicy): RegisteredModuleV2 {
  const manifest = validateManifestV2(module.manifest), { digest, source, supportsMultiplayer } = module;
  if (!/^[0-9a-f]{64}$/.test(digest) || !source.trim() || new TextEncoder().encode(source).length > 4 * 1024 * 1024) throw new Error('Invalid v2 executable package');
  const allowed = ALLOW_RUNTIME_CODE && policy.allowRuntimeCode, approved = policy.approvedDigests.has(digest), environment = policy.environment;
  return Object.freeze({ manifest, contentDigest: digest, supportsMultiplayer,
    initialize(context: ModuleInitializationV2): void {
      if (!allowed) throw new Error(`Module ${manifest.id}: this build does not allow imported code`);
      if (!approved) throw new Error(`Module ${manifest.id}: approve this exact code digest before enabling it`);
      if (!manifest.environments.includes(environment)) throw new Error(`Module ${manifest.id}: unsupported environment ${environment}`);
      const initialize: unknown = new Function(`"use strict";\n${source}\n;return SpaceSimModule.default;`)();
      if (typeof initialize !== 'function') throw new Error(`Module ${manifest.id}: bundle must export a default initializer`);
      return initialize(context);
    } });
}
/** Legacy metadata is normalized for mixed resolution only. Its original manifest,
 * artifact digest and v1 save/lock serializers remain untouched. */
export function normalizeLegacyModule(module: RegisteredModule, assets: ModuleAssets, textPaths: readonly string[] = []): RegisteredModuleV2 {
  const legacy = validateManifest(module.manifest);
  const capability = (name: string) => {
    const match = /^(.+)\/v([1-9][0-9]*)$/.exec(name);
    if (!match) throw new Error(`Legacy capability ${name} requires an explicit version adapter`);
    return { name: match[1]!, version: `${match[2]}.0.0` };
  };
  const provides = new Map(legacy.provides.map(value => { const c = capability(value); return [c.name, c]; }));
  for (const slot of legacy.slots) if (!provides.has(slot)) provides.set(slot, { name: slot, version: '1.0.0' });
  const { authority: _authority, ...common } = legacy;
  const manifest = validateManifestV2({ ...common, format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2',
    tier: legacy.authority, conflicts: legacy.conflicts ?? [], provides: [...provides.values()], requires: legacy.requires.map(capability) });
  const text = Object.freeze(Object.fromEntries(textPaths.map(path => [path, assets.text(path)])));
  return Object.freeze({ manifest, contentDigest: module.contentDigest, supportsMultiplayer: module.supportsMultiplayer,
    initialize(context: ModuleInitializationV2): void {
      module.initialize(Object.freeze({ ...context, assets: text,
        provide: (slot: string, service: unknown) => context.provide({ slot, version: '1.0.0' }, service) }));
    } });
}

// Local authoring contracts: these exports remain inert.
export { validateManifest };
export { validateManifestV2 };
export { artifactPath, artifactDigest, parseCodeArtifact } from './artifact';
