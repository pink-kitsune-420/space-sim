import type { ModuleProfile, UniverseDefinition, SimulationContextFactory, RegisteredModule } from '../../../packages/game-api/src/index';
import { DEFAULT_PROFILE, prepareGame, createBuiltinRegistry, type DataModule, type PreparedGame } from '../../../packages/modules/src/index';
import { DEFAULT_UNIVERSE } from '../../../packages/sim-core/src/universe';
import type { World } from '../../../packages/sim-core/src/world';
import { newWorldId } from '../../../packages/net/src/sha256';
import { EXAMPLE_NAMES, GAME_EXAMPLES, exampleProfile, type ExampleName } from '../../../examples/modules/index';
import { moduleLibrary } from './module-library';
import { checkCommandKeys } from './commands';

const modules = new WeakMap<import('../../../packages/game-api/src/index').WorldRead, { readonly data: readonly DataModule[]; readonly profile: ModuleProfile; readonly universeKey: string; readonly baseUniverse: UniverseDefinition; readonly createContext: SimulationContextFactory;
  readonly runtime?: import('../../../packages/game-library/src/runtime-selection').RuntimeSelection }>();
export function worldModules(world: import('../../../packages/game-api/src/index').WorldRead) { return modules.get(world); }
export function rememberWorldModules(world: import('../../../packages/game-api/src/index').WorldRead, value: NonNullable<ReturnType<typeof worldModules>>): void { modules.set(world, value); }
export const environment = (): 'offline' | 'browser' => location.protocol === 'file:' ? 'offline' : 'browser';
export function builtinUniverses(): Map<string, UniverseDefinition> {
  const candidate = createBuiltinRegistry().prepare(DEFAULT_PROFILE, environment(), ['content']);
  try { return new Map([...candidate.service<ReadonlyMap<string, UniverseDefinition>>('content').values()].map(u => [u.id, u])); }
  finally { candidate.dispose(); }
}
/** Statically linked examples are installed, never enabled, until a profile selects them.
 * Command keys are checked against the console's own controls before activation. */
export function prepareLocalWorld(universe = DEFAULT_UNIVERSE, systemId: string | undefined = undefined,
  options: { readonly data?: readonly DataModule[]; readonly profile?: ModuleProfile; readonly universeKey?: string; readonly code?: readonly RegisteredModule[]; readonly derivedPlanets?: ReadonlyMap<string, import('../../../packages/game-api/src/index').SurfaceProfile> } = {}): PreparedGame {
  const prepared = prepareGame({ environment: environment(), id: newWorldId(), universe, systemId, code: [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')], ...options });
  try { checkCommandKeys(prepared.world.commands); } catch (error) { prepared.candidate.dispose(); throw error; }
  modules.set(prepared.world, { data: options.data ?? [], profile: prepared.profile,
    createContext: prepared.createContext, baseUniverse: universe, universeKey: options.universeKey ?? `builtin.content/${universe.id}` });
  return prepared;
}
export function createLocalWorld(universe = DEFAULT_UNIVERSE, systemId = universe.defaultSystemId, example?: ExampleName): World {
  const prepared = prepareLocalWorld(universe, systemId, example ? { profile: exampleProfile(example) } : {});
  prepared.runtime.activate(prepared.candidate);
  return prepared.world;
}

/** `?example=force|numerical|rule|commands` (or the older `?motion-example=`) selects an
 * installed authoritative example; `?presentation=<module id>[,…]` enables presentation modules. */
export function requestedModules(search = location.search): { readonly example?: ExampleName; readonly presentation: readonly string[] } {
  const params = new URLSearchParams(search);
  const name = params.get('example') ?? params.get('motion-example') ?? undefined;
  const example = EXAMPLE_NAMES.find(n => n === name);
  return { ...(example ? { example } : {}), presentation: (params.get('presentation') ?? '').split(',').map(id => id.trim()).filter(Boolean) };
}
