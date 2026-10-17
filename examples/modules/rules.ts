/** A shared-world rule using only the supported author API. No closure authority. */
import type { RegisteredModule } from '../../packages/game-api/src/index';

export const scheduledCutoff: RegisteredModule = {
  manifest: { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'example.scheduled-cutoff',
    name: 'Scheduled engine cutoff', version: '0.1.0', kind: 'provider', authority: 'authoritative',
    environments: ['browser', 'offline', 'node'], dependencies: [{ id: 'builtin.motion', version: '0.1.0' }],
    provides: [], requires: ['builtin.motion/v1'], slots: [], before: [], after: [], settings: {}, license: 'LicenseRef-Project' },
  initialize(context) {
    context.contributeWorldRule({ modelIdentity: 'fleet-cutoff-every-100-ticks/v1', seed: 7,
      initialState: { version: 1, value: 0 },
      evaluate({ tick, ships, state, random }) {
        // The sample is authoritative too: the runtime commits/rolls back RNG with state.
        const sample = random();
        return { state: { version: 1, value: typeof state.value === 'number' ? state.value + sample : sample },
          commands: (tick + 1) % 100 === 0 ? ships.filter(s => !s.fault).map(s => ({ shipId: s.id,
            controls: { ...s.controls, engine: false } })) : [] };
      },
    });
  },
};
