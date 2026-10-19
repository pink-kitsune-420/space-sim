/** Default composition adapter: the base camera and optional smart policy are separate owners. */
import type { SmartCandidate, SmartTargetMatch, Vec } from '../../../packages/game-api/src/index';
import { CameraController as BasicCameraController, type CameraTuning } from '../../../modules/camera-follow/src/index';
import { createSmartCamera, findSmartCameraTarget } from '../../../modules/camera-smart/src/index';
export { MIN_ZOOM } from '../../../modules/camera-follow/src/flight';
export type { SmartCandidate, SmartTargetMatch, CameraFocusTarget } from '../../../packages/game-api/src/index';

export class CameraController extends BasicCameraController {
  constructor(options: CameraTuning = {}) { super(options, createSmartCamera<SmartTargetMatch>()); }
}

/** Flight-specific priority/labels stay in the host adapter; policy accepts any object kind. */
export function findSmartThrowTarget(options: {
  readonly currentCenter: Vec; readonly screenVelocity: Vec; readonly cameraRotation: number; readonly scale: number;
  readonly bodies: readonly SmartCandidate[]; readonly ships: readonly SmartCandidate[]; readonly currentFocusId?: string;
}): SmartTargetMatch | undefined {
  const target = findSmartCameraTarget({ ...options, groups: [options.ships, options.bodies] });
  return target ? { kind: target.kind, id: target.id, name: target.name,
    ...(target.kind === 'ship' ? { isPilotedShip: target.isPilotedShip } : {}) } : undefined;
}
