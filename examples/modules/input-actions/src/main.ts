import { FLIGHT_ACTIONS, type FlightActionBindings, type ModuleInitializationV2, type ServiceKey } from '@space-sim/game-api';

export interface ActionInspector {
  summarize(): { total: number; categories: Record<string, number> };
  describeBinding(namespacedId: string): string;
}

export const ACTION_INSPECTOR: ServiceKey<ActionInspector> = Object.freeze({
  slot: 'example.flight-actions-inspector',
  version: '1.0.0',
});

export function createActionInspector(actions: FlightActionBindings): ActionInspector {
  return Object.freeze({
    summarize() {
      const categories: Record<string, number> = {};
      for (const def of actions.definitions) {
        categories[def.category] = (categories[def.category] ?? 0) + 1;
      }
      return { total: actions.definitions.length, categories };
    },
    describeBinding(namespacedId: string) {
      const def = actions.definitions.find(d => d.id === namespacedId);
      if (!def) return `Unknown action: ${namespacedId}`;
      const bindings = actions.load();
      const keys = bindings[namespacedId] ?? def.defaultKeys;
      return `${def.label} (${def.mode}): ${keys.length ? keys.join(', ') : 'unbound'}`;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const actions = context.use(FLIGHT_ACTIONS);
  context.provide(ACTION_INSPECTOR, createActionInspector(actions));
}
