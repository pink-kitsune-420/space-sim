import { FLIGHT_PLANS, CORE_CLOCK, CORE_MOTION, MANEUVER_BURNS, MANEUVER_PLANNERS, PREDICTIONS, WINDOWS,
 type ManeuverPlannerControl, type ManeuverPlannerFactory, type ModuleInitializationV2 } from '@space-sim/game-api';
import { ManeuverPlanner, type ManeuverEditorServices, type ManeuverEditorTuning } from './editor';
export { ManeuverPlanner, pickManeuverTime, maneuverWarpFactor } from './editor';
export type { ManeuverEditorServices, ManeuverEditorTuning } from './editor';
export function createManeuverPlanners(services: ManeuverEditorServices, css = '', tuning: ManeuverEditorTuning = {}): ManeuverPlannerFactory & { dispose(): void } {
 const instances = new Set<ManeuverPlannerControl>(), styles = new Map<Document, HTMLStyleElement>(); let disposed = false;
 return Object.freeze<ManeuverPlannerFactory & { dispose(): void }>({ create(options) {
  if (disposed) throw new Error('Maneuver planner provider disposed');
  const document = options.container.ownerDocument;
  if (css && !styles.has(document)) { const style = document.createElement('style'); style.textContent = css; document.head.append(style); styles.set(document, style); }
  const planner = new ManeuverPlanner(services, options, tuning), close = planner.dispose.bind(planner); let closed = false;
  planner.dispose = () => { if (closed) return; closed = true; instances.delete(planner); close(); }; instances.add(planner); return planner;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const planner of instances) { try { planner.dispose(); } catch (error) { errors.push(error); } }
  instances.clear(); for (const style of styles.values()) style.remove(); styles.clear();
  if (errors.length) throw new AggregateError(errors, 'Maneuver planner provider cleanup failed');
 } });
}
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Independent maneuver editors', summary: 'Read-only candidate previews and validated host commands over shared floating windows.', asset: 'docs/creators/usage.json' });
 const services = { plans: context.tryUse(FLIGHT_PLANS), windows: context.use(WINDOWS), predictions: context.use(PREDICTIONS), burns: context.use(MANEUVER_BURNS), clock: context.use(CORE_CLOCK), motion: context.use(CORE_MOTION) };
 context.provide(MANEUVER_PLANNERS, context.own(createManeuverPlanners(services, context.assets.text('assets/editor.css'), context.settings)));
}
