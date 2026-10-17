import type { DeterministicMath, Ship, WorldEvent, WorldRuleExtension, WorldRuleState } from '../../game-api/src/index';
import { motionCopy, validateModuleState } from './motion';

export function captureWorldRules(rules: readonly WorldRuleExtension[]): readonly WorldRuleExtension[] {
  if (rules.length > 256) throw new Error('Rule schedule exceeds 256 modules');
  const ids = new Set<string>();
  return Object.freeze(rules.map(({ moduleId, version, hook }) => {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(moduleId) || ids.has(moduleId)) throw new Error(`Module ${moduleId}: invalid or duplicate rule namespace`);
    ids.add(moduleId);
    if (!hook.modelIdentity || typeof hook.modelIdentity !== 'string' || typeof hook.evaluate !== 'function'
      || !Number.isInteger(hook.seed) || hook.seed <= 0 || hook.seed > 0xffffffff) throw new Error(`Module ${moduleId}: invalid rule identity, callback or RNG seed`);
    return Object.freeze({ moduleId, version, hook: Object.freeze({ modelIdentity: hook.modelIdentity,
      initialState: validateModuleState(hook.initialState), seed: hook.seed, evaluate: hook.evaluate }) });
  }));
}
export function initialRuleState(rules: readonly WorldRuleExtension[]): Readonly<Record<string, WorldRuleState>> {
  return motionCopy(Object.fromEntries(rules.map(r => [r.moduleId, { state: r.hook.initialState, randomState: r.hook.seed }])));
}
/** Entire proposal is detached and validated before publishing ships, state or RNG. */
export function stageWorldRules(rules: readonly WorldRuleExtension[], prior: Readonly<Record<string, WorldRuleState>>,
  ships: readonly Ship[], events: readonly WorldEvent[], tick: number, time: number, seconds: number, math: DeterministicMath) {
  const inputShips = motionCopy(ships), inputEvents = motionCopy(events);
  const staged = new Map(ships.map(s => [s.id, s]));
  const states: Record<string, WorldRuleState> = Object.create(null);
  for (const { moduleId, hook } of rules) {
    try {
      const old = prior[moduleId];
      if (!old || old.state.version !== hook.initialState.version || !Number.isInteger(old.randomState)
        || old.randomState <= 0 || old.randomState > 0xffffffff) throw new Error('unsupported rule state or RNG');
      let randomState = old.randomState, active = true, draws = 0;
      const random = () => {
        if (!active) throw new Error('RNG used outside rule evaluation');
        if (++draws > 4096) throw new Error('RNG work limit exceeded');
        randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5;
        randomState >>>= 0;
        return randomState / 0x100000000;
      };
      let result: ReturnType<typeof hook.evaluate>;
      try { result = hook.evaluate(Object.freeze({ tick, time, seconds, ships: inputShips, events: inputEvents,
        state: motionCopy(old.state), math, random })); }
      finally { active = false; }
      if (!result || Object.keys(result).some(k => k !== 'state' && k !== 'commands')) throw new Error('invalid rule result');
      const state = validateModuleState(result.state);
      if (state.version !== hook.initialState.version) throw new Error('schema changes require restart/migration');
      if (result.commands !== undefined && (!Array.isArray(result.commands) || result.commands.length > 1024)) throw new Error('invalid command list (maximum 1024)');
      for (const command of result.commands ?? []) {
        if (!command || Object.keys(command).some(k => !['shipId', 'controls', 'throttle'].includes(k))) throw new Error('unknown rule command field');
        const ship = staged.get(command.shipId);
        if (!ship || ship.fault) throw new Error(`invalid command ship ${command.shipId}`);
        const c = command.controls;
        if (c && (Object.keys(c).some(k => !['turn', 'throttle', 'engine'].includes(k))
          || !Number.isFinite(c.turn) || Math.abs(c.turn) > 1 || !Number.isFinite(c.throttle)
          || Math.abs(c.throttle) > 1 || typeof c.engine !== 'boolean')) throw new Error('invalid rule controls');
        if (command.controls !== undefined && !c) throw new Error('invalid rule controls');
        if (command.throttle !== undefined && (!Number.isFinite(command.throttle) || command.throttle < 0 || command.throttle > 1)) throw new Error('invalid rule throttle');
        staged.set(ship.id, { ...ship, ...(c ? { controls: motionCopy(c) } : {}),
          ...(command.throttle !== undefined ? { state: { ...ship.state, throttle: command.throttle, revision: ship.state.revision + 1 } } : {}) });
      }
      states[moduleId] = Object.freeze({ state, randomState });
    } catch (error) { throw new Error(`Module ${moduleId} worldRule.evaluate tick ${tick}: ${(error as Error).message}`, { cause: error }); }
  }
  return { ships: staged, state: Object.freeze(states) };
}
