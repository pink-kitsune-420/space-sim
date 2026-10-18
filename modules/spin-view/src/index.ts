import { CORE_ROTATION, SPIN_VIEWS, deterministicMath as dm, interpolateState,
 type Body, type State, type Vec, type RotationMath, type SpinViewControl, type SpinViewFactory, type ModuleInitializationV2 } from '@space-sim/game-api';
export interface SpinViewTuning { readonly holdRadiansPerFrame?: number; readonly resumeRatio?: number; readonly releaseSeconds?: number }

/** Past this turn per frame (5°) a spinning body is held still on screen: drawn faithfully
 * it would strobe, wheel-in-a-film style, and drag a horizon camera round with it. */
export const SPIN_HOLD_RADIANS_PER_FRAME = Math.PI / 36;
/** Resume below this fraction of the hold threshold. */
const RESUME_RATIO = 0.6;
/** Seconds to ease a released body from its held angle back to its true angle. */
const RELEASE_SECONDS = 0.4;

/** The angle each rotating body is drawn at. Presentation only: the simulation always uses
 * the true angle. Everything body-fixed (terrain, pads, resting ships) is drawn at this
 * same angle, so a held planet and the ships on it stay together. */
export class SpinView implements SpinViewControl {
  private disposed = false;
  private readonly holdThreshold: number;
  private readonly resumeThreshold: number;
  private readonly releaseSeconds: number;
  constructor(private readonly rotation: RotationMath, options: SpinViewTuning = {}) {
    this.holdThreshold = options.holdRadiansPerFrame ?? SPIN_HOLD_RADIANS_PER_FRAME;
    const resume = options.resumeRatio ?? RESUME_RATIO; this.releaseSeconds = options.releaseSeconds ?? RELEASE_SECONDS;
    if (!Number.isFinite(this.holdThreshold) || this.holdThreshold < .01 || this.holdThreshold > .5 || !Number.isFinite(resume) || resume < .1 || resume > .9 || !Number.isFinite(this.releaseSeconds) || this.releaseSeconds < 0 || this.releaseSeconds > 2) throw new Error('Invalid spin-view configuration');
    this.resumeThreshold = this.holdThreshold * resume;
  }
  private live(): void { if (this.disposed) throw new Error('Spin view disposed'); }

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
    this.live();
    const step = time - this.lastTime;
    this.lastTime = time;
    if (!(step >= 0)) { this.offsets.clear(); this.held.clear(); this.releases.clear(); return; } // first frame, reset or rewind
    for (const body of bodies) {
      const omega = this.rotation.spinRate(body);
      if (omega === 0) continue;
      const turn = Math.abs(omega) * step;
      const offset = this.offsets.get(body.id) ?? 0;
      if (turn > this.holdThreshold || (this.held.has(body.id) && turn > this.resumeThreshold)) {
        // Keep the drawn angle where it was last frame.
        this.held.add(body.id);
        this.releases.delete(body.id);
        this.offsets.set(body.id, dm.normalizeAngle(offset - omega * step));
      } else {
        if (this.held.delete(body.id)) this.releases.set(body.id, { from: offset, left: this.releaseSeconds });
        const release = this.releases.get(body.id);
        if (!release) continue;
        release.left = instant ? 0 : release.left - elapsed;
        // Smoothstep from the held angle to the true one, the short way round.
        const t = this.releaseSeconds === 0 ? 0 : Math.max(0, release.left / this.releaseSeconds);
        if (t === 0) { this.offsets.delete(body.id); this.releases.delete(body.id); }
        else this.offsets.set(body.id, release.from * t * t * (3 - 2 * t));
      }
    }
  }

  /** The drawn angle of a body's fixed frame at `time`. */
  angle(body: Body, time: number): number {
    this.live();
    return body.rotation ? dm.normalizeAngle(this.rotation.spinAngle(body, time) + (this.offsets.get(body.id) ?? 0)) : 0;
  }

  /** A body-fixed point (terrain, a pad) where it is drawn. */
  point(body: Body, time: number, p: Vec): Vec { return this.rotation.rotate(p, this.angle(body, time)); }

  /** A state in the drawn inertial frame: a resting ship is carried round with its body. */
  state(state: State, body: Body): State {
    this.live();
    if (!this.rotation.bodyFixed(state, body)) return state;
    const angle = this.angle(body, state.time), position = this.rotation.rotate(state.position, angle);
    return { ...state, position, velocity: this.rotation.groundVelocity(this.rotation.spinRate(body), position),
      heading: dm.normalizeAngle(state.heading + angle) };
  }

  /** `interpolateState` between two steps of one ship, in the drawn frame. Steps in the same
   * frame blend there, so a resting ship stays on the ground; liftoff and touchdown blend inertially. */
  interpolate(from: State, to: State, alpha: number, body: Body): State {
    this.live();
    if (this.rotation.bodyFixed(from, body) === this.rotation.bodyFixed(to, body)) return this.state(interpolateState(from, to, alpha), body);
    return interpolateState(this.state(from, body), this.state(to, body), alpha);
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.offsets.clear(); this.held.clear(); this.releases.clear(); this.lastTime = NaN; }

}

export function createSpinViews(rotation: RotationMath, options: SpinViewTuning = {}): SpinViewFactory & { dispose(): void } {
 const views = new Set<SpinViewControl>(); let disposed = false;
 return Object.freeze({ create() {
  if (disposed) throw new Error('Spin view provider disposed');
  const view = new SpinView(rotation, options), close = view.dispose.bind(view); let closed = false;
  view.dispose = () => { if (closed) return; closed = true; views.delete(view); close(); }; views.add(view); return view;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const view of views) { try { view.dispose(); } catch (error) { errors.push(error); } }
  views.clear(); if (errors.length) throw new AggregateError(errors, 'Spin view provider cleanup failed');
 } });
}
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Body spin presentation', summary: 'Optional anti-strobe display over pure prescribed sidereal rotation.', asset: 'docs/creators/usage.json' });
 context.provide(SPIN_VIEWS, context.own(createSpinViews(context.use(CORE_ROTATION), context.settings)));
}
