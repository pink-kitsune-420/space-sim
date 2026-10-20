import { SMART_CAMERAS, type SmartCameraControl, type SmartCameraFactory, type SmartCameraTarget, type ModuleInitializationV2 } from '@space-sim/game-api';
import { createSmartCamera } from './motion';
import { findSmartCameraTarget } from './targeting';
export { createSmartCamera } from './motion';
export { findSmartCameraTarget } from './targeting';

export function createSmartCameras(): SmartCameraFactory & { dispose(): void } {
  const cameras = new Set<SmartCameraControl>(); let disposed = false;
  return Object.freeze({
    select: findSmartCameraTarget,
    create<T extends SmartCameraTarget>() {
      if (disposed) throw new Error('Smart camera provider disposed');
      const camera = createSmartCamera<T>(), close = camera.dispose;
      camera.dispose = () => { cameras.delete(camera); close(); };
      cameras.add(camera); return camera;
    },
    dispose() { if (disposed) return; disposed = true; for (const camera of cameras) camera.dispose(); },
  });
}
/**
 * Contributes smart camera target searching, guided arrival, and focus tracking.
 * Provides view.smart-camera@1.0.0 in the view.smart-camera slot.
 */
export default function initialize(context: ModuleInitializationV2): void {
  context.provide(SMART_CAMERAS, context.own(createSmartCameras()));
  context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Smart camera add-on', summary: 'Optional target search, guided arrival and focus tracking for compatible cameras.', asset: 'docs/creators/usage.json' });
}
