import { PLANET_GENERATOR, type ModuleInitializationV2 } from '@space-sim/game-api';
import { createPlanetGenerator } from './factory';
export { createPlanetGenerator } from './factory';

/** Supplies the optional authoritative planet.generator@1.0.0 service.
 * Its pure float64 field and bounded cooperative bakes contain no renderer,
 * physics or browser dependencies. It does not modify an active world. */
export default function initialize(context: ModuleInitializationV2): void {
  if (context.selected(PLANET_GENERATOR.slot)) context.provide(PLANET_GENERATOR, context.own(createPlanetGenerator()));
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Shared planet generation',
    summary: 'Deterministic body-fixed fields and bounded equatorial/map bakes, independent of rendering and world physics.', asset: 'docs/creators/usage.json' });
}
