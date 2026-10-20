import { PREDICTIONS, type ModuleInitializationV2, type PredictionFactory, type FlightPrediction } from '@space-sim/game-api';
import type { WorldRead } from '@space-sim/game-api';
import type { Controls, GhostEnd, GhostSample, ResolvedBody, SimulationContext, State, SurfaceProfile } from '@space-sim/game-api';



export interface PredictionTuning { readonly maxMs?: number; readonly traceSamplesPerSecond?: number; readonly numericalSamplesPerSecond?: number }

// Ghost prediction lifecycle
const TRACE_SAMPLES_PER_SECOND = 1000;
const MIN_PREFIX = 4;
export const PREDICTION_MAX_SAMPLES = 32768;
interface Pass { readonly job: Generator<GhostSample, GhostEnd>; readonly samples: GhostSample[];
  readonly context: { dispose(): void }; readonly coarse: boolean; budget: number; workMs: number }
/** Progressive preview owns its job and isolated motion context, including cancellation. */
export class Prediction {
  pass: Pass | undefined;
  passKey = '';
  pathKey = '';
  passCount = 0;
  path: readonly GhostSample[] = [];
  pathEnd: GhostEnd = 'grounded';
  lastPass = { end: 'grounded' as GhostEnd, samples: 0, workMs: 0, coarse: false };
  /** Tracing budget per frame; split-screen guests share the frame with player 1. */
  maxMs = 3;

