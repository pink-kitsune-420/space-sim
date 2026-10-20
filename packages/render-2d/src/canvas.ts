/** Host-only Canvas 2D renderer adapter (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `CANVAS_DRAWING` (`render.canvas@1.0.0`) from `@space-sim/game-api`. */
import { CanvasRenderer as PortableCanvas } from '../../../modules/render-canvas/src/canvas';
import { legacyRenderPorts } from './compatibility';
export { parallelArcs, drawPlanetHorizon } from '../../../modules/render-canvas/src/canvas';
/** Host compatibility Canvas 2D renderer bound to legacy engine ports (`geometry`, `legacyTheme`, `trainerArtwork`). Modules obtain canvas drawing through `CANVAS_DRAWING` (`render.canvas@1.0.0`). Host-only (`packages/render-2d`). */
export class CanvasRenderer extends PortableCanvas { constructor(canvas: HTMLCanvasElement) { super(canvas, legacyRenderPorts); } }
