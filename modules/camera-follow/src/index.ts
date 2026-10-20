import { FLIGHT_CAMERAS, VIEW_CAMERAS, SMART_CAMERAS, type SmartCameraFactory, type FlightCameraController, type ModuleInitializationV2 } from '@space-sim/game-api';
import { CameraController } from './flight';
import { createFollowCameras } from './follow';
import type { CameraTuning } from './transform';
export { createFollowCameras } from './follow';
export { CameraController, MIN_ZOOM } from './flight';
export type { CameraTuning } from './transform';

/** Explicit flight adapter; generic consumers only need view.camera. */
export function createFlightCameras(options: CameraTuning = {}, smart?: SmartCameraFactory) {
 const cameras = new Set<FlightCameraController>(); let closed = false;
 return Object.freeze({ create(): FlightCameraController {
  if (closed) throw new Error('Flight camera provider disposed');
  const camera = new CameraController(options, smart?.create()), dispose = camera.dispose.bind(camera); let disposed = false;
  camera.dispose = () => { if (disposed) return; disposed = true; cameras.delete(camera); dispose(); };
  cameras.add(camera); return camera;
 }, dispose() { if (closed) return; closed = true; for (const camera of cameras) camera.dispose(); } });
}
/**
 * Contributes independent follow cameras and explicit flight camera adapters.
 * Provides view.camera@1.0.0 and view.flight-camera@1.0.0; optionally consumes view.smart-camera@1.0.0.
 */
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Independent follow cameras', summary: 'Reusable basic camera control with an explicit flight adapter and optional smart-camera policy.', asset: 'docs/creators/usage.json' });
 const options = { initialZoom: context.settings.initialZoom, referenceMetres: context.settings.referenceMetres, orientationSeconds: context.settings.orientationSeconds };
 if (context.selected(VIEW_CAMERAS.slot)) context.provide(VIEW_CAMERAS, context.own(createFollowCameras(options)));
 if (context.selected(FLIGHT_CAMERAS.slot)) context.provide(FLIGHT_CAMERAS, context.own(createFlightCameras(options, context.tryUse(SMART_CAMERAS))));
}
