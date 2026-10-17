import sceneVertex from './shaders/scene.vert?raw';
import sceneFragment from './shaders/scene.frag?raw';
import vectorVertex from './shaders/vector.vert?raw';
import vectorFragment from './shaders/vector.frag?raw';
import textVertex from './shaders/text.vert?raw';
import textFragment from './shaders/text.frag?raw';
import type { ShaderPack, ShaderPass, ShaderSources } from '../../game-api/src/index';
export type { ShaderPack, ShaderPass, ShaderSources } from '../../game-api/src/index';

export const SHADER_FORMAT = 'space-sim-shaders/1';
export const MAX_SHADER_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_LENGTH = 256 * 1024;
export const SHADER_PASSES: readonly ShaderPass[] = Object.freeze(['scene', 'vector', 'text'] as const);
/** Stable drawing roles shared with GLSL; palette values live in the default fragments. */
export const ShaderStyle = Object.freeze({
  orbit: 1, path: 2, pad: 3, flame: 4, ship: 5, crashedShip: 6, outline: 7,
  scale: 8, bodyLabel: 9, starLabel: 10, telemetryLabel: 11, fleetShip: 12, foreignShip: 13,
});

/** Bundled as strings, so defaults also work in the standalone file without fetching. */
export const DEFAULT_SHADERS: ShaderPack = Object.freeze({
  format: SHADER_FORMAT,
  name: 'Default',
  passes: Object.freeze({
    scene: Object.freeze({ vertex: sceneVertex, fragment: sceneFragment }),
    vector: Object.freeze({ vertex: vectorVertex, fragment: vectorFragment }),
    text: Object.freeze({ vertex: textVertex, fragment: textFragment }),
  }),
});

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`Unknown ${label} field: ${key}.`);
  }
}
function source(value: unknown, fallback: string, label: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_SOURCE_LENGTH) {
    throw new Error(`${label} must be nonempty GLSL of at most ${MAX_SOURCE_LENGTH} characters.`);
  }
  return value;
}

/** Partial packs inherit built-in stages, never stages from the previously loaded pack. */
export function validateShaderPack(value: unknown): ShaderPack {
  const pack = record(value, 'Shader pack');
  keys(pack, ['format', 'name', 'passes'], 'shader pack');
  if (pack.format !== SHADER_FORMAT) throw new Error(`Expected format "${SHADER_FORMAT}".`);
  if (typeof pack.name !== 'string' || !pack.name.trim() || pack.name.length > 80) {
    throw new Error('Shader name must contain 1–80 characters.');
  }
  const passes = record(pack.passes, 'passes');
  keys(passes, SHADER_PASSES, 'pass');
  if (Object.keys(passes).length === 0) throw new Error('Provide at least one shader pass.');
  const resolved = {} as Record<ShaderPass, ShaderSources>;
  for (const pass of SHADER_PASSES) {
    const defaults = DEFAULT_SHADERS.passes[pass];
    const stages = passes[pass] === undefined ? {} : record(passes[pass], pass);
    keys(stages, ['vertex', 'fragment'], pass);
    resolved[pass] = Object.freeze({
      vertex: source(stages.vertex, defaults.vertex, `${pass}.vertex`),
      fragment: source(stages.fragment, defaults.fragment, `${pass}.fragment`),
    });
  }
  return Object.freeze({ format: SHADER_FORMAT, name: pack.name.trim(), passes: Object.freeze(resolved) });
}

/** A .frag/.glsl file replaces just the scene fragment; JSON can replace all six stages. */
export function parseShaderFile(text: string, filename: string): ShaderPack {
  if (new TextEncoder().encode(text).byteLength > MAX_SHADER_FILE_BYTES) throw new Error('Shader files must be at most 1 MiB.');
  if (/\.(frag|glsl)$/i.test(filename)) {
    return validateShaderPack({ format: SHADER_FORMAT, name: filename.slice(0, 80), passes: { scene: { fragment: text } } });
  }
  return validateShaderPack(JSON.parse(text));
}
