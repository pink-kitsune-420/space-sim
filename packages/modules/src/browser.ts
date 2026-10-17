import type { ModuleProfile, ModuleReference, RegisteredModule } from '../../game-api/src/index';
import { ModuleRegistry } from '../../game-runtime/src/index';
import { freezeJson } from '../../game-runtime/src/validation';
import { BUILTIN_RENDERERS, rendererModules, WEBGL_RENDERER } from './base/renderers';
import { TOOLSET_MODULES } from './base/toolset/index';
export { BUILTIN_RENDERERS, CANVAS_RENDERER, WEBGL_RENDERER } from './base/renderers';
export { INSTRUMENTS, TOOLSET_MODULES } from './base/toolset/index';

const reference = (m: RegisteredModule): ModuleReference => ({ id: m.manifest.id, version: m.manifest.version });
/** Base presentation modules a new viewer starts with: the flight information toolset. */
export const DEFAULT_PRESENTATION_MODULES: readonly ModuleReference[] = Object.freeze(TOOLSET_MODULES.map(reference));
/** The default look: both renderers installed with WebGL selected, plus the toolset. */
export const DEFAULT_PRESENTATION_PROFILE: ModuleProfile = freezeJson({ format: 'space-sim-profile/1', id: 'builtin.presentation',
  modules: [...BUILTIN_RENDERERS.map(r => ({ id: r.id, version: r.version })), ...DEFAULT_PRESENTATION_MODULES],
  providers: { renderer: WEBGL_RENDERER.id }, settings: {} });

/** Base renderers and toolset plus any other statically linked presentation modules.
 * Installing one has no effect until a presentation profile enables it. */
export function createPresentationRegistry(code: readonly RegisteredModule[] = []): ModuleRegistry {
  const registry = new ModuleRegistry();
  for (const module of [...rendererModules, ...TOOLSET_MODULES, ...code]) {
    if (module.manifest.authority !== 'presentation') throw new Error(`Module ${module.manifest.id}: presentation profiles accept presentation modules only`);
    registry.register(module);
  }
  return registry;
}

/** A presentation profile from a renderer choice and the enabled non-renderer modules
 * (which should already include their dependencies, for example from `ModuleRegistry.closure`). */
export function presentationProfile(renderer: string, modules: readonly ModuleReference[] = DEFAULT_PRESENTATION_MODULES): ModuleProfile {
  const renderers = BUILTIN_RENDERERS.map(r => ({ id: r.id, version: r.version }));
  const extra = modules.filter(m => !renderers.some(r => r.id === m.id));
  const standard = extra.length === DEFAULT_PRESENTATION_MODULES.length
    && DEFAULT_PRESENTATION_MODULES.every(d => extra.some(m => m.id === d.id && m.version === d.version));
  return { ...DEFAULT_PRESENTATION_PROFILE, id: standard ? DEFAULT_PRESENTATION_PROFILE.id : 'local.presentation',
    modules: [...renderers, ...extra], providers: { renderer } };
}
