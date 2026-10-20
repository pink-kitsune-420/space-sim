import { CORE_ROTATION, PLANET_DESIGNERS, VECTOR_SHADERS, WEBGL_DRAWING,
 type ModuleInitializationV2, type PlanetDesignerControl, type PlanetDesignerFactory } from '@space-sim/game-api';
import { PlanetDesigner, type PlanetDesignerServices, type PlanetDesignerTuning } from './designer';
export { PlanetDesigner } from './designer';
export type { PlanetDesignerServices, PlanetDesignerTuning } from './designer';
export function createPlanetDesigners(services: PlanetDesignerServices, css = '', tuning: PlanetDesignerTuning = {}): PlanetDesignerFactory & { dispose(): void } {
 const instances = new Set<PlanetDesignerControl>(), styles = new Map<Document, HTMLStyleElement>(); let disposed = false;
 return Object.freeze<PlanetDesignerFactory & { dispose(): void }>({ create(options) {
  if (disposed) throw new Error('Planet designer provider disposed');
  const document = options.root.ownerDocument;
  if (css && !styles.has(document)) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); styles.set(document,style); }
  const designer = new PlanetDesigner(services,options,tuning), close = designer.dispose.bind(designer); let closed = false;
  designer.dispose = () => { if (closed) return; closed = true; instances.delete(designer); close(); }; instances.add(designer); return designer;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const designer of instances) { try { designer.dispose(); } catch (error) { errors.push(error); } }
  instances.clear(); for (const style of styles.values()) style.remove(); styles.clear();
  if (errors.length) throw new AggregateError(errors, 'Planet designer cleanup failed');
 } });
}
/**
 * Contributes independent planet appearance designer controls and previews.
 * Provides ui.planet-designer@1.0.0 in slot ui.planet-designer.
 * Requires core.rotation@^1.0.0; optionally consumes render.webgl@^1.0.0 and render.vector-shaders@^1.0.0.
 * Settings: previewSpinSeconds, sunDegrees, importMaxBytes.
 */
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id:'usage', audience:'creators', title:'Independent planet appearance designer', summary:'Read-only body previews and viewer-scoped designs with explicit storage/export ports.', asset:'docs/creators/usage.json' });
 const rotation = context.use(CORE_ROTATION), drawing = context.tryUse(WEBGL_DRAWING), shaders = context.tryUse(VECTOR_SHADERS);
 context.provide(PLANET_DESIGNERS, context.own(createPlanetDesigners({ rotation, ...(drawing && shaders ? { preview: (canvas: HTMLCanvasElement) => drawing.preview(canvas,shaders.defaults) } : {}) }, context.assets.text('assets/designer.css'), context.settings)));
}
