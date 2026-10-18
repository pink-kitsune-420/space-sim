import type { CoreMotion, RegisteredModule } from '@space-sim/game-api';

/** Explicit host bridge for v1 startup/saves. Manifest and service identities stay exact;
 * imported v2 packages use their declared core.motion requirement instead. */
export function createLegacyMotion(core: Pick<CoreMotion, 'createContext' | 'services'>): RegisteredModule {
 return {
  manifest: { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: 'builtin.motion', name: 'builtin.motion',
   version: '0.1.0', kind: 'provider', authority: 'authoritative', environments: ['browser', 'offline', 'node'], dependencies: [],
   provides: ['builtin.motion/v1'], requires: [], slots: ['motion', 'orbits', 'bodies', 'surfaces', 'rails'], before: [], after: [], settings: {}, license: 'LicenseRef-Project' },
  initialize(context) {
   if (context.selected('motion')) context.provide('motion', core.createContext);
   for (const [slot, service] of Object.entries(core.services)) if (context.selected(slot)) context.provide(slot, service);
  }
 };
}
