import {
  MANEUVER_PLANNERS,
  type ManeuverPlannerControl,
  type ManeuverPlannerFactory,
  type ManeuverPlannerOptions,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface ManeuverEditorSession {
  readonly planner: ManeuverPlannerControl;
  readonly isExecuting: boolean;
  getDiagnostics(): Record<string, unknown> | null;
  dispose(): void;
}

export interface ManeuverEditorHelper {
  createSession(options: ManeuverPlannerOptions): ManeuverEditorSession;
}

export const MANEUVER_EDITOR_HELPER: ServiceKey<ManeuverEditorHelper> = Object.freeze({
  slot: 'example.maneuver-editor',
  version: '1.0.0',
});

export function createManeuverEditorHelper(factory: ManeuverPlannerFactory): ManeuverEditorHelper {
  return Object.freeze({
    createSession(options: ManeuverPlannerOptions): ManeuverEditorSession {
      const planner = factory.create(options);
      return {
        planner,
        get isExecuting() {
          return planner.executing;
        },
        getDiagnostics() {
          return planner.diagnostics();
        },
        dispose() {
          planner.dispose();
        },
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const factory = context.use(MANEUVER_PLANNERS);
  context.provide(MANEUVER_EDITOR_HELPER, createManeuverEditorHelper(factory));
}
