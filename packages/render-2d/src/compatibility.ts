/** Host-only renderer compatibility ports (`packages/render-2d`): binds legacy sim-core surface query, fallback Primus body, theme and trainer artwork. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); use `Render2DOptions.geometry` (`RenderGeometry.querySurface`), `CORE_THEME`, and `createVehicleArtwork`. */
import { planet } from '../../sim-core/src/index';
import { querySurface } from '../../sim-core/src/surface';
import { legacyTheme } from './theme';
import { trainerArtwork } from '../../../modules/appearance-trainer/src/index';
/** Shared fallback ports for host Canvas and WebGL compatibility renderers (`geometry`, `theme`, `vehicles`, `fallbackBody`). Modules configure renderers via `Render2DOptions`. Host-only (`packages/render-2d`). */
export const legacyRenderPorts = Object.freeze({ geometry: Object.freeze({ querySurface }), theme: legacyTheme, vehicles: trainerArtwork,
  fallbackBody: Object.freeze({ id: planet.id, name: 'PRIMUS', position: Object.freeze({x: 0, y: 0}), radius: planet.radius,
    color: '#233c47', accentColor: '#659497', atmosphereColor: '#29495380', surfaceFeatures: 'globe-lines' as const }) });
