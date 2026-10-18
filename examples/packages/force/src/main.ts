import type { ModuleInitialization } from '@space-sim/game-api';
export default function initialize(context: ModuleInitialization): void {
  const acceleration = context.settings.acceleration!;
  context.contributeForce({ modelIdentity: `steady-lift:${acceleration}/v1`,
    initialState: { version: 1, value: 0 },
    evaluate: () => ({ x: 0, y: acceleration }),
    commit: ({ moduleState, seconds }) => ({ version: 1, value: Number(moduleState.value) + seconds }),
  });
}
