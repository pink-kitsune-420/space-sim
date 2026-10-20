import type { ModuleAssets, ModuleInitializationV2, ShaderLibrary, ShaderPack, ShaderPass } from '@space-sim/game-api';
import { VECTOR_SHADERS, validateShaderDefinition, parseShaderDefinition } from '@space-sim/game-api';
/** Create the vector shader library from bundled GLSL assets, providing immutable defaults, validation, and parsing. */
export function createVectorShaders(assets: Pick<ModuleAssets, 'text'>): ShaderLibrary {
  const passes = Object.fromEntries((['scene', 'vector', 'text'] as const).map(pass => [pass,
    Object.freeze({ vertex: assets.text(`assets/${pass}.vert`), fragment: assets.text(`assets/${pass}.frag`) })])) as Record<ShaderPass, { vertex: string; fragment: string }>;
  const defaults: ShaderPack = Object.freeze({ format: 'space-sim-shaders/1', name: 'Default', passes: Object.freeze(passes) });
  // Validate once without touching a graphics context; compiling belongs to a renderer instance.
  validateShaderDefinition(defaults, defaults);
  return Object.freeze({ defaults, validate: (raw: unknown) => validateShaderDefinition(raw, defaults),
    parse: (text: string, filename: string) => parseShaderDefinition(text, filename, defaults) });
}

/** Initialize the vector shader pack module, providing render.vector-shaders@1.0.0 and registering its usage guide. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Vector shaders",summary:"Public render.vector-shaders@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'}); context.provide(VECTOR_SHADERS, createVectorShaders(context.assets)); }
