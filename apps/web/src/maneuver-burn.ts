import type { Vec, VehicleDefaults } from '../../../packages/game-api/src/index';
import { IDLE, STEP } from '../../../packages/sim-core/src/constants';
import { ManeuverBurn as SharedManeuverBurn } from '../../../modules/maneuver-burn/src/index';
/** Explicit clock bridge for compatibility callers until manifest-selected startup. */
export class ManeuverBurn extends SharedManeuverBurn {
 constructor(time: number, delta: Vec, vehicle: VehicleDefaults) { super(time, delta, vehicle, { stepSeconds: STEP, idle: IDLE }); }
}
