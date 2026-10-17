import type { DynamicsProvider, ModuleInitialization } from '@space-sim/game-api';
export default function initialize(context: ModuleInitialization): void {
  const provider: DynamicsProvider = { id: 'local.numerical-flight', version: '0.1.0',
    modelIdentity: 'bounded-kdk-contact-only/v1', supportsForces: true,
    step: (input, services) => services.numerical(input) };
  context.provide('dynamics', provider);
}
