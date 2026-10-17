import type { RegisteredModule } from '../../../game-api/src/index';
import { BUILTIN_UNIVERSES } from '../../../scenarios/builtin';
import { builtinManifest } from './manifest';

/** Base game content: every built-in universe, keyed `builtin.content/<universe id>`. */
export const builtinContent: RegisteredModule = {
  manifest: builtinManifest('builtin.content', ['content']),
  initialize: context => {
    context.provide('content', new Map(Object.values(BUILTIN_UNIVERSES).map(u => [`builtin.content/${u.id}`, u])));
  },
};
