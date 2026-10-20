/** Host-only default shader pack and parser utilities (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `VECTOR_SHADERS`, `validateShaderDefinition`, or `parseShaderDefinition` from `@space-sim/game-api`. */
import sceneVertex from '../../../modules/shaders-vector/assets/scene.vert?raw';
import sceneFragment from '../../../modules/shaders-vector/assets/scene.frag?raw';
import vectorVertex from '../../../modules/shaders-vector/assets/vector.vert?raw';
import vectorFragment from '../../../modules/shaders-vector/assets/vector.frag?raw';
import textVertex from '../../../modules/shaders-vector/assets/text.vert?raw';
import textFragment from '../../../modules/shaders-vector/assets/text.frag?raw';
import type { ShaderPack } from '../../game-api/src/index';
import { validateShaderDefinition, parseShaderDefinition } from '../../game-api/src/index';
export { SHADER_FORMAT, MAX_SHADER_FILE_BYTES, SHADER_PASSES, ShaderStyle } from '../../../modules/render-webgl/src/shaders';
export type { ShaderPack, ShaderPass, ShaderSources } from '../../game-api/src/index';
const SHADER_FORMAT = 'space-sim-shaders/1';
/** Bundled as strings, so defaults also work in the standalone file without fetching. Modules use `VECTOR_SHADERS`. Host-only (`packages/render-2d`). */
export const DEFAULT_SHADERS: ShaderPack = Object.freeze({
  format: SHADER_FORMAT,
  name: 'Default',
  passes: Object.freeze({
    scene: Object.freeze({ vertex: sceneVertex, fragment: sceneFragment }),
    vector: Object.freeze({ vertex: vectorVertex, fragment: vectorFragment }),
    text: Object.freeze({ vertex: textVertex, fragment: textFragment }),
  }),
});

/** Validates an unknown object as a `ShaderPack`, falling back to `DEFAULT_SHADERS`. Modules use `validateShaderDefinition` from `@space-sim/game-api`. Host-only (`packages/render-2d`). */
export const validateShaderPack = (value: unknown): ShaderPack => validateShaderDefinition(value, DEFAULT_SHADERS);
/** Parses shader pack text or a single `.frag`/`.glsl` shader file (≤ 1 MiB) with fallback to `DEFAULT_SHADERS`. Modules use `parseShaderDefinition` from `@space-sim/game-api`. Host-only (`packages/render-2d`). */
export const parseShaderFile = (text: string, filename: string): ShaderPack => parseShaderDefinition(text, filename, DEFAULT_SHADERS);
