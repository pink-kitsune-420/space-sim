import type { Disposable, ModuleInitializationV2, RenderGeometry, Render2DOptions, WebGLRendererFactory } from '@space-sim/game-api';
import { CORE_MOTION, WEBGL_DRAWING } from '@space-sim/game-api';
import { WebGLRenderer } from './webgl';
import { PlanetPreview } from './planet-preview';
export function createWebGLDrawing(geometry: RenderGeometry, defaults: Pick<Render2DOptions,'maxPixelRatio'> = {}): WebGLRendererFactory {
  const resources = new Set<Disposable>(); let disposed = false;
  const own = <T extends Disposable>(create: () => T): T => {
    if (disposed) throw new Error('WebGL renderer provider disposed');
    const resource = create(), close = resource.dispose.bind(resource); let closed = false;
    resource.dispose = () => { if (closed) return; closed = true; resources.delete(resource); close(); }; resources.add(resource); return resource;
  };
  return Object.freeze<WebGLRendererFactory>({
    create: (canvas, shaders, options) => own(() => new WebGLRenderer(canvas, shaders, { ...defaults, ...options, geometry: options?.geometry ?? geometry })),
    preview: (canvas, shaders) => own(() => new PlanetPreview(canvas, shaders)),
    dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
      for (const resource of [...resources]) { try { resource.dispose(); } catch (error) { errors.push(error); } }
      resources.clear(); if (errors.length) throw new AggregateError(errors, 'Renderer cleanup failed');
    },
  });
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"WebGL 2",summary:"Public render.webgl@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'});
  const surfaces = context.use(CORE_MOTION).services.surfaces;
  context.provide(WEBGL_DRAWING, context.own(createWebGLDrawing({ querySurface: surfaces.query.bind(surfaces) },{maxPixelRatio:context.settings.maxPixelRatio??2})));
}
