import type { DynamicsProvider, MotionServices, ModuleEnvironment, ModuleProfile, RegisteredModule, SimulationContextFactory, UniverseDefinition } from '../../game-api/src/index';
import { ModuleRegistry, ModuleRuntime, validateProfile, computeAuthoritativeLock, canonicalJson, sha256Hex, type ModuleCandidate } from '../../game-runtime/src/index';
import { freezeJson } from '../../game-runtime/src/validation';
import { BUILTIN_SERVICES } from '../../sim-core/src/services';
import { DEFAULT_UNIVERSE } from '../../sim-core/src/universe';
import { World } from '../../sim-core/src/world';
import { loadWorld, type LoadedWorld } from '../../sim-core/src/save';
import { validateUniverse } from '../../sim-core/src/universe';
import { applyDataModules, validateDataModule, type DataModule } from './data';
import { builtinContent } from './base/content';
import { builtinMotion } from './base/motion';
import { builtinManifest } from './base/manifest';
export * from './data';
export * from './profile';
export { builtinManifest } from './base/manifest';

/** Base game modules: always installed and enabled by the default profile. */
export const BASE_GAME_MODULES: readonly RegisteredModule[] = Object.freeze([builtinContent, builtinMotion]);
export const DEFAULT_PROFILE: ModuleProfile = freezeJson({ format: 'space-sim-profile/1', id: 'builtin.default',
  modules: [{ id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }],
  providers: { content: 'builtin.content', motion: 'builtin.motion' }, settings: {} });
export function createBuiltinRegistry(data: readonly DataModule[] = [], code: readonly RegisteredModule[] = []): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const module of BASE_GAME_MODULES) registry.register(module);
  for (const raw of data) {
    const module = validateDataModule(raw);
    registry.register({ manifest: module.manifest, initialize() {} });
  }
  for (const module of code) registry.register(module);
  return registry;
}
export function profileWithData(data: readonly DataModule[]): ModuleProfile {
  return { ...DEFAULT_PROFILE, id: data.some(m => m.manifest.authority === 'authoritative') ? 'local.preview' : DEFAULT_PROFILE.id,
    modules: [...DEFAULT_PROFILE.modules, ...data.map(m => ({ id: m.manifest.id, version: m.manifest.version }))] };
}
export function builtinContextFactory(environment: ModuleEnvironment): SimulationContextFactory {
  const candidate = createBuiltinRegistry().prepare(DEFAULT_PROFILE, environment, ['motion', 'content']);
  try { return candidate.service<SimulationContextFactory>('motion'); }
  finally { candidate.dispose(); }
}
export interface PreparedGame {
  readonly runtime: ModuleRuntime;
  readonly candidate: ModuleCandidate;
  readonly world: World;
  readonly profile: ModuleProfile;
  readonly createContext: SimulationContextFactory;
}
/** Display metadata and palette choices are not physical content. Keep surfaceFeatures:
 * its star classification participates in surface eligibility. */
