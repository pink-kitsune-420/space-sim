import {
  PROFILERS,
  type FrameProfiler,
  type ModuleInitializationV2,
  type ProfileSection,
  type ProfilerFactory,
  type ServiceKey,
} from '@space-sim/game-api';

export interface FrameTimer {
  /** Records one frame with the given wall interval, lapping each section in order. */
  frame(intervalMs: number, sections: readonly ProfileSection[]): void;
  readonly profiler: FrameProfiler;
}

export interface FrameTimerFactory {
  /** Creates an independent timer; dispose its `profiler` when finished. */
  create(): FrameTimer;
}

export const FRAME_TIMER: ServiceKey<FrameTimerFactory> = Object.freeze({
  slot: 'example.profiler',
  version: '1.0.0',
});

export function createFrameTimer(factory: ProfilerFactory): FrameTimer {
  const profiler = factory.create();
  return Object.freeze({
    profiler,
    frame(intervalMs: number, sections: readonly ProfileSection[]): void {
      profiler.begin(intervalMs);
      for (const section of sections) profiler.lap(section);
      profiler.end();
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(PROFILERS);
  context.provide(FRAME_TIMER, Object.freeze({ create: () => createFrameTimer(factory) }));
}
