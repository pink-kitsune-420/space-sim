import {
  PLAYER_VIEWS,
  type HudBinding,
  type PlayerView,
  type PlayerViewAdapters,
  type PlayerViewFactory,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface PlayerViewHelper {
  composeView(binding: HudBinding, adapters: PlayerViewAdapters): PlayerView;
  rebindView(view: PlayerView, nextBinding: HudBinding): void;
}

export const PLAYER_VIEW_HELPER: ServiceKey<PlayerViewHelper> = Object.freeze({
  slot: 'example.player-view',
  version: '1.0.0',
});

export function createPlayerViewHelper(factory: PlayerViewFactory): PlayerViewHelper {
  return Object.freeze({
    composeView(binding: HudBinding, adapters: PlayerViewAdapters): PlayerView {
      return factory.create({ binding, adapters });
    },
    rebindView(view: PlayerView, nextBinding: HudBinding): void {
      view.bind(nextBinding);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(PLAYER_VIEWS);
  context.provide(PLAYER_VIEW_HELPER, createPlayerViewHelper(factory));
}
