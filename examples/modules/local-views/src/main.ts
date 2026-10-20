import {
  LOCAL_VIEWS,
  type LocalViewFactory,
  type LocalViewOptions,
  type LocalViews,
  type PaneRect,
  type TwoPlayerLayout,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface LocalViewsHelper {
  computePanes(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[];
  createViews(options: LocalViewOptions): LocalViews;
}

export const LOCAL_VIEWS_HELPER: ServiceKey<LocalViewsHelper> = Object.freeze({
  slot: 'example.local-views',
  version: '1.0.0',
});

export function createLocalViewsHelper(factory: LocalViewFactory): LocalViewsHelper {
  return Object.freeze({
    computePanes(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[] {
      return factory.paneRects(count, layout, width, height);
    },
    createViews(options: LocalViewOptions): LocalViews {
      return factory.create(options);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(LOCAL_VIEWS);
  context.provide(LOCAL_VIEWS_HELPER, createLocalViewsHelper(factory));
}
