/** Host-only 2D rendering entry point (`packages/render-2d`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); only the browser bridge `packages/modules/src/browser.ts` may. Modules use `@space-sim/game-api` rendering services (`CANVAS_DRAWING`, `WEBGL_DRAWING`, `VECTOR_SHADERS`, `THEMES`, `CORE_THEME`, `createVehicleArtwork`). */
export * from './frame';
export { CanvasRenderer, parallelArcs, drawPlanetHorizon } from './canvas';
export * from './webgl';
export * from './shaders';
export { screenOverlays, overlayRgba, type ScreenOverlay } from './overlay';
export { PlanetPreview } from './planet-preview';
export { STYLE_INDEX, hashWorldSeed } from './appearance';
export * from './theme';
