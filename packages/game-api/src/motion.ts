import type { Body, Controls, State, Vec } from './state';
import type { MotionServices } from './services';
import type { SurfaceProfile } from './surface';

export type ModuleValue = null | boolean | number | string | readonly ModuleValue[] | { readonly [key: string]: ModuleValue };
/** Per-ship authoritative state. Each namespace is limited to 16 KiB of JSON. */
export interface ModuleState { readonly version: number; readonly value: ModuleValue }
export interface MotionStep {
  readonly state: State;
  readonly controls: Controls;
  readonly seconds: number;
  readonly body: Body;
  readonly surface?: SurfaceProfile;
}
export interface ForceEvaluation {
  /** Scheduler boundary tick; time is the actual integrator stage epoch in seconds. */
  readonly tick: number;
  readonly time: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly body: Body;
  readonly controls: Controls;
  readonly state: ModuleState;
}
/** Synchronous, pure callbacks: no hidden mutable authority, wall clock or random IO.
 * Acceleration is body-local m/s², evaluated at KDK kicks (also fractional contacts).
 * Each component is finite and at most 10,000 m/s² in magnitude. All evaluations in
 * one outer step read the same state; commit runs once after verified motion.
 * Inputs are detached/read-only. Exceptions or invalid outputs abort this ship's step.
 * Work must be bounded by the author; synchronous JS cannot be preempted. */
export interface ForceHook {
  /** Include every force parameter in this local cache identity. */
  readonly modelIdentity: string;
  readonly initialState: ModuleState;
  evaluate(input: ForceEvaluation): Vec;
  commit?(input: Readonly<MotionStep & { readonly next: State; readonly moduleState: ModuleState }>): ModuleState;
}
/** Identity and order come from the resolved registry, one hook per module. */
export interface ForceExtension {
  readonly moduleId: string;
  readonly version: string;
  readonly hook: ForceHook;
}
/** The default numerical/contact kernel, with the active force schedule. A replacement
 * may call it for verified terrain/water behavior, or supply its own bounded motion.
 * Calling it does not commit hook state; the outer motion boundary owns that commit. */
export type NumericalKernel = (input: MotionStep) => State;
export interface DynamicsServices {
  readonly numerical: NumericalKernel;
  /** For replacement integrators that accept force contributions. Same staged state
   * and validation as the built-in kernel; position/velocity are stage values. */
  acceleration(time: number, position: Vec, velocity: Vec): Vec;
}
export interface DynamicsProvider {
  readonly id: string;
  readonly version: string;
  readonly modelIdentity: string;
  readonly supportsForces: boolean;
  step(input: MotionStep, services: DynamicsServices): State;
}
export interface MotionContextOptions {
  readonly services?: Partial<MotionServices>;
  /** Shared-world hooks require ordinary stepping even for stationary ships. */
  readonly worldRules?: boolean;
  readonly worldRuleIdentity?: string;
  readonly dynamics?: DynamicsProvider;
  /** Already resolved dependency/before/after order, captured at construction. */
  readonly forces?: readonly ForceExtension[];
}
export interface MotionCapabilities {
  readonly analyticCoast: boolean;
  readonly rails: boolean;
  readonly orbitalDiagnostics: boolean;
  readonly legacyCompatible: boolean;
}
