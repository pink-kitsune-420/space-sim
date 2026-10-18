import type { Controls } from '../../../packages/game-api/src/index';

/** Wall-clock ramped input; simulation throttle rates remain zero, independent of warp. */
export class PilotThrottle {
  private world: object | undefined;
  private shipId = '';
  private direction = 0;
  private held = 0;
  private fine = false;
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
    this.direction = this.held = 0; this.fine = false; this.at = undefined;
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
    if (!direction) this.held = 0;
    if (direction) {
      // A short tap remains useful even between rendered frames. Holds integrate wall time
      // without a repeat delay or percentage quantization; warp never changes the feel.
      const fine = Math.abs(input.throttle) < .5;
      const fresh = pressed || direction !== this.direction;
      if (fresh || fine !== this.fine) this.held = 0;
      this.fine = fine;
      let delta: number;
      if (fresh) delta = fine ? .002 : .01;
      else {
        const dt = Math.max(0, Math.min(.25, elapsed));
        // Rise from 1× to 1.5× over two wall seconds. Integrating the average
        // multiplier keeps the acceleration equal across frame rates, including the cap.
        const growing = Math.min(dt, 2 - this.held);
        const average = 1 + (this.held + growing / 2) / 4;
        this.held += growing;
        delta = (fine ? .04 : .2) * (growing * average + (dt - growing) * 1.5);
      }
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
