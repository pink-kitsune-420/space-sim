import type { ModuleState } from './motion';
import type { Ship, WorldEvent } from './world';
import type { RuleCommand } from './services';

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
  evaluate(input: Readonly<{
    tick: number; time: number; seconds: number; ships: readonly Ship[];
    events: readonly WorldEvent[]; state: ModuleState;
    math: DeterministicMath; random: () => number;
  }>): Readonly<{ state: ModuleState; commands?: readonly RuleCommand[] }>;
}
export interface WorldRuleExtension {
  readonly moduleId: string;
  readonly version: string;
  readonly hook: WorldRuleHook;
}
export interface WorldRuleState {
  readonly state: ModuleState;
  readonly randomState: number;
}
