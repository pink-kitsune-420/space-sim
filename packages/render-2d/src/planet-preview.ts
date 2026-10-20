/** Host-only planet preview renderer (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use the `preview(canvas, shaders)` method on the `WEBGL_DRAWING` factory (`render.webgl@1.0.0`). */
import type { ShaderPack } from '../../game-api/src/index';
import { PlanetPreview as PortablePreview } from '../../../modules/render-webgl/src/planet-preview';
import { DEFAULT_SHADERS } from './shaders';
/** Host compatibility planet preview canvas renderer. Modules access planet preview rendering through the `WEBGL_DRAWING` service factory (`preview(canvas, shaders)`). Host-only (`packages/render-2d`). */
export class PlanetPreview extends PortablePreview { constructor(canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) { super(canvas, shaders); } }
