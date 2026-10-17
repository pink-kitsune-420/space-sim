import { bodyFixed, groundVelocity, normalizeAngle, rotate, spinAngle, spinRate, type Body, type State, type Vec } from '../../../packages/sim-core/src/index';
import { interpolateState } from '../../../packages/render-2d/src/index';

/** Past this turn per frame (5°) a spinning body is held still on screen: drawn faithfully
 * it would strobe, wheel-in-a-film style, and drag a horizon camera round with it. */
export const SPIN_HOLD_RADIANS_PER_FRAME = Math.PI / 36;
/** A held body resumes once it turns less than this per frame. */
const SPIN_RESUME_RADIANS_PER_FRAME = SPIN_HOLD_RADIANS_PER_FRAME * 0.6;
/** Seconds to ease a released body from its held angle back to its true angle. */
const RELEASE_SECONDS = 0.4;

/** The angle each rotating body is drawn at. Presentation only: the simulation always uses
 * the true angle. Everything body-fixed (terrain, pads, resting ships) is drawn at this
 * same angle, so a held planet and the ships on it stay together. */
export class SpinView {
  /** Drawn angle minus true angle, per body. */
  private readonly offsets = new Map<string, number>();
  private readonly held = new Set<string>();
  /** Released bodies: the offset at release and the seconds of easing left. */
  private readonly releases = new Map<string, { readonly from: number; left: number }>();
  private lastTime = NaN;

  /** Bodies held still this frame. */
  get holding(): ReadonlySet<string> { return this.held; }

  /** Advance to this frame's presentation time. `instant` skips the release ease (reduced motion). */
  update(bodies: readonly Body[], time: number, elapsed: number, instant: boolean): void {
    const step = time - this.lastTime;
    this.lastTime = time;
    if (!(step >= 0)) { this.offsets.clear(); this.held.clear(); this.releases.clear(); return; } // first frame, reset or rewind
    for (const body of bodies) {
      const omega = spinRate(body);
      if (omega === 0) continue;
      const turn = Math.abs(omega) * step;
      const offset = this.offsets.get(body.id) ?? 0;
      if (turn > SPIN_HOLD_RADIANS_PER_FRAME || (this.held.has(body.id) && turn > SPIN_RESUME_RADIANS_PER_FRAME)) {
        // Keep the drawn angle where it was last frame.
        this.held.add(body.id);
        this.releases.delete(body.id);
        this.offsets.set(body.id, normalizeAngle(offset - omega * step));
      } else {
        if (this.held.delete(body.id)) this.releases.set(body.id, { from: offset, left: RELEASE_SECONDS });
        const release = this.releases.get(body.id);
        if (!release) continue;
        release.left = instant ? 0 : release.left - elapsed;
        // Smoothstep from the held angle to the true one, the short way round.
        const t = Math.max(0, release.left / RELEASE_SECONDS);
        if (t === 0) { this.offsets.delete(body.id); this.releases.delete(body.id); }
        else this.offsets.set(body.id, release.from * t * t * (3 - 2 * t));
      }
    }
  }

  /** The drawn angle of a body's fixed frame at `time`. */
  angle(body: Body, time: number): number {
    return body.rotation ? normalizeAngle(spinAngle(body, time) + (this.offsets.get(body.id) ?? 0)) : 0;
  }

  /** A body-fixed point (terrain, a pad) where it is drawn. */
  point(body: Body, time: number, p: Vec): Vec { return rotate(p, this.angle(body, time)); }

  /** A state in the drawn inertial frame: a resting ship is carried round with its body. */
  state(state: State, body: Body): State {
    if (!bodyFixed(state, body)) return state;
    const angle = this.angle(body, state.time), position = rotate(state.position, angle);
    return { ...state, position, velocity: groundVelocity(spinRate(body), position),
      heading: normalizeAngle(state.heading + angle) };
  }

  /** `interpolateState` between two steps of one ship, in the drawn frame. Steps in the same
   * frame blend there, so a resting ship stays on the ground; liftoff and touchdown blend inertially. */
  interpolate(from: State, to: State, alpha: number, body: Body): State {
    if (bodyFixed(from, body) === bodyFixed(to, body)) return this.state(interpolateState(from, to, alpha), body);
    return interpolateState(this.state(from, body), this.state(to, body), alpha);
  }
}
