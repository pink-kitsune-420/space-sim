import type { LocalCameraFactory, LocalCameraInput, LocalViewCamera } from '@space-sim/game-api';
import { cameraScale, cameraRotation, tuning, type CameraTuning } from './transform';

/** Presentation-only target tracking. No world, entity kind, pilot or device is captured. */
export function createFollowCameras(options: CameraTuning = {}): LocalCameraFactory & { dispose(): void } {
 const settings = tuning(options), cameras = new Set<LocalViewCamera>(); let closed = false;
 return Object.freeze({ create(viewportId: string): LocalViewCamera {
  if (closed) throw new Error('Camera provider disposed');
  if (!viewportId || viewportId.length > 256) throw new Error('Camera needs a viewport identity');
  let targetId: string | undefined, zoom = settings.initialZoom, disposed = false;
  const camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };
  const live = () => { if (disposed) throw new Error('Camera disposed'); };
  const instance: LocalViewCamera = {
   viewportId, get targetId() { return targetId; }, get mode() { return targetId ? 'follow' : 'free'; },
   focus(id) { live(); if (id !== undefined && (!id || id.length > 256)) throw new Error('Invalid camera target'); targetId = id; },
   changeZoom(factor) { live(); if (!Number.isFinite(factor) || factor <= 0) throw new Error('Zoom factor must be positive and finite'); zoom = Math.max(1e-13, Math.min(50, zoom * factor)); },
   frame(input: LocalCameraInput) {
    live(); if (!Number.isFinite(input.elapsed) || input.elapsed < 0 || !Number.isFinite(input.width) || !Number.isFinite(input.height) || input.width <= 0 || input.height <= 0) throw new Error('Camera needs finite elapsed seconds and positive viewport pixels');
    const target = targetId ? input.transform(targetId) : undefined;
    if (target) {
     if (!Number.isFinite(target.position.x) || !Number.isFinite(target.position.y) || !Number.isFinite(target.orientation)) throw new Error('Camera target transform must be finite');
     camera.center.x = target.position.x; camera.center.y = target.position.y;
     camera.rotation = cameraRotation(camera.rotation, target.orientation, input.elapsed, settings);
    }
    camera.scale = cameraScale(input.width, input.height, zoom, settings); return camera;
   },
   dispose() { if (disposed) return; disposed = true; targetId = undefined; cameras.delete(instance); }
  };
  cameras.add(instance); return instance;
 }, dispose() { if (closed) return; closed = true; for (const camera of cameras) camera.dispose(); } });
}
