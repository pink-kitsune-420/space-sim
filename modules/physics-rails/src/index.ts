import { CORE_MOTION, MOTION_CONTEXTS, ORBITAL_MOTION, BODY_FRAMES, SURFACE_GEOMETRY, RAILS_POLICY, type ModuleInitializationV2 } from '@space-sim/game-api';
export { createLegacyMotion } from './legacy';

/** Editable provider selection over the fixed, verified headless kernel. It neither owns
 * celestial state nor steps a world; distinct slots remain independently replaceable. */
export default function initialize(context: ModuleInitializationV2): void {
 const core = context.use(CORE_MOTION);
 if (context.selected(MOTION_CONTEXTS.slot)) context.provide(MOTION_CONTEXTS, core.createContext);
 if (context.selected(ORBITAL_MOTION.slot)) context.provide(ORBITAL_MOTION, core.services.orbits);
 if (context.selected(BODY_FRAMES.slot)) context.provide(BODY_FRAMES, core.services.bodies);
 if (context.selected(SURFACE_GEOMETRY.slot)) context.provide(SURFACE_GEOMETRY, core.services.surfaces);
 if (context.selected(RAILS_POLICY.slot)) context.provide(RAILS_POLICY, core.services.rails);
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Rails and shared motion services', summary: 'Preserved numerical flight, analytic coasting, frame/contact services and independently replaceable rails policy.', asset: 'docs/creators/usage.json' });
}
