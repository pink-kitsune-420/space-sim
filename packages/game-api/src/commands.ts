import type { Controls } from './state';
import type { Ship } from './world';

/** Bounded numeric parameter schema for an authoritative module command (`[minimum, maximum]`). */
export interface CommandParameter {
  readonly type: 'number';
  readonly default: number;
  readonly minimum: number;
  readonly maximum: number;
  readonly integer?: boolean;
}
/** Detached, read-only input passed to `CommandHook.resolve` at a fixed-step control boundary (`time` in simulation seconds). */
export interface CommandInput {
  /** Committed tick and simulation time when the host applies the command. */
  readonly tick: number;
  readonly time: number;
  /** Detached, read-only copy of the commanded ship, owned by the requesting player. */
  readonly ship: Ship;
  /** Validated arguments with declared defaults applied. */
  readonly args: Readonly<Record<string, number>>;
}
/** Applied to the commanded ship between fixed steps, through the same world operations
 * as built-in commands: held controls ([-1, 1] turn/throttle rate, engine) and throttle [0, 1]. */
export interface CommandEffect {
  readonly controls?: Controls;
  readonly throttle?: number;
}
/** An authoritative request a pilot can issue. Only the authoritative host runs `resolve`:
 * after checking the player owns the ship and the arguments match `parameters`. It is
 * synchronous and pure (no wall clock, IO, randomness or hidden state). A thrown error or
 * invalid effect refuses the command with module/command diagnostics and changes nothing.
 * Clients receive the result through ordinary snapshots; they never run `resolve`. */
export interface CommandHook {
  /** Local name; the command ID is `<module id>/<name>`. */
  readonly name: string;
  /** Button text. */
  readonly label: string;
  /** Suggested binding as a KeyboardEvent.code: `KeyA`–`KeyZ` or `Digit0`–`Digit9`.
   * Applications reject bindings that collide with their own controls. */
  readonly key?: string;
  /** At most eight numeric parameters. Missing arguments take their defaults. */
  readonly parameters?: Readonly<Record<string, CommandParameter>>;
  resolve(input: CommandInput): CommandEffect;
}
/** Resolved authoritative command contribution bound to its owning module identity and version. */
export interface CommandExtension {
  readonly moduleId: string;
  readonly version: string;
  /** `<module id>/<name>`. */
  readonly id: string;
  readonly hook: CommandHook;
}
