import { FLIGHT_CAMERAS, VIEW_CAMERAS, type FlightCameraController, type ModuleInitializationV2 } from '@space-sim/game-api';
import { CameraController } from './flight';
import { createFollowCameras } from './follow';
import type { CameraTuning } from './transform';
export { createFollowCameras } from './follow';
export { CameraController, findSmartThrowTarget, MIN_ZOOM } from './flight';

/** Explicit flight adapter; generic consumers only need view.camera. */
export function createFlightCameras(options: CameraTuning = {}) {
 const cameras = new Set<FlightCameraController>(); let closed = false;
 return Object.freeze({ create(): FlightCameraController {
  if (closed) throw new Error('Flight camera provider disposed');
  const camera = new CameraController(options), dispose = camera.dispose.bind(camera); let disposed = false;
  camera.dispose = () => { if (disposed) return; disposed = true; cameras.delete(camera); dispose(); };
  cameras.add(camera); return camera;
 }, dispose() { if (closed) return; closed = true; for (const camera of cameras) camera.dispose(); } });
}
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Independent follow cameras', summary: 'Reusable read-only target tracking with an explicit flight focus adapter.', asset: 'docs/creators/usage.json' });
 const options = { initialZoom: context.settings.initialZoom, referenceMetres: context.settings.referenceMetres, orientationSeconds: context.settings.orientationSeconds };
 if (context.selected(VIEW_CAMERAS.slot)) context.provide(VIEW_CAMERAS, context.own(createFollowCameras(options)));
 if (context.selected(FLIGHT_CAMERAS.slot)) context.provide(FLIGHT_CAMERAS, context.own(createFlightCameras(options)));
}
