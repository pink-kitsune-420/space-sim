import { TRAINER_VEHICLE_ID } from '../../game-api/src/index';
import type { DynamicsProvider, ModuleManifest, MotionServices, SimulationContextFactory, UniverseDefinition } from '../../game-api/src/index';
import type { GameIdentity } from '../../game-runtime/src/game-loader';
import type { ModuleCandidateV2 } from '../../game-runtime/src/modules-v2';
import { computeAuthoritativeLock, physicalUniverseDigest } from '../../game-runtime/src/authoritative';
import { satisfies } from '../../game-runtime/src/semver';
import { BUILTIN_SERVICES } from './services';
import { createSimulationContext } from './context';
import { DEFAULT_UNIVERSE, validateUniverse } from './universe';
import { World, type WorldOptions } from './world';

export interface ModuleWorldOptions {
  readonly id?: string; readonly universeKey?: string; readonly systemId?: string;
  readonly universe?: UniverseDefinition;
  /** Codec/composition adapter applies already validated data payloads. No runtime import
   * of the module collection or package codecs is needed in this engine adapter. */
  readonly resolveContent?: (base: ReadonlyMap<string, UniverseDefinition>) => ReadonlyMap<string, UniverseDefinition>;
}
/** Concrete world construction for the injected shared loader, usable by browser and
 * server. It preserves existing physics and binds the v2 module schedule into the world's
 * authoritative content identity. Legacy worlds continue through their unchanged serializer. */
export function createModuleWorld(candidate: ModuleCandidateV2, identity: GameIdentity, options: ModuleWorldOptions = {}): World {
  const configuration = moduleWorldConfiguration(candidate, identity, options);
  return new World(configuration.universe, configuration.options);
}
/** The same verified configuration restores state without constructing a second simulation. */
export function moduleWorldConfiguration(candidate: ModuleCandidateV2, identity: GameIdentity, options: ModuleWorldOptions = {}): {
  readonly universe: UniverseDefinition; readonly options: WorldOptions;
} {
  const service = <T>(slot: string): T => {
    const id = candidate.lock.providers[slot], provider = identity.manifests.find(m => m.id === id);
    const capability = provider?.provides.find(c => c.name === slot);
    if (!capability || !satisfies(capability.version, '^1.0.0')) throw new Error(`World requires compatible ${slot}@1 service`);
    return candidate.providedService<T>({ slot, version: capability.version });
  };
  const base = candidate.lock.providers.content ? new Map(service<ReadonlyMap<string, UniverseDefinition>>('content')) : new Map<string, UniverseDefinition>();
  if (options.universe) base.set(`builtin.content/${options.universe.id}`, options.universe);
  const content = options.resolveContent ? options.resolveContent(base) : base;
  const selected = options.universeKey ? content.get(options.universeKey)
    : options.universe ?? (candidate.lock.providers.content ? content.get(`builtin.content/${DEFAULT_UNIVERSE.id}`) : DEFAULT_UNIVERSE);
  if (!selected) throw new Error(`Unknown universe ${options.universeKey ?? DEFAULT_UNIVERSE.id}`);
  const universe = validateUniverse(selected);
  const createContext = candidate.lock.providers.motion ? service<SimulationContextFactory>('motion') : createSimulationContext;
  const dynamics = candidate.lock.providers.dynamics ? service<DynamicsProvider>('dynamics') : undefined;
  // Selecting the fixed built-in service is not a model override. Preserve its legacy
  // coast identity/fast path, as v1 composition does; only real replacements enter options.
  const services: Partial<MotionServices> = Object.fromEntries(Object.keys(BUILTIN_SERVICES)
    .filter(slot => candidate.lock.providers[slot]).map(slot => [slot, service(slot)] as const)
    .filter(([slot, provider]) => provider !== BUILTIN_SERVICES[slot as keyof MotionServices]));
  const forces = candidate.core.forceExtensions, rules = candidate.core.worldRules, commands = candidate.core.commands;
  const manifests = new Map(identity.manifests.map(manifest => {
    const { tier, provides: _provides, requires: _requires, ...common } = manifest;
    // Identity projection only. Executable v2 metadata never enters the legacy resolver.
    const legacy: ModuleManifest = { ...common, format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1',
      authority: tier === 'authoritative' ? 'authoritative' : 'presentation', provides: [], requires: [] };
    return [manifest.id, legacy];
  }));
  const lock = computeAuthoritativeLock({ profileId: `v2.authority-${identity.authoritativeDigest}`, order: candidate.lock.order, manifests,
    providers: candidate.lock.providers, settings: candidate.lock.settings, rules, forces,
    contentDigests: { 'world.universe': physicalUniverseDigest(universe), 'world.module-resolution': identity.authoritativeDigest,
      ...Object.fromEntries(identity.packages.filter(ref => manifests.get(ref.id)?.authority === 'authoritative').map(ref => [ref.id, ref.digest])) } });
  const definitions = candidate.contributions('vehicle').map(c => c.value);
  const vehicles = definitions.length ? { format: 'space-sim-vehicles/1' as const,
    defaultId: definitions.some(d => d.id === TRAINER_VEHICLE_ID) ? TRAINER_VEHICLE_ID : [...definitions].sort((a,b) => a.id < b.id ? -1 : 1)[0]!.id,
    definitions } : undefined;
  const factory: SimulationContextFactory = (settings, options) => createContext(settings, { ...options, dynamics, forces, services, worldRules: rules.length > 0 });
  return { universe, options: { vehicles, id: options.id, systemId: options.systemId, createContext: factory,
    dataAdapters: candidate.contributions('data').map(c => c.value), rules, forces, commands, lock, soloPreview: candidate.soloPreview, migrateState: candidate.core.migrateState } };
}
