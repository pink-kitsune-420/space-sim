/** Optional definition.pads and padShoulderMetres flatten the same field for map and ring; they are not renderer-only edits. */
import { PLANET_GENERATOR, type PlanetBake, type PlanetFieldDefinition, type ServiceKey, type ModuleInitializationV2 } from '@space-sim/game-api';

/** Example creator boundary: the editor chooses a definition and schedules this
 * job's step between yields. The preview consumes transferred data; it never
 * derives a different geography from shader settings. The host may ship prepared
 * starter products; custom definitions still use this same bounded job and must
 * cancel abandoned work before enabling flight. */
export interface PlanetPreview { begin(definition: PlanetFieldDefinition): PlanetBake }
export const PLANET_PREVIEW: ServiceKey<PlanetPreview> = Object.freeze({ slot: 'example.planet-preview', version: '1.0.0' });

/** Requires planet.generator@^1.0.0 and supplies example.planet-preview@1.0.0. */
export default function initialize(context: ModuleInitializationV2): void {
  const generator = context.use(PLANET_GENERATOR);
  context.provide(PLANET_PREVIEW, Object.freeze({
    begin(definition: PlanetFieldDefinition) {
      return generator.bake(definition, { columns: 32, rows: 16, equatorSamples: 128 });
    },
  }));
}
