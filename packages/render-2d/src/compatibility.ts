import { planet } from '../../sim-core/src/index';
import { querySurface } from '../../sim-core/src/surface';
import { legacyTheme } from './theme';
import { trainerArtwork } from '../../../modules/appearance-trainer/src/index';
export const legacyRenderPorts = Object.freeze({ geometry: Object.freeze({ querySurface }), theme: legacyTheme, vehicles: trainerArtwork,
  fallbackBody: Object.freeze({ id: planet.id, name: 'PRIMUS', position: Object.freeze({x: 0, y: 0}), radius: planet.radius,
    color: '#233c47', accentColor: '#659497', atmosphereColor: '#29495380', surfaceFeatures: 'globe-lines' as const }) });
