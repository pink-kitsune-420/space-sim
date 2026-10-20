import { CANVAS_DRAWING, type CanvasRendererFactory, type ModuleInitializationV2, type Render2DOptions, type SceneFrame, type SceneRenderer, type ServiceKey } from '@space-sim/game-api';

export interface CanvasViewerHelper {
  renderScene(canvas: HTMLCanvasElement, frame: SceneFrame, options?: Render2DOptions): SceneRenderer;
}

export const CANVAS_VIEWER_HELPER: ServiceKey<CanvasViewerHelper> = Object.freeze({
  slot: 'example.canvas-renderer',
  version: '1.0.0',
});

export function createCanvasViewerHelper(factory: CanvasRendererFactory): CanvasViewerHelper {
  return Object.freeze({
    renderScene(canvas: HTMLCanvasElement, frame: SceneFrame, options?: Render2DOptions): SceneRenderer {
      const renderer = factory.create(canvas, options);
      renderer.drawScene(frame);
      return renderer;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(CANVAS_DRAWING);
  context.provide(CANVAS_VIEWER_HELPER, createCanvasViewerHelper(factory));
}
