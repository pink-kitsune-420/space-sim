import { scheduledCutoff } from './rules';

/** Statically linked developer examples. Imports use only the public API. */
import type { DynamicsProvider, ModuleManifest, ModuleProfile, RegisteredModule } from '../../packages/game-api/src/index';

function manifest(id: string, slots: string[]): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id,
    version: '0.1.0', kind: 'provider', authority: 'authoritative', environments: ['browser', 'offline', 'node'],
    dependencies: [{ id: 'builtin.motion', version: '0.1.0' }], provides: [], requires: ['builtin.motion/v1'],
    slots, before: [], after: [], settings: {}, license: 'LicenseRef-Project' };
}

export const steadyLift: RegisteredModule = {
  manifest: manifest('example.steady-lift', []),
  initialize(context) {
    context.contributeForce({
      modelIdentity: 'constant-body-local-acceleration:0,2/v1',
      initialState: { version: 1, value: 0 },
      evaluate: () => ({ x: 0, y: 2 }),
      commit({ moduleState, seconds }) {
        if (typeof moduleState.value !== 'number') throw new Error('Expected elapsed seconds');
        return { version: 1, value: moduleState.value + seconds };
      },
    });
  },
};

/** Reuses the verified numerical/contact kernel for every step, including safe orbits.
 * It deliberately exposes no analytic propagation or conservative wake bounds. */
export const numericalFlight: RegisteredModule = {
  manifest: manifest('example.numerical-flight', ['dynamics']),
  initialize(context) {
    const provider: DynamicsProvider = { id: 'example.numerical-flight', version: '0.1.0',
      modelIdentity: 'bounded-kdk-contact-only/v1', supportsForces: true, step: (input, services) => services.numerical(input) };
    context.provide('dynamics', provider);
  },
};

export const MOTION_EXAMPLES = [steadyLift, numericalFlight, scheduledCutoff] as const;
export function motionExampleProfile(example: 'force' | 'numerical' | 'rule'): ModuleProfile {
  const id = example === 'force' ? steadyLift.manifest.id : example === 'rule' ? scheduledCutoff.manifest.id : numericalFlight.manifest.id;
  return { format: 'space-sim-profile/1', id, modules: [
    { id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }, { id, version: '0.1.0' },
  ], providers: { content: 'builtin.content', motion: 'builtin.motion', ...(example === 'numerical' ? { dynamics: id } : {}) }, settings: {} };
}

/** Opt in via system.vehicleDefaults or a contributed vehicle's handling. The
 * numerical kernel and the public surface provider then share circular contact. */
export const surveyHandling = Object.freeze({ acceleration: 24, turnRate: .65, initialThrottle: .65, contactRadiusMetres: 2.5 });
