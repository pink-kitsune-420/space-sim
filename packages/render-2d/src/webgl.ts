/** Host-only WebGL 2 renderer adapter (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `WEBGL_DRAWING` (`render.webgl@1.0.0`) from `@space-sim/game-api`. */
import type { ShaderPack } from '../../game-api/src/index';
import { WebGLRenderer as PortableWebGL } from '../../../modules/render-webgl/src/webgl';
import { DEFAULT_SHADERS } from './shaders';
import { legacyRenderPorts } from './compatibility';
/** Host compatibility WebGL 2 renderer bound to legacy engine ports (`geometry`, `legacyTheme`, `trainerArtwork`) and default shaders. Modules obtain WebGL drawing through `WEBGL_DRAWING` (`render.webgl@1.0.0`). Host-only (`packages/render-2d`). */
export class WebGLRenderer extends PortableWebGL { constructor(canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) { super(canvas, shaders, legacyRenderPorts); } }
