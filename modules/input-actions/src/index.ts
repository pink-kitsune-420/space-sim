import { FLIGHT_ACTIONS, type ActionDefinitionV2, type ModuleInitializationV2 } from '@space-sim/game-api';
import { ACTION_DEFINITIONS, isFlightAction, loadKeybindings, saveKeybindings, resetKeybindings, type KeyBindings, type ActionId } from './bindings';

/** Stable compatibility mapping; legacy saves and keybinding files keep their old IDs. */
export function flightActionId(id: ActionId): string { return `spacelab.input-actions/${id.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}`; }
export const FLIGHT_ACTION_DEFINITIONS: readonly ActionDefinitionV2[] = Object.freeze(ACTION_DEFINITIONS.map(action =>
  Object.freeze({ id: flightActionId(action.id), label: action.name, category: action.category,
    mode: isFlightAction(action.id) || action.id === 'zoomIn' || action.id === 'zoomOut' ? 'held' as const : 'press' as const,
    defaultKeys: Object.freeze([...action.defaultKeys]) })));

/** Action meaning only: no device sampling, local seats, world stepping or browser listeners. */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeActions(FLIGHT_ACTION_DEFINITIONS);
  const mapping = new Map(ACTION_DEFINITIONS.map(action => [action.id, flightActionId(action.id)]));
  const legacy = new Map([...mapping].map(([old, id]) => [id, old]));
  const encode = (bindings: KeyBindings): Readonly<Record<string, readonly string[]>> => Object.freeze(Object.fromEntries(
    Object.entries(bindings).map(([id, keys]) => [mapping.get(id as ActionId) ?? id, Object.freeze([...keys])])));
  context.provide(FLIGHT_ACTIONS, Object.freeze({ definitions: FLIGHT_ACTION_DEFINITIONS,
    label: (id: ActionId) => ACTION_DEFINITIONS.find(action => action.id === id)?.name ?? id,
    load: () => encode(loadKeybindings()), reset: () => encode(resetKeybindings()),
    save(bindings: Readonly<Record<string, readonly string[]>>) {
      saveKeybindings(Object.fromEntries(Object.entries(bindings).map(([id, keys]) => [legacy.get(id) ?? id, [...keys]])) as KeyBindings);
    } }));
  context.contributeGuide({ id: 'actions', audience: 'creators', title: 'Portable flight actions',
    summary: 'Namespaced actions and legacy keyboard bindings.', asset: 'docs/creators/actions.json' });
}
