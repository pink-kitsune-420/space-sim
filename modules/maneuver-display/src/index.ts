import type { ModuleInitializationV2 } from '@space-sim/game-api';
import { drawManeuver } from './overlay';
export { drawManeuver, maneuverDelta, maneuverPlanner, MANEUVER_COLOR } from './overlay';
/**
 * Contributes the presentation layer for maneuver vector and trajectory display.
 * Provides view.maneuver-display@1.0.0; requires no external services.
 */
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeLayer({ name: 'maneuver', label: 'Planned burn and trajectory', draw: drawManeuver });
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Maneuver vector display', summary: 'Removable node and predicted trajectory overlays over detached read-only snapshots.', asset: 'docs/creators/usage.json' });
}
