import { flightTimeTolerance, deterministicMath as dm, type Controls, type State, type Vec, type VehicleDefaults } from '@space-sim/game-api';
import { CORE_CLOCK, MANEUVER_BURNS, type ClockService, type ManeuverBurnControl, type ManeuverBurnFactory, type ModuleInitializationV2 } from '@space-sim/game-api';

/** Finite burn in the body's inertial frame. Called once before each fixed physics tick
 * at 1×. Integrates commanded engine impulse only after observing that tick advance;
 * gravity is never counted as delivered Δv. The last tick uses fractional throttle.
 * The owner must validate continuity and cancel on external trajectory changes. */
export class ManeuverBurn implements ManeuverBurnControl {
  private disposed = false;
  phase: 'aligning' | 'waiting' | 'burning' | 'complete' = 'aligning';
  private deliveredX = 0;
  private deliveredY = 0;
  private compensationX = 0;
  private compensationY = 0;
  private pending?: { time: number; x: number; y: number };
  readonly start: number;

  constructor(readonly time: number, readonly delta: Vec, private readonly vehicle: VehicleDefaults, private readonly clock: Pick<ClockService, 'stepSeconds' | 'idle'>) {
    if (clock.stepSeconds !== .01 || clock.idle.engine || clock.idle.turn !== 0 || clock.idle.throttle !== 0) throw new Error('A burn requires the compatible fixed clock');
    const magnitude = dm.hypot(delta.x, delta.y);
    if (!Number.isFinite(time) || !Number.isFinite(magnitude) || magnitude <= 0 || !(vehicle.acceleration > 0)) {
      throw new Error('A burn needs a finite time, nonzero Δv and engine thrust.');
    }
    this.start = time - magnitude / vehicle.acceleration / 2;
  }

  get remaining(): number { return dm.hypot(this.delta.x - this.deliveredX, this.delta.y - this.deliveredY); }

  next(state: State): { controls: Controls; throttle?: number } {
    if (this.disposed) throw new Error('Maneuver burn disposed');
    if (this.pending) {
      if (Math.abs(state.time - this.pending.time - this.clock.stepSeconds) > flightTimeTolerance(state.time)) throw new Error('Burn clock changed. Replan the maneuver.');
      // Compensated sums keep small remaining vectors reliable even after hours of thrust.
      const x = this.pending.x - this.compensationX, y = this.pending.y - this.compensationY;
      const sumX = this.deliveredX + x, sumY = this.deliveredY + y;
      this.compensationX = (sumX - this.deliveredX) - x; this.compensationY = (sumY - this.deliveredY) - y;
      this.deliveredX = sumX; this.deliveredY = sumY; this.pending = undefined;
    }
    const x = this.delta.x - this.deliveredX, y = this.delta.y - this.deliveredY, remaining = dm.hypot(x, y);
    if (remaining <= 1e-8) { this.phase = 'complete'; return { controls: this.clock.idle, throttle: 0 }; }
    const error = dm.normalizeAngle(dm.atan2(y, x) - state.heading);
    const turn = this.vehicle.turnRate > 0 ? Math.max(-1, Math.min(1, error / (this.vehicle.turnRate * this.clock.stepSeconds))) : 0;
    const aligned = Math.abs(error) < 1e-7;
    if (!aligned && this.vehicle.turnRate <= 0) throw new Error('No steering available. Align manually and replan.');
    if (state.time + this.clock.stepSeconds <= this.start + flightTimeTolerance(state.time)) {
      this.phase = aligned ? 'waiting' : 'aligning';
      return { controls: { turn, throttle: 0, engine: false } };
    }
    if (!aligned) throw new Error('Could not align before burn start. Replan with more lead time.');
    this.phase = 'burning';
    // Integrate the overlap with the first tick as well as the last. This makes
    // centred finite burns continuous as their planned time crosses a tick boundary.
    const active = Math.min(this.clock.stepSeconds, Math.max(0, state.time + this.clock.stepSeconds - this.start));
    const throttle = Math.min(active / this.clock.stepSeconds, remaining / (this.vehicle.acceleration * this.clock.stepSeconds));
    const impulse = this.vehicle.acceleration * throttle * this.clock.stepSeconds;
    this.pending = { time: state.time, x: dm.cos(state.heading) * impulse, y: dm.sin(state.heading) * impulse };
    return { controls: { turn: 0, throttle: 0, engine: true }, throttle };
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.pending = undefined; }

}

export function createManeuverBurns(clock: Pick<ClockService, 'stepSeconds' | 'idle'>): ManeuverBurnFactory & { dispose(): void } {
 const instances = new Set<ManeuverBurn>(); let disposed = false;
 return Object.freeze({ create(time: number, delta: Vec, vehicle: VehicleDefaults) {
  if (disposed) throw new Error('Maneuver burn provider disposed');
  const burn = new ManeuverBurn(time, delta, vehicle, clock), close = burn.dispose.bind(burn), next = burn.next.bind(burn); let closed = false;
  burn.dispose = () => { if (closed) return; closed = true; instances.delete(burn); close(); };
  burn.next = state => { const command = next(state); if (burn.phase === 'complete') instances.delete(burn); return command; };
  instances.add(burn); return burn;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const burn of instances) { try { burn.dispose(); } catch (error) { errors.push(error); } }
  instances.clear(); if (errors.length) throw new AggregateError(errors, 'Maneuver burn cleanup failed');
 } });
}
/**
 * Contributes the finite maneuver burn factory.
 * Provides flight.maneuver-burn@1.0.0 in slot flight.maneuver-burn; requires core.clock@^1.0.0.
 */
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Finite maneuver burns', summary: 'Validated fixed-tick intent with compensated impulse accounting; the host owns commands and stepping.', asset: 'docs/creators/usage.json' });
 context.provide(MANEUVER_BURNS, context.own(createManeuverBurns(context.use(CORE_CLOCK))));
}
