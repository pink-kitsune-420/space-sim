import { requireTileChunkFeatures } from '@space-sim/game-api';
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

/** A rotated, clipped foreground cell using the version 1 tile subset.
 * Call only after checking renderer.features?.tileChunks?.version === 1.
 * Buffers and vertices remain immutable until drawing finishes. */
export function clippedTileExample(): import('@space-sim/game-api').OverlayPrimitive {
  const tiles = new Uint16Array(1024); tiles[0] = 1;
  return { kind: 'tile-chunk', space: 'world', origin: { x: 0, y: 0 }, size: 32,
    tileMetres: .5, rotationRadians: Math.PI / 4, tiles,
    clipPolygon: [{ x: 0, y: 0 }, { x: .5, y: 0 }, { x: .5, y: .25 }, { x: 0, y: .5 }] };
}

/** Preflight an essential supplied-light consumer before play; optional appearance
 * consumers can keep their vector fallback instead. No light calculation here. */
export function suppliedLightTileExample(features: import('@space-sim/game-api').RendererFeatures): import('@space-sim/game-api').OverlayPrimitive {
  requireTileChunkFeatures(features, {lightEncoding:'nibble',walls:true});
  const tiles = new Uint16Array(1024); tiles[0]=1;
  const walls = new Uint16Array(1024); walls[1]=2;
  const light = new Uint8Array(1024).fill(15); light[0]=0;
  return {kind:'tile-chunk',space:'world',origin:{x:0,y:0},size:32,tileMetres:.5,tiles,walls,light,lightEncoding:'nibble'};
}
