import type { ModuleState } from './motion';
import type { Ship, WorldEvent } from './world';
import type { RuleCommand } from './services';
import type { SparsePageDelta, SparsePageStore } from './state';

/** Cross-engine deterministic floating-point math operations supplied to authoritative world rules. */
export interface DeterministicMath {
  sin(x: number): number;
  cos(x: number): number;
  atan2(y: number, x: number): number;
  hypot(x: number, y: number): number;
  exp(x: number): number;
  sqrt(x: number): number;
}
/** Once per candidate tick, after all motion/SOI results. Each hook reads the same
 * detached candidate ships/events and its own prior namespace. Commands apply in
 * resolved hook order at the next control boundary. A shared failure aborts and
 * pauses the whole tick; per-ship motion faults retain their existing behavior. */
export interface WorldRuleHook {
  readonly modelIdentity: string;
  readonly initialState: ModuleState;
  /** Nonzero uint32 seed. RNG authority is committed/rolled back with state. */
  readonly seed: number;
  /** Optional sparse page size (1024, 2048, or 4096 bytes). */
  readonly pageSizeBytes?: 1024 | 2048 | 4096;
  /** Optional initial sparse page store. */
  readonly pageStore?: SparsePageStore;
  evaluate(input: Readonly<{
    tick: number; time: number; seconds: number; ships: readonly Ship[];
    events: readonly WorldEvent[]; state: ModuleState;
    math: DeterministicMath; random: () => number;
    pages?: SparsePageStore;
  }>): Readonly<{ state: ModuleState; commands?: readonly RuleCommand[]; dirtyPages?: readonly SparsePageDelta[] }>;
}
/** Resolved authoritative world-rule contribution bound to its owning module identity and version. */
export interface WorldRuleExtension {
  readonly moduleId: string;
  readonly version: string;
  readonly hook: WorldRuleHook;
}
/** Persisted authoritative world-rule namespace combining module state, deterministic PRNG uint32 state, and optional sparse pages. */
export interface WorldRuleState {
  readonly state: ModuleState;
  readonly randomState: number;
  readonly pages?: SparsePageStore;
  readonly dirtyHash?: string;
}

