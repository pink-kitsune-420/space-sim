import { CORE_UNIVERSE_DISK, type UniverseDisk } from '../../../packages/game-api/src/index';
import { bundledRegistration, prepareBundledPlan } from '../../../packages/game-runtime/src/bundled-plan';
import { validateRuntimeSelection } from '../../../packages/game-library/src/runtime-selection';
import initialize from '../../../modules/universe-server-storage/src/index';
import { manifest, compatibility } from '../../../modules/universe-server-storage/module.json';
import guide from '../../../modules/universe-server-storage/docs/creators/usage.json';
import targets from '../../../games/space-sim/targets.json';

/** Native disk IO remains in the host; the manifest selects storage policy. */
export function prepareServerTarget(disk: UniverseDisk) {
  const plan = validateRuntimeSelection(targets).plans.node!;
  return prepareBundledPlan(plan, 'node', [bundledRegistration({ manifest, compatibility }, initialize, { 'docs/creators/usage.json': guide })],
    [{ key: CORE_UNIVERSE_DISK, service: disk, tiers: ['platform'], environments: ['node'] }]);
}
