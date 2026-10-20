import { VECTOR_SHADERS, type ModuleInitializationV2, type ServiceKey, type ShaderLibrary, type ShaderPack } from '@space-sim/game-api';

export interface ShaderPackSummary {
  readonly format: string;
  readonly name: string;
  readonly passes: readonly string[];
}

export interface ShaderValidationResult {
  readonly valid: boolean;
  readonly name?: string;
  readonly error?: string;
}

export interface CustomShadersHelper {
  summarizeDefaults(): ShaderPackSummary;
  loadFragmentOverride(filename: string, glsl: string): ShaderPack;
  validatePack(candidate: unknown): ShaderValidationResult;
}

export const CUSTOM_SHADERS_HELPER: ServiceKey<CustomShadersHelper> = Object.freeze({
  slot: 'example.custom-shaders',
  version: '1.0.0',
});

export function createCustomShadersHelper(library: ShaderLibrary): CustomShadersHelper {
  return Object.freeze({
    summarizeDefaults(): ShaderPackSummary {
      return {
        format: library.defaults.format,
        name: library.defaults.name,
        passes: Object.keys(library.defaults.passes),
      };
    },
    loadFragmentOverride(filename: string, glsl: string): ShaderPack {
      return library.parse(glsl, filename);
    },
    validatePack(candidate: unknown): ShaderValidationResult {
      try {
        const pack = library.validate(candidate);
        return { valid: true, name: pack.name };
      } catch (err) {
        return { valid: false, error: (err as Error).message };
      }
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const library = context.use(VECTOR_SHADERS);
  context.provide(CUSTOM_SHADERS_HELPER, createCustomShadersHelper(library));
}
