import type { ModuleProfile, ModuleReference } from '../../../packages/game-api/src/index';
import type { ModuleRegistry } from '../../../packages/game-runtime/src/index';

/** A manifest includes dependency libraries; switches remember the modules that need them. */
export function presentationRoots(profile: ModuleProfile, registry: ModuleRegistry): readonly ModuleReference[] {
  const dependencies = new Set(profile.modules.flatMap(ref => registry.getManifest(ref.id)?.dependencies.map(need => need.id) ?? []));
  return profile.modules.filter(ref => !registry.getManifest(ref.id)?.slots.includes('renderer') && !dependencies.has(ref.id));
}

/** Apply viewer choices to this game's manifest, retaining exact versions, providers and settings.
 * Only an explicit renderer choice can add a renderer absent from the manifest. */
export function selectPresentationProfile(base: ModuleProfile, registry: ModuleRegistry,
  explicit: readonly ModuleReference[], renderer = base.providers.renderer,
  providerOverrides: Readonly<Record<string, string | undefined>> = {}): ModuleProfile {
  const modules = [...base.modules.filter(ref => registry.getManifest(ref.id)?.slots.includes('renderer')),
    ...registry.closure(explicit)];
  if (renderer && !modules.some(ref => ref.id === renderer)) {
    const manifest = registry.getManifest(renderer);
    if (!manifest?.slots.includes('renderer')) throw new Error(`Module ${renderer}: no installed renderer`);
    modules.push({ id: renderer, version: manifest.version });
  }
  const selected = new Set(modules.map(ref => ref.id));
  const providers = Object.fromEntries(Object.entries({ ...base.providers, ...providerOverrides, renderer })
    .filter((entry): entry is [string, string] => entry[1] !== undefined && selected.has(entry[1])));
  const settings = Object.fromEntries(Object.entries(base.settings).filter(([id]) => selected.has(id)));
  const same = modules.length === base.modules.length && modules.every(ref => base.modules.some(other => other.id === ref.id && other.version === ref.version))
    && Object.keys(providers).length === Object.keys(base.providers).length && Object.entries(providers).every(([slot, id]) => base.providers[slot] === id);
  return { ...base, id: same ? base.id : 'local.presentation', modules, providers, settings };
}

/** Keep the original Space Sim preference key; other games own their viewer preferences. */
export function presentationPreferenceKey(gameId: string): string {
  return gameId === 'builtin.space-sim' ? 'space-sim.presentation/1' : `space-sim.presentation/1:${gameId}`;
}
