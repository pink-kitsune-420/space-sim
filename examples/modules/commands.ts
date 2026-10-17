/** Authoritative pilot commands using only the public API. The host checks ownership and
 * arguments, runs `resolve` between fixed steps and validates the effect before applying it. */
import type { RegisteredModule } from '../../packages/game-api/src/index';

export const maneuverCommands: RegisteredModule = {
  manifest: { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'example.maneuvers',
    name: 'Throttle commands', version: '0.1.0', kind: 'provider', authority: 'authoritative',
    environments: ['browser', 'offline', 'node'], dependencies: [{ id: 'builtin.motion', version: '0.1.0' }],
    provides: [], requires: ['builtin.motion/v1'], slots: [], before: [], after: [], settings: {}, license: 'LicenseRef-Project' },
  initialize(context) {
    context.contributeCommand({ name: 'full-throttle', label: 'Full throttle', key: 'KeyZ', resolve: () => ({ throttle: 1 }) });
    context.contributeCommand({ name: 'cut-throttle', label: 'Cut throttle', key: 'KeyX', resolve: () => ({ throttle: 0 }) });
    // Relative to the ship's committed throttle; the step is an argument with a default.
    context.contributeCommand({ name: 'trim-throttle', label: 'Throttle +10%', key: 'KeyV',
      parameters: { step: { type: 'number', default: .1, minimum: -1, maximum: 1 } },
      resolve: ({ ship, args }) => ({ throttle: Math.max(0, Math.min(1, ship.state.throttle + args.step!)) }) });
  },
};
