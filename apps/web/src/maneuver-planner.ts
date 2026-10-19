import '../../../modules/maneuver-editor/assets/editor.css';
import type { ManeuverPlannerOptions } from '../../../packages/game-api/src/index';
import { ManeuverPlanner as SharedPlanner, maneuverWarpFactor as sharedWarpFactor, type ManeuverEditorServices } from '../../../modules/maneuver-editor/src/index';
import { clampWarpFactor } from '../../../packages/sim-core/src/warp';
import { IDLE, STEP } from '../../../packages/sim-core/src/constants';
import { FloatingWindow } from './floating-window';
import { Prediction } from './prediction';
import { ManeuverBurn } from './maneuver-burn';
import type { Workspace } from './workspace';
export { pickManeuverTime } from '../../../modules/maneuver-editor/src/index';
export const maneuverWarpFactor = (remaining: number): number => sharedWarpFactor(remaining, clampWarpFactor);
export class ManeuverPlanner extends SharedPlanner {
 constructor(workspace: Workspace, options: Omit<ManeuverPlannerOptions, 'container' | 'shell' | 'id'>, tools: Pick<ManeuverEditorServices, 'plans' | 'transfers' | 'alarms'> = {}) {
  super({ ...tools, windows: { create: settings => new FloatingWindow(settings) }, predictions: { create: onComplete => new Prediction(onComplete) },
   burns: { create: (time, delta, vehicle) => new ManeuverBurn(time, delta, vehicle) }, clock: { stepSeconds: STEP, idle: IDLE }, motion: { clampWarpFactor } },
   { ...options, container: document.querySelector<HTMLElement>('#flight-console .viewport')!, shell: workspace });
 }
}
