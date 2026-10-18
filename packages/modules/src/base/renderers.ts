import type { RegisteredModule, RendererProvider } from '../../../game-api/src/index';
import { builtinManifest } from './manifest';

/** Legacy manifest adapter over supplied public renderer providers. */
export function createRendererModules(renderers: readonly RendererProvider[]): readonly RegisteredModule[] { return renderers.map(renderer => ({
  manifest: { ...builtinManifest(renderer.id, ['renderer'], 'presentation', ['browser', 'offline']), name: renderer.id === 'builtin.canvas' ? 'Canvas 2D' : renderer.id === 'builtin.webgl' ? 'WebGL 2' : renderer.label },
  initialize: context => context.provide('renderer', renderer),
})); }
