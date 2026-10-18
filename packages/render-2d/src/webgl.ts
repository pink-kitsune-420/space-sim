import type { ShaderPack } from '../../game-api/src/index';
import { WebGLRenderer as PortableWebGL } from '../../../modules/render-webgl/src/webgl';
import { DEFAULT_SHADERS } from './shaders';
import { legacyRenderPorts } from './compatibility';
export class WebGLRenderer extends PortableWebGL { constructor(canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) { super(canvas, shaders, legacyRenderPorts); } }
