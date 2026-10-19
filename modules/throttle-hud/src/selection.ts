import type { RegisteredModule } from '@space-sim/game-api';

/** Selection adapter for legacy presentation profiles. VIEW_HUD owns each actual
 * instrument instance through the selected public THROTTLE_HUD service. */
export const throttleSelection: RegisteredModule = {
  manifest: {
    format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1',
    id: 'builtin.throttle', name: 'Throttle lever', version: '0.1.0', kind: 'provider',
    authority: 'presentation', environments: ['browser', 'offline'],
    dependencies: [], provides: [], requires: [], slots: [], before: [], after: [],
    settings: {}, license: 'LicenseRef-Project',
  },
  initialize() { /* Per-view instances are mounted and disposed by the HUD owner. */ },
};
