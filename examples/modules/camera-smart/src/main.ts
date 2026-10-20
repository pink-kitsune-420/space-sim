import {
  SMART_CAMERAS,
  type SmartCameraCandidate,
  type SmartCameraControl,
  type SmartCameraFactory,
  type SmartCameraSearch,
  type ModuleInitializationV2,
  type ServiceKey,
  type Vec,
} from '@space-sim/game-api';

export interface SmartCameraHelper {
  findCandidate<T extends SmartCameraCandidate>(
    currentCenter: Vec,
    screenVelocity: Vec,
    cameraRotation: number,
    scale: number,
    groups: readonly (readonly T[])[],
  ): T | undefined;
  startGuidance<T extends SmartCameraCandidate>(
    target: T,
    followOnArrival?: boolean,
  ): SmartCameraControl<T>;
}

export const SMART_CAMERA_HELPER: ServiceKey<SmartCameraHelper> = Object.freeze({
  slot: 'example.camera-smart',
  version: '1.0.0',
});

export function createSmartCameraHelper(factory: SmartCameraFactory): SmartCameraHelper {
  return Object.freeze({
    findCandidate<T extends SmartCameraCandidate>(
      currentCenter: Vec,
      screenVelocity: Vec,
      cameraRotation: number,
      scale: number,
      groups: readonly (readonly T[])[],
    ): T | undefined {
      const search: SmartCameraSearch<T> = {
        currentCenter,
        screenVelocity,
        cameraRotation,
        scale,
        groups,
      };
      return factory.select(search);
    },
    startGuidance<T extends SmartCameraCandidate>(
      target: T,
      followOnArrival = false,
    ): SmartCameraControl<T> {
      const camera = factory.create<T>();
      camera.start(target, followOnArrival);
      return camera;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(SMART_CAMERAS);
  context.provide(SMART_CAMERA_HELPER, createSmartCameraHelper(factory));
}
