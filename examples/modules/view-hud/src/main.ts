import {
  VIEW_HUD,
  type HudInstrumentDefinition,
  type HudSurface,
  type OverlayPrimitive,
  type ViewHud,
  type ViewHudFactory,
  type ViewHudOptions,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface ViewHudHelper {
  createHud(options: ViewHudOptions): ViewHud;
  populateInstruments(hud: ViewHud, instruments: readonly HudInstrumentDefinition[]): void;
  renderFrame(hud: ViewHud, surface: HudSurface, elapsed: number): OverlayPrimitive[];
}

export const VIEW_HUD_HELPER: ServiceKey<ViewHudHelper> = Object.freeze({
  slot: 'example.view-hud',
  version: '1.0.0',
});

export function createViewHudHelper(factory: ViewHudFactory): ViewHudHelper {
  return Object.freeze({
    createHud(options: ViewHudOptions): ViewHud {
      return factory.create(options);
    },
    populateInstruments(hud: ViewHud, instruments: readonly HudInstrumentDefinition[]): void {
      hud.select(instruments);
    },
    renderFrame(hud: ViewHud, surface: HudSurface, elapsed: number): OverlayPrimitive[] {
      hud.resize(surface);
      hud.update(elapsed);
      const overlays: OverlayPrimitive[] = [];
      hud.draw(overlays);
      return overlays;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(VIEW_HUD);
  context.provide(VIEW_HUD_HELPER, createViewHudHelper(factory));
}
