import { DEFAULT_UNIVERSE, validateUniverse, type UniverseDefinition } from '../sim-core/src/index';
import terrainWorlds from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import oceanWorld from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import fullSolarSystem from '../../games/space-sim/universes/astronomy/full-solar-system/universe.json';
import solarSystemFile from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import catalog from '../../games/space-sim/universes/catalog.json';

/** Universes bundled with the game and the server. */
export const TERRAIN_UNIVERSE = validateUniverse({ ...terrainWorlds, name: 'Terrain worlds · mountains & craters' });
export const OCEAN_UNIVERSE = validateUniverse({ ...oceanWorld, name: 'Ocean world · islands & water' });

export const SOLAR_UNIVERSE: UniverseDefinition = validateUniverse(solarSystemFile);

/** The real solar system at 1:1 scale with every known moon (generated from NASA/JPL data by
 * scripts/generate_full_solar_system.py). */
export const FULL_SOLAR_UNIVERSE = validateUniverse(fullSolarSystem);

/** Short names accepted by the server's `universe` setting. */
const installed = new Map([DEFAULT_UNIVERSE, TERRAIN_UNIVERSE, OCEAN_UNIVERSE, SOLAR_UNIVERSE, FULL_SOLAR_UNIVERSE].map(u => [u.id, u]));
export const BUILTIN_UNIVERSES: Readonly<Record<string, UniverseDefinition>> = Object.freeze(Object.fromEntries(
  catalog.universes.map(entry => {
    const universe = installed.get(entry.id);
    if (!universe) throw new Error(`Universe catalog: ${entry.id} is not installed`);
    return [entry.alias, universe];
  })));
