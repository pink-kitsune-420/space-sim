import type { ServiceKey } from './modules-v2';
import type { PlanetFieldDefinition } from './planet-field/definition';
import type { createPlanetField } from './planet-field/field';
import type { PlanetBake, PlanetBakeOptions } from './planet-field/bake';

export { validatePlanetField } from './planet-field/definition';
export type { PlanetFieldDefinition } from './planet-field/definition';
export { createPlanetField } from './planet-field/field';
export { createPlanetBake, PLANET_BAKE_MAX_BYTES } from './planet-field/bake';
export type { PlanetBake, PlanetBakeOptions, PlanetBakeResult } from './planet-field/bake';
/** Caller-owned deterministic body-fixed sphere field; query into eight float64
 * slots. Pure mathematical instances remain usable after the factory is disposed. */
export type PlanetField = ReturnType<typeof createPlanetField>;
/** Reusable headless planet generator. At most two unfinished/untransferred bake
 * jobs per service. Callers schedule job.step in a worker or between yields.
 * Module disposal cancels owned jobs and rejects new calls; transferred data and
 * pure fields remain caller-owned. It neither changes worlds nor installs physics. */
export interface PlanetGenerator {
  create(definition: PlanetFieldDefinition): PlanetField;
  bake(definition: PlanetFieldDefinition, options: PlanetBakeOptions): PlanetBake;
}
/** Optional authoritative world-generation service, supplied by an explicitly
 * selected generator module. Renderer and climate consumers use its baked data. */
export const PLANET_GENERATOR: ServiceKey<PlanetGenerator> = Object.freeze({ slot: 'planet.generator', version: '1.0.0' });
