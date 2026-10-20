import { LOCAL_VIEWS, VIEW_CAMERAS, type LocalCameraFactory, type LocalCameraInput, type LocalViewOptions, type LocalViews } from '@space-sim/game-api';
import type { ModuleInitializationV2 } from '@space-sim/game-api';
import { dynamicPaneRects, paneRects } from './layout';

/** Presentation-only allocation. Neither a surface nor a camera receives a world-step API. */
export function createLocalViews(cameras: LocalCameraFactory, options: LocalViewOptions): LocalViews {
  if (options.bindings.length < 1 || options.bindings.length > 4
    || new Set(options.bindings.map(b => b.viewportId)).size !== options.bindings.length
    || new Set(options.bindings.map(b => b.seatId)).size !== options.bindings.length
    || options.bindings.some(b => !b.viewportId || !b.seatId)
    || !['auto', 'side', 'stacked'].includes(options.layout) || !['dynamic', 'split'].includes(options.mode)) throw new Error('Local views need 1–4 distinct seats and viewports with a supported layout');
  const views: { binding: Readonly<LocalViewOptions['bindings'][number]>; camera: ReturnType<LocalCameraFactory['create']>;
    surface: ReturnType<LocalViewOptions['surface']>; visible: boolean; input: { -readonly [K in keyof LocalCameraInput]: LocalCameraInput[K] } }[] = [];
  let disposed = false, splitActive = false, laidOut = false;
  const dispose = (): void => {
    if (disposed) return; disposed = true; splitActive = false; laidOut = false; const errors: unknown[] = [];
    for (let i = views.length - 1; i >= 0; i--) {
      try { views[i]!.surface.dispose(); } catch (error) { errors.push(error); }
      try { views[i]!.camera.dispose(); } catch (error) { errors.push(error); }
    }
    views.length = 0; if (errors.length) throw new AggregateError(errors, 'Local view cleanup failed');
  };
  const live = (): void => { if (disposed) throw new Error('Local views are disposed'); };
  try {
    for (const value of options.bindings) {
      const binding = Object.freeze({ ...value }), camera = cameras.create(binding.viewportId);
      if (views.some(v => v.camera === camera)) throw new Error('Camera provider must create independent viewport instances');
      try {
        if (camera.viewportId !== binding.viewportId) throw new Error('Camera provider returned the wrong viewport identity');
        camera.focus(binding.targetId);
        const surface = options.surface(binding);
        if (views.some(v => v.surface === surface)) throw new Error('Renderer must create independent view surfaces');
        views.push({ binding, camera, surface, visible: true, input: { elapsed: 0, width: 1, height: 1, transform: () => undefined } });
      } catch (error) { camera.dispose(); throw error; }
    }
  } catch (error) { dispose(); throw error; }
  return { get count() { return views.length; }, get splitActive() { return splitActive; },
    camera(id) { live(); const view = views.find(view => view.binding.viewportId === id); if (!view) throw new Error(`Unknown viewport ${id}`); return view.camera; },
    reflow(width, height, separatedGuests = new Set()) {
      live(); if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) throw new Error('Viewport dimensions must be positive finite pixels');
      laidOut = false;
      const layout = options.mode === 'split' ? { rects: paneRects(views.length, options.layout, width, height), visible: views.map(() => true) }
        : dynamicPaneRects(views.length, separatedGuests, options.layout, width, height);
      splitActive = layout.visible.filter(Boolean).length > 1;
      for (let i = 0; i < views.length; i++) {
        const view = views[i]!, rect = layout.rects[i]!; view.visible = layout.visible[i]!;
        view.input.width = rect.w * width; view.input.height = rect.h * height;
        view.surface.resize(rect, width, height, view.visible);
      }
      laidOut = true;
    },
    render(elapsed, transform) {
      live(); if (!Number.isFinite(elapsed) || elapsed < 0) throw new Error('View elapsed time must be finite wall seconds');
      if (!laidOut) throw new Error('Reflow local views before rendering');
      for (let i = 0; i < views.length; i++) {
        const view = views[i]!; if (!view.visible) continue;
        view.input.elapsed = elapsed; view.input.transform = transform; view.surface.draw(view.camera.frame(view.input));
      }
    }, dispose,
  };
}
/**
 * Contributes independent local viewport allocation and pane layout calculations.
 * Provides view.local@1.0.0 in the view.local slot; requires view.camera@^1.0.0.
 */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Independent local views", summary: "Allocates independent camera/surface lifetimes and the existing split/dynamic pane layouts.", asset: 'docs/creators/usage.json' });
  const cameras = context.use(VIEW_CAMERAS), views = new Set<LocalViews>(); let disposed = false;
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const view of views) { try { view.dispose(); } catch (error) { errors.push(error); } }
    views.clear(); if (errors.length) throw new AggregateError(errors, 'Local view provider cleanup failed'); } });
  context.provide(LOCAL_VIEWS, Object.freeze({ paneRects, dynamicPaneRects, create(options: LocalViewOptions) {
    if (disposed) throw new Error('Local view provider is disposed');
    const view = createLocalViews(cameras, options), dispose = view.dispose.bind(view);
    view.dispose = () => { try { dispose(); } finally { views.delete(view); } }; views.add(view); return view;
  } }));
}
