import type { Camera, RenderBody, SurfaceProfile } from '../../game-api/src/index';
import { querySurface } from '../../sim-core/src/surface';
import { terrainGeometry as geometry } from '../../../modules/render-canvas/src/terrain';
export * from '../../../modules/render-canvas/src/terrain';
const geometryPort = Object.freeze({ querySurface });
export function terrainGeometry(body: RenderBody & { surface: SurfaceProfile }, camera: Camera, width: number, height: number) {
  return geometry(body, camera, width, height, geometryPort);
}
