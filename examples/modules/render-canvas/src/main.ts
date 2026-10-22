import { requireTileChunkFeatures, surfaceOverviewColor } from '@space-sim/game-api';
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

/** Explicit cosmetic radial air, borrowed through drawing. A host supplies phase;
 * this example stays static and never advances simulation or assumes shader ABI.
 * Near sky follows the supplied sun and fades to space with altitude/overview zoom. */
export function independentAirExample(body: import('@space-sim/game-api').RenderBody,
  features: import('@space-sim/game-api').RendererFeatures): import('@space-sim/game-api').RenderBody {
  if (!features.independentAir) return body;
  return { ...body, air: { mode: 'clouds', heightMetres: body.radius * .06,
    cloudAltitudeMetres: body.radius * .018, cloudThicknessMetres: body.radius * .004,
    color: [.416, .706, .925], opacity: .12, phaseRadians: 0 } };
}

/** Smallest constant linear summary; canonical radial terrain owns clipping. */
export function planetOverviewExample(body: import('@space-sim/game-api').RenderBody,
  features: import('@space-sim/game-api').RendererFeatures): import('@space-sim/game-api').RenderBody {
  if (!features.planetOverview) return body;
  return { ...body, overview: { levels: [{ sectors: 1, rings: 1, rgba: new Float32Array([.15, .12, .10, 1]) }] } };
}

/** Constant three-material ribbon transport. A real host supplies descriptor-derived
 * immutable packed identities and angular mips; the renderer never generates cells. */
export function surfaceOverviewExample(): import('@space-sim/game-api').RenderOverviewSurface {
  return { sectors: 1, rows: 1, depthMetres: 16, samples: new Uint8Array([0]),
    levels: [], palette: [[.15, .12, .10], [.08, .11, .13], [.05, .06, .07]] };
}

/** Filter32m along the rim while retaining a2m-deep physical footprint. Coarse
 * angular mesh sampling must not mix unrelated depth bands into the visible skin. */
export function sampleSurfaceOverviewExample(body: import('@space-sim/game-api').RenderBody, out: Float64Array): boolean {
  return surfaceOverviewColor(body, Math.PI / 2, 2, 32, out, 2);
}

/** Canvas is a low-detail fallback: default 1x pixel cap, no decorative clouds,
 * a light backdrop and two-band globes. Explicit resolution overrides do not
 * change contact/terrain or the caller's saved graphics preferences. */
export function fallbackResolutionExample(): Render2DOptions { return { maxPixelRatio: 1 }; }