function physicalUniverseDigest(universe: UniverseDefinition): string {
  const visual = new Set(['name', 'description', 'author', 'color', 'accentColor',
    'atmosphereColor', 'horizonColor', 'skyColor', 'zoom']);
  return sha256Hex(canonicalJson(JSON.parse(JSON.stringify(universe,
    (key, value: unknown) => visual.has(key) ? undefined : value))));
}
/** The app commits this candidate only after constructing its local session/UI state. */
export function prepareGame(options: { readonly environment: ModuleEnvironment; readonly id?: string;
  readonly data?: readonly DataModule[]; readonly profile?: ModuleProfile;
  /** Explicitly enabled trusted code modules, including locally installed artifacts. */
  readonly code?: readonly RegisteredModule[];
  readonly universe?: UniverseDefinition; readonly universeKey?: string; readonly systemId?: string;
  readonly soloPreview?: boolean; readonly resolvedUniverse?: boolean } ): PreparedGame {
  const installed = (options.data ?? []).map(validateDataModule);
  const profile = validateProfile(options.profile ?? profileWithData(installed));
  const runtime = new ModuleRuntime(createBuiltinRegistry(installed, options.code), options.environment);
  const candidate = runtime.prepare(profile, ['motion', 'content']);
  try {
    const enabled = candidate.lock.order.flatMap(id => installed.filter(m => m.manifest.id === id));
    const base = new Map(candidate.service<ReadonlyMap<string, UniverseDefinition>>('content'));
    if (options.universe) base.set(`builtin.content/${options.universe.id}`, options.universe); // legacy universe import adapter
    const content = options.resolvedUniverse ? base : applyDataModules(base, enabled);
    const key = options.universeKey ?? `builtin.content/${options.universe?.id ?? DEFAULT_UNIVERSE.id}`;
    const universe = options.resolvedUniverse ? options.universe : content.get(key);
    if (!universe) throw new Error(`Profile ${profile.id}: unknown universe ${key}`);
    const createContext = candidate.service<SimulationContextFactory>('motion');
    const dynamics = candidate.lock.providers.dynamics ? candidate.service<DynamicsProvider>('dynamics') : undefined;
    const forces = candidate.forceExtensions;
    const rules = candidate.worldRules;
    const commands = candidate.commands;
    const presentation = [...candidate.layers, ...candidate.panels, ...candidate.cameras];
    if (presentation.length) throw new Error(`Module ${presentation[0]!.moduleId}: layer, panel and camera hooks belong in the presentation profile`);
    const services: Partial<MotionServices> = Object.fromEntries(Object.keys(BUILTIN_SERVICES)
      .filter(slot => candidate.lock.providers[slot] && candidate.service(slot) !== BUILTIN_SERVICES[slot as keyof MotionServices])
      .map(slot => [slot, candidate.service(slot)]));
    const customAuthority = (options.code ?? []).some(m => m.manifest.authority === 'authoritative'
      && candidate.lock.order.includes(m.manifest.id)
      && (!m.manifest.slots.length || Object.values(candidate.lock.providers).includes(m.manifest.id))
      && !m.supportsMultiplayer);
    const lock = computeAuthoritativeLock({
      profileId: candidate.lock.profileId,
      order: candidate.lock.order,
      manifests: runtime.registry.manifests,
      providers: candidate.lock.providers,
      settings: candidate.lock.settings,
      rules,
      forces,
      contentDigests: Object.fromEntries([
        // Bind resolved physical content as well as its editable source definitions.
        ...((enabled.some(m => m.manifest.authority === 'authoritative')
          || (options.code ?? []).some(m => m.contentDigest && candidate.lock.order.includes(m.manifest.id)))
          ? [['world.universe', physicalUniverseDigest(universe)]] : []),
        ...enabled.filter(m => m.manifest.authority === 'authoritative').map(m => [m.manifest.id, sha256Hex(canonicalJson(m))]),
        ...(options.code ?? []).filter(m => m.contentDigest && m.manifest.authority === 'authoritative' && candidate.lock.order.includes(m.manifest.id))
          .map(m => [m.manifest.id, m.contentDigest!]),
      ]),
    });
    const factory: SimulationContextFactory = (settings, worldOptions) => createContext(settings, { ...worldOptions, dynamics, forces, services, worldRules: rules.length > 0 });
    const world = new World(universe, { id: options.id, systemId: options.systemId,
      createContext: factory,
      rules,
      forces,
      commands,
      lock,
      soloPreview: options.soloPreview !== undefined ? options.soloPreview : customAuthority });
    const disposeWorld = world.dispose.bind(world);
    candidate.own({ dispose: disposeWorld });
    world.dispose = () => candidate.dispose();
    return { runtime, candidate, world, profile, createContext: factory };
  } catch (error) {
    candidate.dispose();
    if (installed.length) throw new Error(`Profile ${profile.id} (modules ${installed.map(m => m.manifest.id).join(', ')}): ${(error as Error).message}`, { cause: error });
    throw error;
  }
}
/** Legacy universe files can be included in a portable data profile without source. */
export function universeDataModule(universe: UniverseDefinition): DataModule {
  return validateDataModule({ format: 'space-sim-data-module/1', manifest: {
    ...builtinManifest('local.imported-universe', []), kind: 'data', name: universe.name,
    provides: [], dependencies: [{ id: 'builtin.content', version: '0.1.0' }],
  }, data: { universes: [{ definition: universe }] } });
}

/** Restore only against already installed/enabled code. Saved source is never executed.
 * Build an isolated candidate and verify its exact lock before accepting ship state. */
export function loadInstalledWorld(raw: unknown, options: { readonly environment: ModuleEnvironment;
  readonly data?: readonly DataModule[]; readonly code?: readonly RegisteredModule[] }): LoadedWorld & { readonly prepared?: PreparedGame } {
  if (!raw || typeof raw !== 'object') throw new Error('Save: expected an object');
  const save = raw as Record<string, unknown>;
  if (save.version === 1) return loadWorld(raw, { createContext: builtinContextFactory(options.environment) });
  const lock = save.lock as import('../../game-api/src/index').AuthoritativeLock | undefined;
  if (!lock || lock.format !== 'space-sim-auth-lock/1') throw new Error('Save: missing authoritative module lock');
  const profile = validateProfile({ format: 'space-sim-profile/1', id: lock.profileId,
    modules: lock.modules, providers: lock.providers, settings: lock.settings });
  const prepared = prepareGame({ ...options, profile, universe: validateUniverse(save.universe),
    systemId: typeof save.systemId === 'string' ? save.systemId : undefined, resolvedUniverse: true });
  try {
    if (canonicalJson(prepared.world.lock) !== canonicalJson(lock)
      || prepared.world.simulationFingerprint !== save.simulationFingerprint) throw new Error('Save: installed module contents, settings or geometry differ from the required lock; install the exact required artifacts/profile');
    const loaded = loadWorld(raw, { createContext: prepared.createContext, rules: prepared.world.rules,
      forces: prepared.world.forces, commands: prepared.world.commands, soloPreview: prepared.world.soloPreview,
      migrateState: prepared.candidate.migrateState });
    const dispose = loaded.world.dispose.bind(loaded.world);
    prepared.candidate.own({ dispose });
    loaded.world.dispose = () => prepared.candidate.dispose();
    prepared.runtime.activate(prepared.candidate);
    return { ...loaded, prepared };
  } catch (error) { prepared.candidate.dispose(); throw error; }
}
