/** Built-in adapters. The runtime never imports these implementations. */
import type { MotionServices, OrbitalProvider } from '../../game-api/src/index';
import { elements, propagate, timeToRadius } from './orbit';
import { loadSystem } from './universe';
import { generateSurface, querySurface, surfaceIdentity } from './surface';
import { sweepSurface, sweepGroundSurface } from './surface-contact';
import { surfaceSupport, validateMotionSurface } from './surface-flight';
import { soiHorizon } from './rails';

export const BUILTIN_ORBITS: OrbitalProvider = Object.freeze({ id: 'builtin.orbits', version: '0.1.0',
  modelIdentity: 'two-body/v1', analytic: true, elements, propagate, timeToRadius });
export const BUILTIN_SERVICES: MotionServices = Object.freeze({
  orbits: BUILTIN_ORBITS,
  bodies: Object.freeze({ id: 'builtin.bodies', version: '0.1.0', modelIdentity: 'circular-frames-soi/v1', load: loadSystem }),
  surfaces: Object.freeze({ id: 'builtin.surfaces', version: '0.1.0', modelIdentity: 'radial-contact/v1',
    generate: generateSurface, query: querySurface, identity: surfaceIdentity, support: surfaceSupport,
    validate: validateMotionSurface, sweep: sweepSurface, sweepGround: sweepGroundSurface }),
  rails: Object.freeze({ id: 'builtin.rails', version: '0.1.0', modelIdentity: 'conservative-two-body/v1',
    compatible: Object.freeze([Object.freeze({ dynamics: 'builtin.kdk/v1', orbits: 'two-body/v1',
      bodies: 'circular-frames-soi/v1', surfaces: 'radial-contact/v1' })]), horizon: soiHorizon }),
});
