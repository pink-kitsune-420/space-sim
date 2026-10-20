import {
  NAVBALL_HUD,
  type HudInstrument,
  type HudInstrumentContext,
  type HudInstrumentDefinition,
  type OverlayPrimitive,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface NavballViewerHelper {
  createInstrument(context: HudInstrumentContext): HudInstrument;
  drawNavball(instrument: HudInstrument): OverlayPrimitive[];
}

export const NAVBALL_VIEWER_HELPER: ServiceKey<NavballViewerHelper> = Object.freeze({
  slot: 'example.navball',
  version: '1.0.0',
});

export function createNavballViewerHelper(definition: HudInstrumentDefinition): NavballViewerHelper {
  return Object.freeze({
    createInstrument(context: HudInstrumentContext): HudInstrument {
      return definition.create(context);
    },
    drawNavball(instrument: HudInstrument): OverlayPrimitive[] {
      const overlays: OverlayPrimitive[] = [];
      instrument.draw(overlays);
      return overlays;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const definition = context.use(NAVBALL_HUD);
  context.provide(NAVBALL_VIEWER_HELPER, createNavballViewerHelper(definition));
}
