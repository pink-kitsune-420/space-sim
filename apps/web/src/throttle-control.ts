import type { Controls } from '../../../packages/game-api/src/index';

/** Wall-clock ramped input; simulation throttle rates remain zero, independent of warp. */
export class PilotThrottle {
  private world: object | undefined;
  private shipId = '';
  private direction = 0;
  private at: number | undefined;
  private inhibited = false;
  burning = false;
  engine = false;

  bind(world: object, shipId: string): void {
    if (this.world === world && this.shipId === shipId) return;
    this.release(); this.world = world; this.shipId = shipId;
  }

  release(): void {
    this.burning = this.engine = this.inhibited = false;
    this.direction = 0; this.at = undefined;
  }

  set(value: number): void { this.burning = value > 0; this.inhibited = false; }

  /** Cut wins over already-held burn/throttle controls until they return to neutral. */
  cut(held = true): void { this.release(); this.inhibited = held; }

  /** Returns absolute throttle for taps and continuous holds; no simulation-rate input is emitted. */
  update(input: Controls, elapsed: number, current: number, activation: number, pressed = false, firing = false, now?: number): number | undefined {
    // Keydown can land between frames: never charge time from before the press.
    if (now !== undefined && this.at !== undefined) elapsed = Math.min(elapsed, now - this.at);
    this.at = now;
    this.engine = false;
    if (this.inhibited) {
      if (!input.engine && input.throttle === 0) this.inhibited = false;
      return;
    }
    const direction = Math.sign(input.throttle);
    let value: number | undefined;
    if (direction) {
      // A short tap remains useful even between rendered frames. Holds integrate wall time
      // without a repeat delay or percentage quantization; warp never changes the feel.
      const fine = Math.abs(input.throttle) < .5;
      const delta = pressed || direction !== this.direction ? (fine ? .002 : .01)
        : Math.max(0, Math.min(.25, elapsed)) * (fine ? .04 : .2);
      if (delta > 0) {
        const base = this.burning || input.engine || firing ? current : 0;
        value = Math.max(0, Math.min(1, base + direction * delta));
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
