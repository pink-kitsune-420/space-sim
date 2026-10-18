import type { ModuleDataAdapter, ModuleInitializationV2 } from '@space-sim/game-api';

/** A bounded example, not an item catalogue or gameplay economy. */
export const inventory: ModuleDataAdapter = {
  name: 'items', version: 2, scope: 'player', initial: { count: 0 },
  validate(value) {
    if (value === null || Array.isArray(value) || typeof value !== 'object') return false;
    const record = value as { readonly [key: string]: unknown };
    return Object.keys(record).length === 1 && Number.isInteger(record.count) && (record.count as number) >= 0 && (record.count as number) <= 100;
  },
  migrations: { 1(value) { return { count: value }; } },
  authorize({ playerId, ownerId, command, args }) {
    return playerId === ownerId && command === 'discard' && Number.isInteger(args) && (args as number) > 0;
  },
  reduce({ state, args }) { return { count: (state as { readonly count: number }).count - (args as number) }; },
};
export default function initialize(context: ModuleInitializationV2): void { context.contributeData(inventory); }
