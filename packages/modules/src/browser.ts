import type { AudioProvider, ModuleProfile, ModuleReference, RegisteredModule } from '../../game-api/src/index';
import { ModuleRegistry } from '../../game-runtime/src/index';
import { freezeJson } from '../../game-runtime/src/validation';
import { createRendererModules } from './base/renderers';
import { CanvasRenderer, WebGLRenderer } from '../../render-2d/src/index';
import type { RendererProvider } from '../../game-api/src/index';
import { TOOLSET_MODULES as TOOLSET_CORE } from './base/toolset/index';
import { navball } from '../../../modules/navball/src/drawing';
import { throttleSelection } from '../../../modules/throttle-hud/src/selection';
export const TOOLSET_MODULES = Object.freeze([...TOOLSET_CORE.slice(0,4),navball,throttleSelection,...TOOLSET_CORE.slice(4)]);
import { createAudioModule } from './base/audio/index';
import { PROCEDURAL_AUDIO } from '../../../modules/audio-procedural/src/synth';
const provider = (value: RendererProvider): RendererProvider => Object.freeze({ ...value, capabilities: Object.freeze({ ...value.capabilities }) });
export const CANVAS_RENDERER = provider({ id: 'builtin.canvas', version: '0.1.0', label: '2D', capabilities: { shaders: false, overlays: true }, create: canvas => new CanvasRenderer(canvas) });
export const WEBGL_RENDERER = provider({ id: 'builtin.webgl', version: '0.1.0', label: 'WebGL', capabilities: { shaders: true, overlays: true, effects: true }, create: (canvas, options) => new WebGLRenderer(canvas, options?.shaders) });
export const BUILTIN_RENDERERS = Object.freeze([WEBGL_RENDERER, CANVAS_RENDERER]);
const rendererModules = createRendererModules(BUILTIN_RENDERERS), audioModule = createAudioModule(PROCEDURAL_AUDIO);
export { INSTRUMENTS } from './base/toolset/index';
export { PROCEDURAL_AUDIO } from '../../../modules/audio-procedural/src/synth';

const reference = (m: RegisteredModule): ModuleReference => ({ id: m.manifest.id, version: m.manifest.version });
/** Base presentation modules a new viewer starts with: flight instruments and sound. */
export const DEFAULT_PRESENTATION_MODULES: readonly ModuleReference[] = Object.freeze([...TOOLSET_MODULES, audioModule].map(reference));
/** Default presentation: WebGL selected, flight instruments and procedural sound. */
export const DEFAULT_PRESENTATION_PROFILE: ModuleProfile = freezeJson({ format: 'space-sim-profile/1', id: 'builtin.presentation',
  modules: [...BUILTIN_RENDERERS.map(r => ({ id: r.id, version: r.version })), ...DEFAULT_PRESENTATION_MODULES],
  providers: { renderer: WEBGL_RENDERER.id, audio: PROCEDURAL_AUDIO.id }, settings: {} });

/** Base renderers and toolset plus any other statically linked presentation modules.
 * Installing one has no effect until a presentation profile enables it. */
export interface PresentationProviders { readonly renderers?: readonly RendererProvider[]; readonly audio?: AudioProvider | false }
export function createPresentationRegistry(code: readonly RegisteredModule[] = [], providers: PresentationProviders = {}): ModuleRegistry {
  const registry = new ModuleRegistry();
  const renderers = providers.renderers ? createRendererModules(providers.renderers) : rendererModules;
  const audio = providers.audio === false ? [] : [providers.audio ? createAudioModule(providers.audio) : audioModule];
  for (const module of [...renderers, ...TOOLSET_MODULES, ...audio, ...code]) {
    if (module.manifest.authority !== 'presentation') throw new Error(`Module ${module.manifest.id}: presentation profiles accept presentation modules only`);
    registry.register(module);
  }
  return registry;
}

/** A presentation profile from a renderer choice and the enabled non-renderer modules
 * (which should already include their dependencies, for example from `ModuleRegistry.closure`). */
export function presentationProfile(renderer: string, modules: readonly ModuleReference[] = DEFAULT_PRESENTATION_MODULES,
  audio = modules.some(m => m.id === PROCEDURAL_AUDIO.id) ? PROCEDURAL_AUDIO.id : undefined): ModuleProfile {
  const renderers = BUILTIN_RENDERERS.map(r => ({ id: r.id, version: r.version }));
  const extra = modules.filter(m => !renderers.some(r => r.id === m.id));
  const standard = extra.length === DEFAULT_PRESENTATION_MODULES.length
    && DEFAULT_PRESENTATION_MODULES.every(d => extra.some(m => m.id === d.id && m.version === d.version));
  return { ...DEFAULT_PRESENTATION_PROFILE, id: standard ? DEFAULT_PRESENTATION_PROFILE.id : 'local.presentation',
    modules: [...renderers, ...extra], providers: { renderer, ...(audio ? { audio } : {}) } };
}
