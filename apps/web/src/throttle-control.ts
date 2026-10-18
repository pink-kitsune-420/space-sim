import type { Controls } from '../../../packages/game-api/src/index';

/** Wall-clock stepped input; simulation throttle rates remain zero, independent of warp. */
export class PilotThrottle {
  private world: object | undefined;
  private shipId = '';
  private direction = 0;
  private repeat = 0;
  private inhibited = false;
  burning = false;
  engine = false;

  bind(world: object, shipId: string): void {
    if (this.world === world && this.shipId === shipId) return;
    this.release(); this.world = world; this.shipId = shipId;
  }

  release(): void {
    this.burning = this.engine = this.inhibited = false;
    this.direction = this.repeat = 0;
  }

  set(value: number): void { this.burning = value > 0; this.inhibited = false; }

  /** Cut wins over already-held burn/step controls until they return to neutral. */
  cut(held = true): void { this.release(); this.inhibited = held; }

  /** Returns a new absolute throttle only on a step; no simulation-rate input is emitted. */
  update(input: Controls, elapsed: number, current: number, activation: number, pressed = false, firing = false): number | undefined {
    this.engine = false;
    if (this.inhibited) {
      if (!input.engine && input.throttle === 0) this.inhibited = false;
      return;
    }
    const direction = Math.sign(input.throttle);
    let value: number | undefined;
    if (direction) {
      let steps = 0;
      if (pressed || direction !== this.direction) { steps = 1; this.repeat = .35; }
      else {
        this.repeat -= Math.max(0, Math.min(.25, elapsed));
        while (this.repeat <= 0) { steps++; this.repeat += .1; }
      }
      if (steps) {
        const base = this.burning || input.engine || firing ? current : 0;
        const step = Math.abs(input.throttle) < .5 ? .01 : .05;
        value = Math.max(0, Math.min(1, Math.round((base + direction * step * steps) * 100) / 100));
        this.burning = value > 0;
      }
    } else if (input.engine) {
      // A held burn takes over a lever burn, preserving its existing release-to-stop behavior.
      this.burning = false;
      if (current === 0) value = activation;
    }
    this.direction = direction;
    this.engine = input.engine || this.burning;
    return value;
  }
}
