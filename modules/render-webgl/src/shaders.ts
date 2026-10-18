import type { ShaderPass } from '@space-sim/game-api';
export type { ShaderPack, ShaderPass, ShaderSources } from '@space-sim/game-api';

export const SHADER_FORMAT = 'space-sim-shaders/1';
export const MAX_SHADER_FILE_BYTES = 1024 * 1024;
export const SHADER_PASSES: readonly ShaderPass[] = Object.freeze(['scene', 'vector', 'text'] as const);
/** Stable drawing roles shared with GLSL; palette values live in the default fragments. */
export const ShaderStyle = Object.freeze({
  orbit: 1, path: 2, pad: 3, flame: 4, ship: 5, crashedShip: 6, outline: 7,
  scale: 8, bodyLabel: 9, starLabel: 10, telemetryLabel: 11, fleetShip: 12, foreignShip: 13,
});

export { validateShaderDefinition as validateShaderPack, parseShaderDefinition as parseShaderFile } from '@space-sim/game-api';
