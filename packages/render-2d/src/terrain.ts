/** Host-only terrain geometry adapter (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `Render2DOptions.geometry` (`RenderGeometry.querySurface`) or `modules/render-canvas`. */
import type { Camera, RenderBody, SurfaceProfile } from '../../game-api/src/index';
import { querySurface } from '../../sim-core/src/surface';
import { terrainGeometry as geometry } from '../../../modules/render-canvas/src/terrain';
export * from '../../../modules/render-canvas/src/terrain';
const geometryPort = Object.freeze({ querySurface });
/** Computes screen-space terrain ribbon geometry using host `querySurface`. Modules supply `RenderGeometry` via `Render2DOptions.geometry`. Host-only (`packages/render-2d`). */
export function terrainGeometry(body: RenderBody & { surface: SurfaceProfile }, camera: Camera, width: number, height: number) {
  return geometry(body, camera, width, height, geometryPort);
}
