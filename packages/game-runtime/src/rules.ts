/** Host-only (`packages/game-runtime`): world rule capture and staging. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); modules use `contributeWorldRule`. */
import type { DeterministicMath, Ship, SparsePageDelta, WorldEvent, WorldRuleExtension, WorldRuleState } from '../../game-api/src/index';
import { createSparsePageStore } from '../../game-api/src/index';
import { motionCopy, validateModuleState } from './motion';
import { sha256Bytes } from './authoritative';

/** Computes deterministic SHA-256 fingerprint for a list of modified sparse page deltas in a tick. */
export function hashSparsePageDeltas(deltas: readonly SparsePageDelta[]): string {
  if (deltas.length === 0) return '';
  const sorted = [...deltas].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const textEncoder = new TextEncoder();
  const encodedKeys = sorted.map(d => textEncoder.encode(d.key));
  let totalBytes = 0;
  for (let i = 0; i < sorted.length; i++) {
    totalBytes += 4 + encodedKeys[i]!.length + 4 + sorted[i]!.delta.byteLength;
  }
  const buffer = new Uint8Array(totalBytes);
  const view = new DataView(buffer.buffer);
  let offset = 0;
  for (let i = 0; i < sorted.length; i++) {
    const kBytes = encodedKeys[i]!;
    const delta = sorted[i]!.delta;
    view.setUint32(offset, kBytes.length, false);
    offset += 4;
    buffer.set(kBytes, offset);
    offset += kBytes.length;
    view.setUint32(offset, delta.byteLength, false);
    offset += 4;
    buffer.set(delta, offset);
    offset += delta.byteLength;
  }
  return sha256Bytes(buffer);
}

/** Clones an authoritative world rule state map, preserving Copy-on-Write page stores. Host-only (`packages/game-runtime`). */
export function copyRuleState(states: Readonly<Record<string, WorldRuleState>>): Record<string, WorldRuleState> {
  const copy: Record<string, WorldRuleState> = Object.create(null);
  for (const [k, v] of Object.entries(states)) {
    copy[k] = Object.freeze({
      state: motionCopy(v.state),
      randomState: v.randomState,
      ...(v.pages ? { pages: typeof (v.pages as any).clone === 'function' ? (v.pages as any).clone() : v.pages } : {}),
      ...(v.dirtyHash !== undefined ? { dirtyHash: v.dirtyHash } : {}),
    });
  }
  return copy;
}

/** Validates the world-rule schedule at world construction: at most 256 modules, one rule each, a non-empty `modelIdentity`, an `evaluate` function, an RNG seed from 1 to 4,294,967,295 and a valid initial `ModuleState`. Host-only (`packages/game-runtime`). */
export function captureWorldRules(rules: readonly WorldRuleExtension[]): readonly WorldRuleExtension[] {
  if (rules.length > 256) throw new Error('Rule schedule exceeds 256 modules');
  const ids = new Set<string>();
  return Object.freeze(rules.map(({ moduleId, version, hook }) => {
    if (!/^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/.test(moduleId) || ids.has(moduleId)) throw new Error(`Module ${moduleId}: invalid or duplicate rule namespace`);
    ids.add(moduleId);
    if (!hook.modelIdentity || typeof hook.modelIdentity !== 'string' || typeof hook.evaluate !== 'function'
      || !Number.isInteger(hook.seed) || hook.seed <= 0 || hook.seed > 0xffffffff) throw new Error(`Module ${moduleId}: invalid rule identity, callback or RNG seed`);
    if (hook.pageSizeBytes !== undefined && hook.pageSizeBytes !== 1024 && hook.pageSizeBytes !== 2048 && hook.pageSizeBytes !== 4096) {
      throw new Error(`Module ${moduleId}: invalid pageSizeBytes (must be 1024, 2048, or 4096)`);
    }
    if (hook.pageStore !== undefined && (!hook.pageStore || typeof hook.pageStore.getPage !== 'function' || typeof hook.pageStore.setPage !== 'function' || typeof hook.pageStore.markDirty !== 'function' || typeof hook.pageStore.commitDirtyPages !== 'function')) {
      throw new Error(`Module ${moduleId}: invalid pageStore`);
    }
    return Object.freeze({ moduleId, version, hook: Object.freeze({
      modelIdentity: hook.modelIdentity,
      initialState: validateModuleState(hook.initialState),
      seed: hook.seed,
      evaluate: hook.evaluate,
      ...(hook.pageSizeBytes !== undefined ? { pageSizeBytes: hook.pageSizeBytes } : {}),
      ...(hook.pageStore !== undefined ? { pageStore: hook.pageStore } : {}),
    }) });
  }));
}
/** Initial rule state and xorshift32 RNG state of a new world, keyed by module ID. Host-only (`packages/game-runtime`). */
export function initialRuleState(rules: readonly WorldRuleExtension[]): Readonly<Record<string, WorldRuleState>> {
  const states: Record<string, WorldRuleState> = Object.create(null);
  for (const r of rules) {
    const pages = r.hook.pageStore
      ? (typeof (r.hook.pageStore as any).clone === 'function' ? (r.hook.pageStore as any).clone() : r.hook.pageStore)
      : (r.hook.pageSizeBytes !== undefined ? createSparsePageStore(r.hook.pageSizeBytes) : undefined);
    states[r.moduleId] = Object.freeze({
      state: motionCopy(r.hook.initialState),
      randomState: r.hook.seed,
      ...(pages ? { pages } : {}),
    });
  }
  return Object.freeze(states);
}
/** Entire proposal is detached and validated before publishing ships, state or RNG. Each rule may draw its RNG
 * at most 4,096 times per evaluation. Errors read `Module <id> worldRule.evaluate tick <n>: <message>`; the
 * world then pauses with a `world-fault` event. Host-only (`packages/game-runtime`). */
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
      const pageStore = old.pages
        ? (typeof (old.pages as any).clone === 'function' ? (old.pages as any).clone() : old.pages)
        : (hook.pageSizeBytes !== undefined ? createSparsePageStore(hook.pageSizeBytes) : undefined);

      let result: ReturnType<typeof hook.evaluate>;
      try {
        result = hook.evaluate(Object.freeze({
          tick, time, seconds, ships: inputShips, events: inputEvents,
          state: motionCopy(old.state), math, random,
          ...(pageStore ? { pages: pageStore } : {}),
        }));
      } finally { active = false; }
      if (!result || Object.keys(result).some(k => k !== 'state' && k !== 'commands' && k !== 'dirtyPages')) throw new Error('invalid rule result');
      const state = validateModuleState(result.state);
      if (state.version !== hook.initialState.version) throw new Error('schema changes require restart/migration');

      let dirtyHash = old.dirtyHash;
      if (pageStore) {
        const deltas = pageStore.commitDirtyPages();
        if (deltas.length > 0) {
          dirtyHash = hashSparsePageDeltas(deltas);
        }
      }

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
      states[moduleId] = Object.freeze({
        state,
        randomState,
        ...(pageStore ? { pages: pageStore } : {}),
        ...(dirtyHash !== undefined ? { dirtyHash } : {}),
      });
    } catch (error) { throw new Error(`Module ${moduleId} worldRule.evaluate tick ${tick}: ${(error as Error).message}`, { cause: error }); }
  }
  return { ships: staged, state: Object.freeze(states) };
}

