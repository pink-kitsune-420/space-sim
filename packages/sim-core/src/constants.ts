import type { Controls } from '../../game-api/src/index';

export const STEP = 0.01;
/** Current motion model; Phase 1 changes ownership only. */
export const MODEL = 'm2-two-body-kepler-kdk-v2';
export const READABLE_MODELS: readonly string[] = Object.freeze([MODEL, 'm2-two-body-kepler-kdk-v1']);
export const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
/** Stay on a conic until within one bounded numerical step's reach of contact. */
export function contactMargin(speed: number, dt = STEP): number { return 2 * speed * dt + 1; }
