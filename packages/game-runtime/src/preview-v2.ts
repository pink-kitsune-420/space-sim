import type { HostServiceAccess, ManifestV2, ModuleEnvironment, ModuleLockV2, ModuleProfileV2 } from '../../game-api/src/index';
import { permitsDependency, resolveModulesV2 } from './resolver-v2';
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
      for (const need of manifest.requires) {
        if (need.optional || options.hostServices?.some(h => h.key.slot === need.name && satisfies(h.key.version, need.version)
          && h.tiers.includes(manifest.tier) && h.environments.includes(environment))) continue;
        const choice = profile.capabilities[id]?.[need.name];
        const compatible = [...installed.values()].filter(p => p.kind !== 'data' && p.environments.includes(environment)
          && permitsDependency(manifest.tier, p.tier) && p.provides.some(c => c.name === need.name && satisfies(c.version, need.version)));
        const enabled = compatible.filter(p => modules.has(p.id) && (!p.slots.length || p.slots.some(s => profile.providers[s] === p.id || !profile.providers[s])));
        const provider = choice ? compatible.find(p => p.id === choice) : enabled.length === 1 ? enabled[0] : compatible.length === 1 ? compatible[0] : undefined;
        if (provider && !modules.has(provider.id)) { modules.set(provider.id, { id: provider.id, version: provider.version }); visit(provider.id); }
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

/** Explicit reverse-removal proposal, using the applied graph's exact bindings. A chosen
 * replacement satisfying the same need keeps its consumers. Resolution still validates
 * the resulting proposal and reports conflicts, required slots and ambiguous providers. */
export function removeModuleDependents(installed: ReadonlyMap<string, ManifestV2>, proposed: ModuleProfileV2,
  current: ModuleLockV2): ModuleProfileV2 {
  const selected = new Set(proposed.modules.map(ref => ref.id));
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of selected) {
      const manifest = installed.get(id); if (!manifest) continue;
      const missingId = manifest.dependencies.some(d => !selected.has(d.id));
      const missingCapability = manifest.requires.some(need => {
        if (need.optional || !current.capabilities[id]?.[need.name] || current.capabilities[id]![need.name]!.provider.id === 'builtin.engine') return false;
        const explicit = proposed.capabilities[id]?.[need.name];
        return ![...selected].some(provider => {
          const m = installed.get(provider);
          return m && (!explicit || explicit === provider) && permitsDependency(manifest.tier, m.tier)
            && (!m.slots.length || m.slots.some(slot => proposed.providers[slot] === provider || !proposed.providers[slot]))
            && m.provides.some(c => c.name === need.name && satisfies(c.version, need.version));
        });
      });
      if (missingId || missingCapability) { selected.delete(id); changed = true; }
    }
  }
  return validateProfileV2({ ...proposed, modules: proposed.modules.filter(ref => selected.has(ref.id)),
    settings: Object.fromEntries(Object.entries(proposed.settings).filter(([id]) => selected.has(id))),
    providers: Object.fromEntries(Object.entries(proposed.providers).filter(([, id]) => selected.has(id))),
    capabilities: Object.fromEntries(Object.entries(proposed.capabilities).filter(([id]) => selected.has(id))) });
}
