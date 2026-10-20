import { PREDICTIONS, type GhostEnd, type GhostSample, type ModuleInitializationV2, type PredictionFactory,
  type PredictionSummary, type ResolvedBody, type ServiceKey, type SimulationContext, type State,
  type SurfaceProfile, type WorldRead } from '@space-sim/game-api';

export interface ProbeInput {
  readonly context: SimulationContext; readonly state: State; readonly body: ResolvedBody;
  readonly surface?: SurfaceProfile; readonly shipId: string;
  /** Pass the world for SOI-aware forecasts; omit it for a body-only preview. */
  readonly world?: WorldRead;
}
/** `unfinished` means the update limit ran out first; samples then hold the partial path. */
export interface ProbeResult {
  readonly end: GhostEnd | 'unfinished'; readonly samples: readonly GhostSample[];
  /** Seconds of simulation time for one revolution, when the path closed. */
  readonly period?: number;
}
export interface PredictionProbe { trace(input: ProbeInput): ProbeResult }
/** This example's own service, published for other modules or tests. */
export const PREDICTION_PROBE: ServiceKey<PredictionProbe> = Object.freeze({ slot: 'example.prediction-probe', version: '1.0.0' });

const FRAME_SECONDS = 1 / 60;

/** Consumes view.prediction the way a view does: create, update once per frame, read, dispose. */
export function createProbe(predictions: PredictionFactory, frames: number): PredictionProbe {
  return Object.freeze({
    trace(input: ProbeInput): ProbeResult {
      let finished: PredictionSummary | undefined;
      const preview = predictions.create(summary => { finished = summary; });
      try {
        for (let frame = 0; frame < frames && !finished; frame++) {
          preview.update(input.context, input.state, input.body, input.surface, input.shipId, FRAME_SECONDS, false, undefined, input.world);
        }
        // The path array is reused by later passes and cleared on dispose: copy it first.
        const samples = preview.path.slice(), end = finished?.end ?? 'unfinished';
        const first = samples[0], last = samples.at(-1);
        return { end, samples, ...(end === 'closed' && first && last ? { period: last.time - first.time } : {}) };
      } finally {
        preview.dispose();
      }
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(PREDICTION_PROBE, createProbe(context.use(PREDICTIONS), context.settings.frames ?? 240));
}
