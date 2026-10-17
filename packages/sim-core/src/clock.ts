import { STEP } from './constants';

/** Fixed-step scheduler; stalled frames drop excess wall time and report it. */
export class Clock {
  private accumulator = 0;
  droppedSeconds = 0;
  lastSteps = 0;
  reset(): void { this.accumulator = 0; this.lastSteps = 0; }
  /** Elapsed fraction of the next step, for presentation interpolation only. */
  get alpha(): number { return Math.max(0, Math.min(1, this.accumulator / STEP)); }
  advance(seconds: number, tick: () => void, warp = 1, maxSteps = 20): void {
    if (!Number.isFinite(seconds) || seconds < 0) throw new Error('Invalid elapsed time');
    if (!Number.isFinite(warp) || warp < 1) throw new Error('Invalid warp factor');
    const effectiveSeconds = seconds * warp;
    const maxAccepted = warp > 1 ? Math.min(effectiveSeconds, 2.0 * warp) : 0.2;
    const accepted = Math.min(effectiveSeconds, maxAccepted);
    this.droppedSeconds += (effectiveSeconds - accepted) / warp;
    this.accumulator += accepted;
    this.lastSteps = 0;
    const stepLimit = warp > 1 ? Math.max(maxSteps, Math.ceil(warp * 2)) : maxSteps;
    while (this.accumulator + 1e-12 >= STEP && this.lastSteps < stepLimit) {
      tick();
      this.accumulator -= STEP;
      this.lastSteps++;
    }
  }
}