  private owner?: SimulationContext;
  private disposed = false;
  private world?: WorldRead;
  private lastTime = -Infinity;
  private lastState?: State;
  private readonly buffers: [GhostSample[], GhostSample[]] = [[], []];
  private nextBuffer = 0;
  private readonly tuning: Required<PredictionTuning>;
  constructor(private readonly onComplete: (pass: { end: GhostEnd; samples: number; workMs: number; coarse: boolean }) => void, options: PredictionTuning = {}) {
    this.tuning = { maxMs: options.maxMs ?? 3, traceSamplesPerSecond: options.traceSamplesPerSecond ?? TRACE_SAMPLES_PER_SECOND, numericalSamplesPerSecond: options.numericalSamplesPerSecond ?? 12000 };
    const { maxMs, traceSamplesPerSecond, numericalSamplesPerSecond } = this.tuning;
    if (!Number.isFinite(maxMs) || maxMs < .1 || maxMs > 16 || !Number.isFinite(traceSamplesPerSecond) || traceSamplesPerSecond < 1 || traceSamplesPerSecond > 1000 || !Number.isFinite(numericalSamplesPerSecond) || numericalSamplesPerSecond < 120 || numericalSamplesPerSecond > 24000) throw new Error('Invalid prediction work budget');
    this.maxMs = maxMs;
  }
  private cancel(): void {
    const pass = this.pass; this.pass = undefined;
    if (!pass) return; const errors: unknown[] = [];
    try { pass.job.return('open'); } catch (error) { errors.push(error); }
    try { pass.context.dispose(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'Prediction job cleanup failed');
  }
  invalidate(): void {
    try { this.cancel(); } finally {
      this.buffers[0].length = 0; this.buffers[1].length = 0;
      this.owner = undefined; this.world = undefined; this.lastTime = -Infinity; this.lastState = undefined; this.passKey = ''; this.pathKey = ''; this.path = []; this.pathEnd = 'grounded';
    }
  }
  update(context: SimulationContext, state: State, activeBody: ResolvedBody, surface: SurfaceProfile | undefined,
      selectedShipId: string | undefined, seconds: number, engine: boolean, controls?: Controls, world?: WorldRead): void {
    if (this.disposed) throw new Error('Prediction disposed');
    if (!selectedShipId) { this.invalidate(); return; }
    const numerical = !!world?.requiresWorldPrediction || !context.capabilities.analyticCoast;
    const changing = engine || !!controls?.turn || !!controls?.throttle;
    // Ordinary idle steps advance time and revision together. Commands that change
    // revision, or held controls, invalidate a numerical preview; passive motion can
    // finish a budgeted job instead of restarting it on every rendered frame.
    const epoch = world?.requiresWorldPrediction ? world.version - world.tick : numerical ? changing ? state.revision : state.revision - Math.round(state.time / context.stepSeconds)
      : engine ? state.revision : (state.coast?.revision ?? state.revision - Math.round(state.time / context.stepSeconds));
    const key = `${context.modelIdentity}/${selectedShipId}/${state.status}/${engine}/${activeBody.id}/${activeBody.surfaceIdentity}/${surface?.identity ?? 'circle'}/${epoch}`;
    const previous = this.lastState;
    const replaced = previous && previous.time === state.time && (previous.position.x !== state.position.x
      || previous.position.y !== state.position.y || previous.velocity.x !== state.velocity.x || previous.velocity.y !== state.velocity.y);
    const expired = !this.pass && (this.pathEnd === 'open' || this.pathEnd === 'horizon' || this.pathEnd === 'escape') && (this.path.at(-1)?.time ?? Infinity) <= state.time;
    if (context !== this.owner || world !== this.world || replaced || state.time < this.lastTime || key !== this.passKey || (engine && !this.pass) || expired) {
      this.cancel();
      this.owner = context; this.world = world;
      // Never draw an old burn/body/status trajectory while tracing a replacement.
      this.path = []; this.pathKey = ''; this.pathEnd = 'grounded';
      this.passKey = key; this.passCount++;
      const clone = world ? { dispose() {} } : context.cloneForPrediction();
      let job: Generator<GhostSample, GhostEnd>;
      try { job = world ? world.predictShip(selectedShipId, engine)
        : (clone as SimulationContext).predict(structuredClone(state), engine, activeBody, surface); }
      catch (error) { this.invalidate(); try { clone.dispose(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Prediction creation failed'); } throw error; }
      const samples = this.buffers[this.nextBuffer]!; this.nextBuffer ^= 1; samples.length = 0;
      this.pass = { context: clone, job, samples, coarse: engine,
        budget: 128, workMs: 0 };
    }
    this.lastTime = state.time; this.lastState = state;
    if (!this.pass) return;
    this.pass.budget = Math.min(256, Math.max(128, this.pass.budget) + (surface || numerical ? this.tuning.numericalSamplesPerSecond : this.tuning.traceSamplesPerSecond) * seconds);
    const begin = performance.now();
    let end: GhostEnd | undefined;
    while (this.pass.budget >= 1 && performance.now() - begin < this.maxMs) {
      let result: IteratorResult<GhostSample, GhostEnd>;
      try { result = this.pass.job.next(); }
      catch (error) { try { this.invalidate(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'Prediction failed'); } throw error; }
      if (result.done) { end = result.value; break; }
      this.pass.samples.push(result.value); this.pass.budget--;
      if (this.pass.samples.length >= PREDICTION_MAX_SAMPLES) { end = 'open'; break; }
    }
    this.pass.workMs += performance.now() - begin;
    if (end !== undefined) {
      this.path = this.pass.samples; this.pathEnd = end; this.pathKey = this.passKey;
      this.lastPass = { end, samples: this.pass.samples.length, workMs: +this.pass.workMs.toFixed(3), coarse: this.pass.coarse };
      try { this.onComplete(this.lastPass); } finally { this.cancel(); }
    } else if (this.passKey !== this.pathKey && this.pass.samples.length >= MIN_PREFIX) {
      this.path = this.pass.samples;
    }
  }

  text(state: State): string {
    if (this.pass && this.passKey !== this.pathKey) return `Tracing · ${this.pass.samples.length} points`;
    const first = this.path[0], last = this.path.at(-1);
    if (this.pathEnd === 'closed' && first && last) return `Full orbit · period ${(last.time - first.time).toFixed(1)} s`;
    if (this.pathEnd === 'impact' && last) return `${last.contactMaterial === 'water' ? 'Heavy water impact' : 'Surface contact'} in ${Math.max(0, last.time - state.time).toFixed(1)} s`;
    if (this.pathEnd === 'floating' && last) return `Float in ${Math.max(0, last.time - state.time).toFixed(1)} s`;
    return { escape: 'Escape · preview distance horizon', horizon: 'Preview time horizon reached', open: 'Partial path · work limit reached', failed: 'Unavailable', closed: '—', impact: '—', grounded: '—', floating: '—' }[this.pathEnd];
  }

  dispose(): void { if (this.disposed) return; try { this.invalidate(); } finally { this.disposed = true; } }

}

export function createPredictions(options: PredictionTuning = {}): PredictionFactory & { dispose(): void } {
 const instances = new Set<FlightPrediction>(); let disposed = false;
 return Object.freeze({ create(onComplete: Parameters<PredictionFactory['create']>[0]) {
  if (disposed) throw new Error('Prediction provider disposed');
  const prediction = new Prediction(onComplete, options), close = prediction.dispose.bind(prediction); let closed = false;
  prediction.dispose = () => { if (closed) return; closed = true; instances.delete(prediction); close(); };
  instances.add(prediction); return prediction;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const prediction of instances) { try { prediction.dispose(); } catch (error) { errors.push(error); } }
  instances.clear(); if (errors.length) throw new AggregateError(errors, 'Prediction provider cleanup failed');
 } });
}
/** Provides PREDICTIONS (view.prediction@1.0.0) tuned by this module's settings. The factory
 * is owned by the candidate, so replacing or removing the module disposes every preview. */
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Progressive flight prediction', summary: 'Cancellable trajectory previews that a view can trace a little at a time without touching live flight.', asset: 'docs/creators/usage.json' });
 context.provide(PREDICTIONS, context.own(createPredictions(context.settings)));
}
