import { TUTORIAL_RUNNERS, type ModuleInitializationV2, type TutorialCondition,
  type TutorialRunner, type TutorialRunnerFactory, type TutorialValues } from '@space-sim/game-api';

export function conditionMet(condition: TutorialCondition, values: TutorialValues, baseline: TutorialValues): boolean {
  const value = values[condition.field], before = baseline[condition.field];
  if (value === undefined || (typeof value === 'number' && !Number.isFinite(value))) return false;
  if (condition.operator === 'changed') return before !== undefined && value !== before;
  if (condition.operator === 'eq') return value === condition.value;
  if (typeof value !== 'number' || typeof condition.value !== 'number' || !Number.isFinite(condition.value)) return false;
  if (condition.operator === 'gte') return value >= condition.value;
  if (condition.operator === 'lte') return value <= condition.value;
  if (typeof before !== 'number' || !Number.isFinite(before) || before <= 0) return false;
  return condition.operator === 'ratio-gte' ? value / before >= condition.value : value / before <= condition.value;
}

/** Bounded presentation state machine. No flight, DOM, timers or session writes. */
export function createTutorialRunners(): TutorialRunnerFactory {
  return { create({ storage, storageKey }) {
    const completed = new Set<string>();
    try {
      const saved: unknown = JSON.parse(storage?.getItem(storageKey) ?? '[]');
      if (Array.isArray(saved)) for (const id of saved.slice(0, 256)) if (typeof id === 'string' && id.length <= 160) completed.add(id);
    } catch { /* Unavailable/corrupt storage leaves an in-memory course. */ }
    let baseline: TutorialValues = {}, identity: object | undefined, lastTime = 0, heldSince: number | undefined, disposed = false;
    const key = () => `${runner.lesson!.id}@${runner.lesson!.version}`;
    const advance = () => {
      runner.step++; heldSince = undefined;
      runner.finished = runner.step === runner.lesson!.steps.length;
      if (runner.finished) {
        completed.add(key()); runner.feedback = 'Lesson complete. Try another lesson or keep experimenting.';
        try { storage?.setItem(storageKey, JSON.stringify([...completed].slice(-256))); } catch { /* Keep progress in memory. */ }
      } else runner.feedback = 'Objective complete.';
    };
    const runner: TutorialRunner & { lesson: TutorialRunner['lesson']; step: number; finished: boolean; interrupted: boolean; feedback: string } = {
      lesson: undefined, step: 0, finished: false, interrupted: false, feedback: '', completed,
      start(lesson, observation) {
        if (disposed) throw Error('Tutorial runner is disposed');
        if (!lesson.steps.length || lesson.steps.length > 64 || !Number.isFinite(observation.time)) throw Error('Invalid lesson or observation');
        for (const step of lesson.steps) {
          if ((!!step.question) === (!!step.conditions?.length) || !Number.isFinite(step.holdSeconds ?? 0) || (step.holdSeconds ?? 0) < 0
            || (step.allowPaused && (step.holdSeconds ?? 0) > 0) || (step.conditions?.length ?? 0) > 32 || (step.question && (!Number.isInteger(step.question.correct) || step.question.correct < 0 || step.question.correct >= step.question.choices.length))) throw Error('Each step needs bounded conditions or a valid question');
        }
        runner.lesson = lesson; runner.step = 0; runner.finished = false; runner.interrupted = false; runner.feedback = '';
        baseline = { ...observation.values }; identity = observation.identity; lastTime = observation.time; heldSince = undefined;
      },
      update(observation) {
        if (disposed || !runner.lesson || runner.finished || runner.interrupted) return;
        if (!Number.isFinite(observation.time) || identity !== observation.identity || observation.time < lastTime) {
          runner.interrupted = true; heldSince = undefined; runner.feedback = 'Flight changed. Start guidance again or load the practice setup.'; return;
        }
        const previous = lastTime; lastTime = observation.time;
        const step = runner.lesson.steps[runner.step]!;
        if (!step.conditions || (!step.allowPaused && (observation.paused || observation.time === previous))) return;
        if (!step.conditions.every(condition => conditionMet(condition, observation.values, baseline))) { heldSince = undefined; return; }
        heldSince ??= observation.time;
        if (observation.time - heldSince + 1e-9 >= (step.holdSeconds ?? 0)) advance();
      },
      answer(choice) {
        if (disposed || !runner.lesson || runner.finished || runner.interrupted) return false;
        const question = runner.lesson.steps[runner.step]?.question;
        if (!question) return false;
        if (choice !== question.correct) { runner.feedback = 'Try again. Use the hint or open Go deeper.'; return false; }
        advance(); if (!runner.finished) runner.feedback = question.explanation; return true;
      },
      stop() { runner.lesson = undefined; runner.finished = false; runner.interrupted = false; heldSince = undefined; },
      dispose() { if (disposed) return; runner.stop(); disposed = true; },
    };
    return runner;
  } };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.provide(TUTORIAL_RUNNERS, createTutorialRunners());
  context.contributeGuide({ id: 'runner', audience: 'creators', title: 'Reusable tutorial runner', summary: 'Read-only objectives, versioned local progress and explicit knowledge checks.', asset: 'docs/creators/usage.json' });
}
