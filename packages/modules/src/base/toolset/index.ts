/** The flight information toolset: part of the default game, written against the public API
 * only, so each instrument is an ordinary presentation module. They are enabled by the
 * default presentation profile and each viewer can switch any of them off. */
import type { RegisteredModule } from '../../../../game-api/src/index';
import { flightData } from './flight-data';
import { flightVectors } from './flight-vectors';
import { orbitMarkers } from './orbit-markers';
import { telemetry } from './telemetry';
import { maneuverPlanner } from '../../../../../modules/maneuver-display/src/overlay';
export type { FlightData, FlightDataApi, OrbitData } from './flight-data';

export const TOOLSET_MODULES: readonly RegisteredModule[] = Object.freeze([flightData, flightVectors, orbitMarkers, telemetry, maneuverPlanner]);
/** The console's instrument switches, in display order. Each enables what it depends on. */
export const INSTRUMENTS: readonly { readonly id: string; readonly label: string; readonly title: string }[] = Object.freeze([
  { id: 'builtin.maneuver-planner', label: 'Maneuver planner', title: 'Click the coast trajectory to plan a burn and preview its orbit' },
  { id: 'builtin.flight-vectors', label: 'Velocity', title: 'The velocity (prograde) vector at the ship, with its speed' },
  { id: 'builtin.orbit-markers', label: 'Orbit markers', title: 'Periapsis and apoapsis on the orbit, with altitude and time to go' },
  { id: 'builtin.telemetry', label: 'Telemetry', title: 'Speed components, gravity, energy and orbit timing' },
  { id: 'builtin.navball', label: 'Navball', title: 'Attitude against the local horizon, with prograde, radial markers and pitch' },
]);
