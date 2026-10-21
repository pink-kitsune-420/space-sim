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

/** Pass a VehicleArtwork catalog through Render2DOptions.vehicles. Its optional
 * metresPerUnit/detail paths work with the same world-space camera as terrain;
 * the renderer supplies distant navigation markers automatically. */
export function withPhysicalArtwork(options: Render2DOptions, vehicles: NonNullable<Render2DOptions['vehicles']>): Render2DOptions {
  return { ...options, vehicles };
}
