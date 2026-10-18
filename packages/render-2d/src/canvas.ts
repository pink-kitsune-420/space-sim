import { CanvasRenderer as PortableCanvas } from '../../../modules/render-canvas/src/canvas';
import { legacyRenderPorts } from './compatibility';
export { parallelArcs, drawPlanetHorizon } from '../../../modules/render-canvas/src/canvas';
export class CanvasRenderer extends PortableCanvas { constructor(canvas: HTMLCanvasElement) { super(canvas, legacyRenderPorts); } }
