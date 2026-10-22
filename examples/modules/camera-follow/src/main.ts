import {
  FLIGHT_CAMERAS,
  type Camera,
  type FlightCameraController,
  type FlightCameraFactory,
  type ModuleInitializationV2,
  type ServiceKey,
  type Vec,
} from '@space-sim/game-api';

export interface FlightCameraHelper {
  setupCamera(zoom: number, horizon: boolean): FlightCameraController;
  trackTarget(
    camera: FlightCameraController,
    body: Vec,
    ship: Vec,
    elapsed: number,
    instant: boolean,
    width: number,
    height: number,
  ): Camera;
}

export const FLIGHT_CAMERA_HELPER: ServiceKey<FlightCameraHelper> = Object.freeze({
  slot: 'example.camera-follow',
  version: '1.0.0',
});

export function createFlightCameraHelper(factory: FlightCameraFactory): FlightCameraHelper {
  return Object.freeze({
    setupCamera(zoom: number, horizon: boolean): FlightCameraController {
      const camera = factory.create();
      camera.setZoom(zoom);
      camera.horizon = horizon;
      return camera;
    },
    trackTarget(
      camera: FlightCameraController,
      body: Vec,
      ship: Vec,
      elapsed: number,
      instant: boolean,
      width: number,
      height: number,
    ): Camera {
      return camera.update({
        body,
        ship,
        elapsed,
        instant,
        width,
        height,
      });
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(FLIGHT_CAMERAS);
  context.provide(FLIGHT_CAMERA_HELPER, createFlightCameraHelper(factory));
}

/** Planet framing follows the provider's referenceMetres, including close-up profiles. */
export function frameWholePlanet(camera: FlightCameraController, radiusMetres: number): void {
  camera.planetView(radiusMetres);
}
