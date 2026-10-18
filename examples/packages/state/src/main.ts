import type { ModuleInitialization } from '@space-sim/game-api';
export default function initialize(context: ModuleInitialization): void {
  // Version 1 held a number; version 2 names the elapsed-seconds field.
  // Candidates own migrations, so another world's module cannot replace this function.
  context.migrateState(1, value => ({ elapsed: Number(value) }));
  context.contributeWorldRule({ modelIdentity: 'flight-clock/v2', seed: 19,
    initialState: { version: 2, value: { elapsed: 0 } },
    evaluate({ state, seconds }) {
      if (!state.value || typeof state.value !== 'object' || Array.isArray(state.value)
        || !('elapsed' in state.value) || typeof state.value.elapsed !== 'number') throw new Error('Expected elapsed seconds');
      return { state: { version: 2, value: { elapsed: state.value.elapsed + seconds } } };
    },
  });
}
