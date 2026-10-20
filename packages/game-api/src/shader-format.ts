import type { ShaderPack, ShaderPass, ShaderSources } from './presentation';
const SHADER_FORMAT = 'space-sim-shaders/1';
const MAX_SHADER_FILE_BYTES = 1024 * 1024;
const MAX_SOURCE_LENGTH = 256 * 1024;
const SHADER_PASSES: readonly ShaderPass[] = Object.freeze(['scene', 'vector', 'text']);
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

/**
 * Validate, bound and freeze a shader pack definition against baseline defaults.
 * Partial packs inherit built-in stages, never stages from a previously loaded custom pack.
 *
 * @param value Raw object representation of a shader pack.
 * @param defaults Baseline defaults providing fallback stages for omitted passes.
 * @returns Frozen, validated ShaderPack with resolved passes.
 * @throws If format differs from 'space-sim-shaders/1', stages exceed 256 KiB, or fields are invalid.
 */
export function validateShaderDefinition(value: unknown, defaults: ShaderPack): ShaderPack {
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
    const stagesDefault = defaults.passes[pass];
    const stages = passes[pass] === undefined ? {} : record(passes[pass], pass);
    keys(stages, ['vertex', 'fragment'], pass);
    resolved[pass] = Object.freeze({
      vertex: source(stages.vertex, stagesDefault.vertex, `${pass}.vertex`),
      fragment: source(stages.fragment, stagesDefault.fragment, `${pass}.fragment`),
    });
  }
  return Object.freeze({ format: SHADER_FORMAT, name: pack.name.trim(), passes: Object.freeze(resolved) });
}

/**
 * Parse and validate a GLSL fragment file or JSON shader pack string.
 * A .frag/.glsl file replaces just the scene fragment; JSON can replace all six stages.
 *
 * @param text Source file text (UTF-8, up to 1 MiB).
 * @param filename Source filename used for extension detection and naming.
 * @param defaults Baseline defaults providing fallback stages.
 * @returns Frozen, validated ShaderPack with resolved passes.
 * @throws If file exceeds 1 MiB or shader syntax validation fails.
 */
export function parseShaderDefinition(text: string, filename: string, defaults: ShaderPack): ShaderPack {
  if (new TextEncoder().encode(text).byteLength > MAX_SHADER_FILE_BYTES) throw new Error('Shader files must be at most 1 MiB.');
  if (/\.(frag|glsl)$/i.test(filename)) {
    return validateShaderDefinition({ format: SHADER_FORMAT, name: filename.slice(0, 80), passes: { scene: { fragment: text } } }, defaults);
  }
  return validateShaderDefinition(JSON.parse(text), defaults);
}
