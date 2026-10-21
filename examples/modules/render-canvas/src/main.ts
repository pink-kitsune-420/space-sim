import { CANVAS_DRAWING, type CanvasRendererFactory, type ModuleInitializationV2, type OverlayPrimitive, type Render2DOptions, type SceneFrame, type SceneRenderer, type ServiceKey } from '@space-sim/game-api';

/** The same optional tile background supported by the WebGL renderer. Reuse between draws. */
export function exampleTileBackground(): OverlayPrimitive {
  const tiles = new Uint16Array(1024); tiles[0] = 1;
  const walls = new Uint16Array(1024); walls[1] = 1;
  return { kind: 'tile-chunk', space: 'world', origin: { x: 0, y: 0 }, tileMetres: 1, size: 32, tiles, walls };
}

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
