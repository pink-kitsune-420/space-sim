import type { Vec } from './state';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';

/** Viewer identities only: targets may be vehicles, celestial bodies or any other object. */
export interface SmartCameraTarget { readonly id: string; readonly name: string }
/** Candidate target with world-metre position for smart camera targeting searches. */
export interface SmartCameraCandidate extends SmartCameraTarget { readonly position: Vec }
/** Search criteria describing camera center, drag velocity, rotation and priority candidate groups. */
export interface SmartCameraSearch<T extends SmartCameraCandidate> {
  readonly currentCenter: Vec;
  /** Drag-release velocity in CSS pixels per wall second. */
  readonly screenVelocity: Vec;
  readonly cameraRotation: number;
  /** CSS pixels per world metre. Groups are searched in priority order. */
  readonly scale: number;
  readonly groups: readonly (readonly T[])[];
  readonly currentFocusId?: string;
}
/** Presentation frame describing world-metre camera origin, target position, pan and elapsed wall time. */
export interface SmartCameraFrame {
  /** Frame origin and target position in the same world-metre coordinate system. */
  readonly origin: Vec;
  readonly targetPosition?: Vec;
  /** Camera displacement from origin, and world metres per wall second. */
  readonly pan: Vec;
  readonly velocity: Vec;
  readonly scale: number;
  readonly elapsed: number;
  readonly instant: boolean;
}
/** Borrowed storage, reused on the next update; follow requests the base camera's own follow mode. */
export interface SmartCameraStep { readonly pan: Vec; readonly velocity: Vec; readonly follow: boolean }
/** Per-view smart camera guidance controller tracking and guiding toward candidate targets. */
export interface SmartCameraControl<T extends SmartCameraTarget = SmartCameraTarget> extends Disposable {
  target: T | undefined;
  focus: T | undefined;
  start(target: T, followOnArrival?: boolean): void;
  /** Stop guided movement while retaining an already acquired focus. */
  stop(): void;
  clear(): void;
  /** Undefined means ordinary base-camera movement; a missing target releases focus. */
  update(frame: SmartCameraFrame): SmartCameraStep | undefined;
}
/** Optional policy: owns targeting and guidance, never a renderer, world step or device. */
export interface SmartCameraFactory {
  create<T extends SmartCameraTarget>(): SmartCameraControl<T>;
  select<T extends SmartCameraCandidate>(search: SmartCameraSearch<T>): T | undefined;
}
/** Service key for the smart camera add-on factory (`view.smart-camera@1.0.0`). */
export const SMART_CAMERAS: ServiceKey<SmartCameraFactory> = Object.freeze({ slot: 'view.smart-camera', version: '1.0.0' });
