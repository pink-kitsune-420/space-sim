import { deterministicMath as dm, type Controls, type State, type Vec, type VehicleDefaults } from '../../../packages/game-api/src/index';
import { IDLE, STEP } from '../../../packages/sim-core/src/constants';

/** Finite burn in the body's inertial frame. Called once before each fixed physics tick
 * at 1×. Integrates commanded engine impulse only after observing that tick advance;
 * gravity is never counted as delivered Δv. The last tick uses fractional throttle.
 * The owner must validate continuity and cancel on external trajectory changes. */
export class ManeuverBurn {
  phase: 'aligning' | 'waiting' | 'burning' | 'complete' = 'aligning';
  private deliveredX = 0;
  private deliveredY = 0;
  private compensationX = 0;
  private compensationY = 0;
  private pending?: { time: number; x: number; y: number };
  readonly start: number;

  constructor(readonly time: number, readonly delta: Vec, private readonly vehicle: VehicleDefaults) {
    const magnitude = dm.hypot(delta.x, delta.y);
    if (!Number.isFinite(time) || !Number.isFinite(magnitude) || magnitude <= 0 || !(vehicle.acceleration > 0)) {
      throw new Error('A burn needs a finite time, nonzero Δv and engine thrust.');
    }
    this.start = time - magnitude / vehicle.acceleration / 2;
  }

  get remaining(): number { return dm.hypot(this.delta.x - this.deliveredX, this.delta.y - this.deliveredY); }

  next(state: State): { controls: Controls; throttle?: number } {
    if (this.pending) {
      if (Math.abs(state.time - this.pending.time - STEP) > 1e-7) throw new Error('Burn clock changed. Replan the maneuver.');
      // Compensated sums keep small remaining vectors reliable even after hours of thrust.
      const x = this.pending.x - this.compensationX, y = this.pending.y - this.compensationY;
      const sumX = this.deliveredX + x, sumY = this.deliveredY + y;
      this.compensationX = (sumX - this.deliveredX) - x; this.compensationY = (sumY - this.deliveredY) - y;
      this.deliveredX = sumX; this.deliveredY = sumY; this.pending = undefined;
    }
    const x = this.delta.x - this.deliveredX, y = this.delta.y - this.deliveredY, remaining = dm.hypot(x, y);
    if (remaining <= 1e-8) { this.phase = 'complete'; return { controls: IDLE, throttle: 0 }; }
    const error = dm.normalizeAngle(dm.atan2(y, x) - state.heading);
    const turn = this.vehicle.turnRate > 0 ? Math.max(-1, Math.min(1, error / (this.vehicle.turnRate * STEP))) : 0;
    const aligned = Math.abs(error) < 1e-7;
    if (!aligned && this.vehicle.turnRate <= 0) throw new Error('No steering available. Align manually and replan.');
    if (state.time < this.start - STEP / 2) {
      this.phase = aligned ? 'waiting' : 'aligning';
      return { controls: { turn, throttle: 0, engine: false } };
    }
    if (!aligned) throw new Error('Could not align before burn start. Replan with more lead time.');
    this.phase = 'burning';
    const throttle = Math.min(1, remaining / (this.vehicle.acceleration * STEP));
    const impulse = this.vehicle.acceleration * throttle * STEP;
    this.pending = { time: state.time, x: dm.cos(state.heading) * impulse, y: dm.sin(state.heading) * impulse };
    return { controls: { turn: 0, throttle: 0, engine: true }, throttle };
  }
}
