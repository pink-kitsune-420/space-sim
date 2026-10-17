import type { ModuleEnvironment, ModuleManifest } from '../../../game-api/src/index';

/** Manifest for a first-party module. The `builtin.*` namespace is reserved for them. */
export function builtinManifest(id: string, slots: string[], authority: ModuleManifest['authority'] = 'authoritative', environments: ModuleEnvironment[] = ['browser', 'offline', 'node']): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id,
    version: '0.1.0', kind: 'provider', authority, environments, dependencies: [],
    provides: [`${id}/v1`], requires: [], slots, before: [], after: [], settings: {}, license: 'LicenseRef-Project' };
}
