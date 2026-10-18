import type { WorldRead } from '../../../packages/game-api/src/index';
import type { Controls, GhostEnd, GhostSample, ResolvedBody, SimulationContext, State, SurfaceProfile } from '../../../packages/game-api/src/index';



// Ghost prediction lifecycle
const TRACE_SAMPLES_PER_SECOND = 120;
const MIN_PREFIX = 4;
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
  constructor(private readonly onComplete: (pass: { end: GhostEnd; samples: number; workMs: number; coarse: boolean }) => void) {}
  private cancel(): void {
    this.pass?.job.return('open');
    this.pass?.context.dispose();
    this.pass = undefined;
  }
  invalidate(): void {
    this.cancel(); this.owner = undefined;
    this.passKey = ''; this.pathKey = ''; this.path = []; this.pathEnd = 'grounded';
  }
  update(context: SimulationContext, state: State, activeBody: ResolvedBody, surface: SurfaceProfile | undefined,
      selectedShipId: string | undefined, seconds: number, engine: boolean, controls?: Controls, world?: WorldRead): void {
    if (!selectedShipId) { this.invalidate(); return; }
    const numerical = !!world?.requiresWorldPrediction || !context.capabilities.analyticCoast;
    const changing = engine || !!controls?.turn || !!controls?.throttle;
    // Ordinary idle steps advance time and revision together. Commands that change
    // revision, or held controls, invalidate a numerical preview; passive motion can
    // finish a budgeted job instead of restarting it on every rendered frame.
    const epoch = world?.requiresWorldPrediction ? world.version - world.tick : numerical ? changing ? state.revision : state.revision - Math.round(state.time / context.stepSeconds)
      : engine ? 'burn' : (state.coast?.revision ?? 'coast');
    const key = `${context.modelIdentity}/${selectedShipId}/${state.status}/${engine}/${activeBody.id}/${activeBody.surfaceIdentity}/${surface?.identity ?? 'circle'}/${epoch}`;
    const expired = !this.pass && this.pathEnd === 'open' && (this.path.at(-1)?.time ?? Infinity) <= state.time;
    if (context !== this.owner || key !== this.passKey || (engine && !this.pass) || expired) {
      this.cancel();
      this.owner = context;
      // Never draw an old burn/body/status trajectory while tracing a replacement.
      this.path = []; this.pathKey = ''; this.pathEnd = 'grounded';
      this.passKey = key; this.passCount++;
      const clone = world?.requiresWorldPrediction ? { dispose() {} } : context.cloneForPrediction();
      const job = world?.requiresWorldPrediction ? world.predictShip(selectedShipId)
        : (clone as SimulationContext).predict(structuredClone(state), engine, activeBody, surface);
      this.pass = { context: clone, job, samples: [], coarse: engine,
        budget: surface || numerical ? 64 : MIN_PREFIX, workMs: 0 };
    }
    if (!this.pass) return;
    this.pass.budget = Math.min(256, this.pass.budget + (surface || numerical ? 12000 : TRACE_SAMPLES_PER_SECOND) * seconds);
    const begin = performance.now();
    let end: GhostEnd | undefined;
    while (this.pass.budget >= 1 && performance.now() - begin < this.maxMs) {
      const result = this.pass.job.next();
      if (result.done) { end = result.value; break; }
      this.pass.samples.push(result.value); this.pass.budget--;
    }
    this.pass.workMs += performance.now() - begin;
    if (end !== undefined) {
      this.path = this.pass.samples; this.pathEnd = end; this.pathKey = this.passKey;
      this.lastPass = { end, samples: this.pass.samples.length, workMs: +this.pass.workMs.toFixed(3), coarse: this.pass.coarse };
      this.onComplete(this.lastPass);
      this.cancel();
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
    return { escape: 'Escape trajectory', open: 'Partial path', failed: 'Unavailable', closed: '—', impact: '—', grounded: '—', floating: '—' }[this.pathEnd];
  }

}
