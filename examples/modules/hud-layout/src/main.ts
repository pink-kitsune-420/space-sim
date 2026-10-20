import {
  HUD_LAYOUT,
  type HudLayout,
  type HudLayoutFactory,
  type HudLayoutOptions,
  type HudRect,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface HudLayoutHelper {
  createLayout(options: HudLayoutOptions): HudLayout;
  fitBounds(
    layout: HudLayout,
    preferred: HudRect,
    width: number,
    height: number,
    canvas?: HTMLCanvasElement,
    avoid?: boolean,
  ): HudRect;
}

export const HUD_LAYOUT_HELPER: ServiceKey<HudLayoutHelper> = Object.freeze({
  slot: 'example.hud-layout',
  version: '1.0.0',
});

export function createHudLayoutHelper(factory: HudLayoutFactory): HudLayoutHelper {
  return Object.freeze({
    createLayout(options: HudLayoutOptions): HudLayout {
      return factory.create(options);
    },
    fitBounds(
      layout: HudLayout,
      preferred: HudRect,
      width: number,
      height: number,
      canvas?: HTMLCanvasElement,
      avoid = false,
    ): HudRect {
      return layout.fit(preferred, width, height, canvas, avoid);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(HUD_LAYOUT);
  context.provide(HUD_LAYOUT_HELPER, createHudLayoutHelper(factory));
}
