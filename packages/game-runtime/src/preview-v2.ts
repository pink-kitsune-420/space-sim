import type { HostServiceAccess, ManifestV2, ModuleEnvironment, ModuleLockV2, ModuleProfileV2 } from '../../game-api/src/index';
import { resolveModulesV2 } from './resolver-v2';
import { satisfies } from './semver';
import { freezeJson } from './validation';
import { validateProfileV2 } from './validation-v2';

export interface ModuleChangePreview {
  readonly profile: ModuleProfileV2;
  readonly lock: ModuleLockV2;
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly replaced: readonly string[];
  readonly providerChanges: readonly string[];
  readonly dependencies: readonly { readonly requester: string; readonly provider: string; readonly reason: string }[];
  readonly restartRequired: boolean;
}
/** Explicit preview operation only. It never installs, approves or runs anything. Required
 * ID dependencies can be included at the user's request; ambiguous capabilities still need
 * the user's provider choice and produce the resolver's structured diagnostic. */
export function previewModulesV2(installed: ReadonlyMap<string, ManifestV2>, proposed: ModuleProfileV2,
  current: ModuleLockV2 | undefined, environment: ModuleEnvironment, options: {
    readonly includeDependencies?: boolean; readonly requiredSlots?: readonly string[]; readonly hostServices?: readonly HostServiceAccess[];
  } = {}): ModuleChangePreview {
  let profile = validateProfileV2(proposed);
  if (options.includeDependencies) {
    const modules = new Map(profile.modules.map(ref => [ref.id, ref]));
    const visit = (id: string): void => {
      const manifest = installed.get(id); if (!manifest) return;
      for (const dependency of manifest.dependencies) {
        if (modules.has(dependency.id)) continue;
        const provider = installed.get(dependency.id);
        if (!provider || !provider.environments.includes(environment) || !satisfies(provider.version, dependency.version)) continue;
        modules.set(provider.id, { id: provider.id, version: provider.version }); visit(provider.id);
      }
    };
    for (const id of modules.keys()) visit(id);
    profile = validateProfileV2({ ...profile, modules: [...modules.values()] });
  }
  const lock = resolveModulesV2(installed, profile, environment, options.requiredSlots, options.hostServices);
  const old = new Map(current?.modules.map(ref => [ref.id, ref.version])), next = new Map(lock.modules.map(ref => [ref.id, ref.version]));
  const added = [...next.keys()].filter(id => !old.has(id)), removed = [...old.keys()].filter(id => !next.has(id));
  const replaced = [...next.keys()].filter(id => old.has(id) && old.get(id) !== next.get(id));
  const providerChanges = [...new Set([...Object.keys(current?.providers ?? {}), ...Object.keys(lock.providers)])]
    .filter(slot => current?.providers[slot] !== lock.providers[slot]).sort();
  const dependencies = lock.order.flatMap(id => [
    ...installed.get(id)!.dependencies.map(dep => ({ requester: id, provider: dep.id, reason: `module ${dep.version}` })),
    ...Object.entries(lock.capabilities[id] ?? {}).map(([name, binding]) => ({ requester: id, provider: binding.provider.id, reason: `${name}@${binding.version}` })),
  ]);
  const settingsChanged = JSON.stringify(current?.settings ?? {}) !== JSON.stringify(lock.settings);
  const restartRequired = settingsChanged || [...added, ...removed, ...replaced].some(id => installed.get(id)?.tier !== 'presentation') || providerChanges.some(slot => {
    const id = lock.providers[slot] ?? current?.providers[slot]; return !id || installed.get(id)?.tier !== 'presentation';
  });
  return freezeJson({ profile, lock, added, removed, replaced, providerChanges, dependencies, restartRequired });
}
