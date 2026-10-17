import type { RegisteredModule, RendererProvider } from '../../../game-api/src/index';
import { CanvasRenderer, WebGLRenderer } from '../../../render-2d/src/index';
import { builtinManifest } from './manifest';

const provider = (p: RendererProvider): RendererProvider => Object.freeze({ ...p, capabilities: Object.freeze({ ...p.capabilities }) });
/** Base game renderers. Browser-only, so the headless graph never loads renderer or DOM code. */
export const CANVAS_RENDERER = provider({
  id: 'builtin.canvas', version: '0.1.0', label: '2D', capabilities: { shaders: false, overlays: true },
  create: canvas => new CanvasRenderer(canvas),
});
export const WEBGL_RENDERER = provider({
  id: 'builtin.webgl', version: '0.1.0', label: 'WebGL', capabilities: { shaders: true, overlays: true },
  create: (canvas, options) => new WebGLRenderer(canvas, options?.shaders),
});
/** In toggle order: WebGL first, Canvas 2D as the fallback. */
export const BUILTIN_RENDERERS: readonly RendererProvider[] = Object.freeze([WEBGL_RENDERER, CANVAS_RENDERER]);
export const rendererModules: readonly RegisteredModule[] = BUILTIN_RENDERERS.map(renderer => ({
  manifest: { ...builtinManifest(renderer.id, ['renderer'], 'presentation', ['browser', 'offline']),
    name: renderer === CANVAS_RENDERER ? 'Canvas 2D' : 'WebGL 2' },
  initialize: context => context.provide('renderer', renderer),
}));
