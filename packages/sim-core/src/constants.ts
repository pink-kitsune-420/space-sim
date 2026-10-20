/** Host-only simulation constants (`packages/sim-core`). Modules access these values through `@space-sim/game-api` `CORE_CLOCK` (`ClockService.stepSeconds`, `idle`, `model`) and `SimulationContext`. */
import type { Controls } from '../../game-api/src/index';

/** Fixed authoritative simulation step duration (`0.01` s, 100 Hz) in IEEE-754 float64 simulation seconds; exposed to modules via `CORE_CLOCK` (`ClockService.stepSeconds`) and `SimulationContext.stepSeconds`. Host-only (`packages/sim-core`). */
export const STEP = 0.01;
/** Current motion model; Phase 1 changes ownership only. Exposed to modules via `CORE_CLOCK` (`ClockService.model`). Host-only (`packages/sim-core`). */
export const MODEL = 'm2-two-body-kepler-kdk-v2';
/** Frozen list of motion model identifiers accepted when loading saved worlds via `CORE_SAVE`. Host-only (`packages/sim-core`). */
export const READABLE_MODELS: readonly string[] = Object.freeze([MODEL, 'm2-two-body-kepler-kdk-v1']);
/** Frozen neutral pilot control state (`turn: 0`, `throttle: 0`, `engine: false`) shared across zero-allocation hot paths; exposed to modules via `CORE_CLOCK` (`ClockService.idle`). Host-only (`packages/sim-core`). */
export const IDLE: Controls = Object.freeze({ turn: 0, throttle: 0, engine: false });
/** Stay on a conic until within one bounded numerical step's reach of contact (`speed` in `m/s`, `dt` in `s`; returns radial clearance margin in `m`). Host-only (`packages/sim-core`). */
export function contactMargin(speed: number, dt = STEP): number { return 2 * speed * dt + 1; }
