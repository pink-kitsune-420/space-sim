import type { ModuleAssets, RegisteredModuleV2 } from '../../game-api/src/index';
import { loadCodeModuleV2, loadCodeModules, normalizeLegacyModule } from '../../game-runtime/src/loader';
import type { LoadPolicy } from '../../game-runtime/src/loader';
import type { InspectedRuntimePackage } from '../../game-runtime/src/game-loader';
import { moduleAssets } from '../../game-runtime/src/modules-v2';
import { decodeModulePackage, requiredFile, type InspectedModule, type ShippedPackageOptions } from './portable';

/** Pure inspection adapter shared by all hosts; no evaluation on decode or store replay. */
export function runtimePackage(checked: InspectedModule, makeAssets: (files: ReadonlyMap<string, Uint8Array>) => ModuleAssets = moduleAssets): InspectedRuntimePackage {
  const { descriptor, integrity } = checked, manifest = descriptor.manifest;
  const files = new Map([...descriptor.assets.map(a => a.path), ...descriptor.guides].map(path => [path, requiredFile(checked.files, path).slice()]));
  if (checked.code) for (const [path, value] of Object.entries(checked.code.assets)) files.set(path, new TextEncoder().encode(value));
  const assets = makeAssets(files);
  if (manifest.format === 'space-sim-module/2') {
    const source = checked.codeV2?.source;
    if (manifest.kind === 'provider' && !source) throw new Error('Rebuild this v2 module before enabling it');
    return Object.freeze({ id: manifest.id, version: manifest.version, digest: integrity.digest, manifest, containsCode: manifest.kind === 'provider',
      register: (policy: LoadPolicy) => ({ assets, module: source ? loadCodeModuleV2({ manifest, source, digest: integrity.digest, supportsMultiplayer: descriptor.compatibility.multiplayer }, policy)
        : { manifest, contentDigest: integrity.digest, initialize() {} } }) });
  }
  if (!checked.code && !checked.content) throw new Error('This legacy data payload requires its dedicated content adapter');
  const code = checked.code;
  const lazy = code ? loadCodeModules([code], { environment: manifest.environments[0]!, allowRuntimeCode: false, approvedDigests: new Set() })[0]!
    : { manifest, initialize() {} };
  const normalized = normalizeLegacyModule(lazy, assets, [...files.keys()]);
  return Object.freeze({ id: manifest.id, version: manifest.version, digest: integrity.digest, manifest: normalized.manifest, containsCode: !!code,
    register(policy: LoadPolicy): { module: RegisteredModuleV2; assets: typeof assets } {
      if (!code) return { module: normalized, assets };
      const approved = policy.approvedDigests.has(integrity.digest);
      const module = loadCodeModules([code], { ...policy, approvedDigests: approved ? new Set([code.digest]) : new Set() })[0]!;
      return { module: normalizeLegacyModule(module, assets, Object.keys(code.assets)), assets };
    } });
}
export async function inspectRuntimePackage(bytes: Uint8Array, options: ShippedPackageOptions = {}): Promise<InspectedRuntimePackage> {
  return runtimePackage(await decodeModulePackage(Uint8Array.from(bytes), options));
}
