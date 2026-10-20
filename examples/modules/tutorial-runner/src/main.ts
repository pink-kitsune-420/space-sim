import {
  TUTORIAL_RUNNERS,
  type ModuleInitializationV2,
  type ServiceKey,
  type ThemePreferences,
  type TutorialLesson,
  type TutorialObservation,
  type TutorialRunner,
  type TutorialRunnerFactory,
} from '@space-sim/game-api';

export interface TutorialRunnerHelper {
  /** Creates a tutorial runner scoped to `storageKey`. */
  create(storageKey: string, storage?: ThemePreferences): TutorialRunner;
  /** Starts a lesson and evaluates a sequence of read-only observations. */
  evaluate(runner: TutorialRunner, lesson: TutorialLesson, observations: readonly TutorialObservation[]): TutorialRunner;
}

export const TUTORIAL_RUNNER_HELPER: ServiceKey<TutorialRunnerHelper> = Object.freeze({
  slot: 'example.tutorial-runner',
  version: '1.0.0',
});

export function createTutorialRunnerHelper(runners: TutorialRunnerFactory): TutorialRunnerHelper {
  return Object.freeze<TutorialRunnerHelper>({
    create(storageKey, storage): TutorialRunner {
      return runners.create({ storageKey, storage });
    },
    evaluate(runner, lesson, observations): TutorialRunner {
      const [first, ...rest] = observations;
      if (!first) throw new Error('At least one initial observation is required');
      runner.start(lesson, first);
      for (const observation of rest) runner.update(observation);
      return runner;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(TUTORIAL_RUNNER_HELPER, createTutorialRunnerHelper(context.use(TUTORIAL_RUNNERS)));
}
