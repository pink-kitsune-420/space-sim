import type { CanvasRendererFactory, ModuleInitializationV2, RenderGeometry, Render2DOptions } from '@space-sim/game-api';
import { CORE_MOTION, CANVAS_DRAWING } from '@space-sim/game-api';
import { CanvasRenderer } from './canvas';
/** Create a Canvas 2D renderer factory providing scene renderers bound to physical terrain surface queries. */
export function createCanvasDrawing(geometry: RenderGeometry, defaults: Pick<Render2DOptions,'maxPixelRatio'> = {}): CanvasRendererFactory {
  const resources = new Set<CanvasRenderer>(); let disposed = false;
  return Object.freeze<CanvasRendererFactory>({ create(canvas, options) {
    if (disposed) throw new Error('Canvas renderer provider disposed');
    const renderer = new CanvasRenderer(canvas, { ...defaults, ...options, geometry: options?.geometry ?? geometry });
    const close = renderer.dispose.bind(renderer); let closed = false;
    renderer.dispose = () => { if (closed) return; closed = true; resources.delete(renderer); close(); }; resources.add(renderer); return renderer;
  }, dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const renderer of resources) { try { renderer.dispose(); } catch (error) { errors.push(error); } }
    resources.clear(); if (errors.length) throw new AggregateError(errors, 'Canvas renderer provider cleanup failed'); } });
}

/** Initialize the Canvas 2D rendering module, providing render.canvas@1.0.0 and registering its usage guide. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Canvas 2D",summary:"Public render.canvas@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'});
  const surfaces = context.use(CORE_MOTION).services.surfaces;
  context.provide(CANVAS_DRAWING, context.own(createCanvasDrawing({ querySurface: surfaces.query.bind(surfaces) },{maxPixelRatio:context.settings.maxPixelRatio??3})));
}
