import type { RegisteredModule } from '../../../game-api/src/index';
import { createSimulationContext } from '../../../sim-core/src/context';
import { BUILTIN_SERVICES } from '../../../sim-core/src/services';
import { builtinManifest } from './manifest';

/** Base game motion: the verified numerical/contact, orbital, body/frame, surface and rails
 * services. Each slot can be replaced separately; only selected slots are provided. */
export const builtinMotion: RegisteredModule = {
  manifest: builtinManifest('builtin.motion', ['motion', 'orbits', 'bodies', 'surfaces', 'rails']),
  initialize: context => {
    if (context.selected('motion')) context.provide('motion', createSimulationContext);
    for (const [slot, provider] of Object.entries(BUILTIN_SERVICES)) if (context.selected(slot)) context.provide(slot, provider);
  },
};
