// Temporary composition adapter. Camera/prediction/fleet implementations retain Q13's final position.
import type { FlightGuestPilot, FlightSplitScreenHost } from '../../../packages/game-api/src/index';
import { GuestPilot as PortableGuestPilot, SplitScreen as PortableSplitScreen } from '../../../modules/flight-split/src/index';
import { createLocalPlayerPreferences } from '../../../modules/local-pilots/src/preferences';
import { FLIGHT_PROFILE_CODEC } from '../../../modules/input-profiles/src/index';
import { paneRects, dynamicPaneRects } from '../../../modules/local-views/src/layout';
import { CameraController } from './camera';
import { Prediction } from './prediction';
import { FleetView } from './fleet-view';
import { SessionError } from './session';
export type GuestPilot = FlightGuestPilot;
export const GuestPilot = PortableGuestPilot;
export type SplitScreenHost = Omit<FlightSplitScreenHost, 'isSessionError' | 'primaryCanvas'>;
export class SplitScreen extends PortableSplitScreen {
  constructor(viewport: HTMLElement, host: SplitScreenHost) {
    super(viewport, { ...host, primaryCanvas: () => viewport.querySelector<HTMLCanvasElement>('canvas#flight-view')!, isSessionError: (error): error is Error => error instanceof SessionError }, {
      preferences: createLocalPlayerPreferences(FLIGHT_PROFILE_CODEC), profiles: FLIGHT_PROFILE_CODEC,
      cameras: { create: () => new CameraController() }, predictions: { create: onComplete => new Prediction(onComplete) },
      fleets: { create: () => new FleetView() }, layouts: { paneRects, dynamicPaneRects },
    });
  }
}
