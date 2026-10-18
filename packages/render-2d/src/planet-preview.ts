import type { ShaderPack } from '../../game-api/src/index';
import { PlanetPreview as PortablePreview } from '../../../modules/render-webgl/src/planet-preview';
import { DEFAULT_SHADERS } from './shaders';
export class PlanetPreview extends PortablePreview { constructor(canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) { super(canvas, shaders); } }
