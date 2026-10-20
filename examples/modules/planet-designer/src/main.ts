import {
  PLANET_DESIGNERS,
  type ModuleInitializationV2,
  type PlanetDesignerControl,
  type PlanetDesignerFactory,
  type PlanetDesignerOptions,
  type ServiceKey,
} from '@space-sim/game-api';

export interface PlanetDesignerHelper {
  createDesigner(options: PlanetDesignerOptions): PlanetDesignerControl;
}

export const PLANET_DESIGNER_HELPER: ServiceKey<PlanetDesignerHelper> = Object.freeze({
  slot: 'example.planet-designer',
  version: '1.0.0',
});

export function createPlanetDesignerHelper(factory: PlanetDesignerFactory): PlanetDesignerHelper {
  return Object.freeze({
    createDesigner(options: PlanetDesignerOptions): PlanetDesignerControl {
      return factory.create(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(PLANET_DESIGNERS);
  context.provide(PLANET_DESIGNER_HELPER, createPlanetDesignerHelper(factory));
}
