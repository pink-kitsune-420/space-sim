/** Statically installed developer examples. Installing has no effect until a profile selects one. */
import type { ModuleProfile, RegisteredModule } from '../../packages/game-api/src/index';
import { MOTION_EXAMPLES, motionExampleProfile } from './motion';
import { maneuverCommands } from './commands';
import { leadCamera } from './lead-camera';

/** Authoritative examples: they change the simulation, so a profile enabling one starts a new world. */
export const GAME_EXAMPLES: readonly RegisteredModule[] = Object.freeze([...MOTION_EXAMPLES, maneuverCommands]);
/** Presentation examples: they change only what one viewer sees and can be switched off at any
 * time. The lead camera depends on the first-party builtin.flight-data module. */
export const PRESENTATION_EXAMPLES: readonly RegisteredModule[] = Object.freeze([leadCamera]);
export const EXAMPLE_NAMES = ['force', 'numerical', 'rule', 'commands'] as const;
export type ExampleName = typeof EXAMPLE_NAMES[number];

export function exampleProfile(name: ExampleName): ModuleProfile {
  if (name !== 'commands') return motionExampleProfile(name);
  const id = maneuverCommands.manifest.id;
  return { format: 'space-sim-profile/1', id, modules: [
    { id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }, { id, version: maneuverCommands.manifest.version },
  ], providers: { content: 'builtin.content', motion: 'builtin.motion' }, settings: {} };
}
