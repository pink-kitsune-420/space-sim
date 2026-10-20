/** Host-only bundled scenario definitions and catalog registry (`packages/scenarios`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); only the base content bridge `packages/modules/src/base/content.ts` imports `builtin.content`. Modules and game manifests reference bundled universes via `builtin.content/<id>` (e.g. `builtin.content/default-universe`). */
import { DEFAULT_UNIVERSE, validateUniverse, type UniverseDefinition } from '../sim-core/src/index';
import terrainWorlds from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import oceanWorld from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import fullSolarSystem from '../../games/space-sim/universes/astronomy/full-solar-system/universe.json';
import solarSystemFile from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import catalog from '../../games/space-sim/universes/catalog.json';

/** Universes bundled with the game and the server. Published as `builtin.content/dry-terrain-examples` (server alias `terrain`). Host-only (`packages/scenarios`). */
export const TERRAIN_UNIVERSE = validateUniverse({ ...terrainWorlds, name: 'Terrain worlds · mountains & craters' });
/** Ocean world universe with water and islands. Published as `builtin.content/ocean-example` (server alias `ocean`). Host-only (`packages/scenarios`). */
export const OCEAN_UNIVERSE = validateUniverse({ ...oceanWorld, name: 'Ocean world · islands & water' });

/** Simplified solar system universe. Published as `builtin.content/solar-system-universe` (server alias `solar`). Host-only (`packages/scenarios`). */
export const SOLAR_UNIVERSE: UniverseDefinition = validateUniverse(solarSystemFile);

/** The real solar system at 1:1 scale with every known moon (generated from NASA/JPL data by
 * scripts/generate_full_solar_system.py). Published as `builtin.content/full-solar-system` (server alias `full`). Host-only (`packages/scenarios`). */
export const FULL_SOLAR_UNIVERSE = validateUniverse(fullSolarSystem);

/** Short names accepted by the server's `universe` setting. */
const installed = new Map([DEFAULT_UNIVERSE, TERRAIN_UNIVERSE, OCEAN_UNIVERSE, SOLAR_UNIVERSE, FULL_SOLAR_UNIVERSE].map(u => [u.id, u]));
/** Catalog record of bundled universes indexed by server alias (`default`, `terrain`, `ocean`, `solar`, `full`). Modules reference universes by ID via `selection.universe` using `builtin.content/<id>`. Host-only (`packages/scenarios`). */
export const BUILTIN_UNIVERSES: Readonly<Record<string, UniverseDefinition>> = Object.freeze(Object.fromEntries(
  catalog.universes.map(entry => {
    const universe = installed.get(entry.id);
    if (!universe) throw new Error(`Universe catalog: ${entry.id} is not installed`);
    return [entry.alias, universe];
  })));
