import { blendAngle } from '@space-sim/game-api';
export interface CameraTuning {
 readonly initialZoom?: number;
 /** World metres framed by the shorter viewport dimension at zoom 1. */
 readonly referenceMetres?: number;
 /** Wall seconds to reach a new orientation; 0 snaps immediately. */
 readonly orientationSeconds?: number;
}
export function tuning(options: CameraTuning = {}): Required<CameraTuning> {
 const value = { initialZoom: options.initialZoom ?? 10, referenceMetres: options.referenceMetres ?? 1500,
  orientationSeconds: options.orientationSeconds ?? .12 };
 if (!Number.isFinite(value.initialZoom) || value.initialZoom < .1 || value.initialZoom > 50
  || !Number.isFinite(value.referenceMetres) || value.referenceMetres < 1 || value.referenceMetres > 1e9
  || !Number.isFinite(value.orientationSeconds) || value.orientationSeconds < 0 || value.orientationSeconds > 2) throw new Error('Invalid camera configuration');
 return Object.freeze(value);
}
export function cameraScale(width: number, height: number, zoom: number, options: Required<CameraTuning>): number {
 return Math.min(width, height) / options.referenceMetres * zoom;
}
export function cameraRotation(current: number, goal: number, elapsed: number, options: Required<CameraTuning>): number {
 return blendAngle(current, goal, options.orientationSeconds === 0 ? 1 : Math.min(1, elapsed / options.orientationSeconds));
}
