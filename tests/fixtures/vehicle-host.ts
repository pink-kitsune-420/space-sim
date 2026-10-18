/** Explicit compatible engine ports for the independent vehicle browser fixture.
 * No app, default game module collection or private renderer wiring is imported. */
export { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
export { engineModuleServices } from '../../packages/sim-core/src/module-services';
export { World } from '../../packages/sim-core/src/world';
export { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
export { saveWorld } from '../../packages/sim-core/src/save';
export { createVehicleArtwork, TRAINER_VEHICLE_ID, KEYBOARD_INPUT, TOUCH_INPUT, GAMEPAD_INPUT,
  FLIGHT_ACTIONS, PLAYER_CONTROLLERS, FLIGHT_SESSIONS, LOCAL_VIEWS, CANVAS_DRAWING, WEBGL_DRAWING, VECTOR_SHADERS } from '../../packages/game-api/src/index';

export { universeSaveFormatService } from '../../packages/game-library/src/universe-save-services';
export { UNIVERSE_SAVES, UNIVERSE_FILES, UNIVERSE_SAVE_CONTROLS } from '../../packages/game-api/src/index';
export { loadWorld } from '../../packages/sim-core/src/save';
