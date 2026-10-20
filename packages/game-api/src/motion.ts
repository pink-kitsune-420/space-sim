import type { Body, Controls, State, Vec } from './state';
import type { MotionServices } from './services';
import type { SurfaceProfile } from './surface';

/** JSON-serializable value primitive or tree stored in module state. */
export type ModuleValue = null | boolean | number | string | readonly ModuleValue[] | { readonly [key: string]: ModuleValue };
/** Per-ship authoritative state. Each namespace is limited to 16 KiB of JSON. */
export interface ModuleState { readonly version: number; readonly value: ModuleValue }
/** State and control input for advancing one ship by a fixed simulation time step in SI units. */
export interface MotionStep {
  readonly state: State;
  readonly controls: Controls;
  readonly seconds: number;
  readonly body: Body;
  readonly surface?: SurfaceProfile;
}
/** Staged kinematic state and controls evaluated at integration kick stages in body-local coordinates. */
export interface ForceEvaluation {
  /** Scheduler boundary tick; time is the actual integrator stage epoch in seconds. */
  readonly tick: number;
  readonly time: number;
  readonly position: Vec;
  readonly velocity: Vec;
  /** Stage heading in rad and rotation rate in rad/s (inertial frame). */
  readonly heading: number;
  readonly angularVelocity: number;
  readonly body: Body;
  readonly controls: Controls;
  readonly state: ModuleState;
}
/** Force hook output: body-local linear acceleration in m/s² (finite, at most 10,000 per component) and an optional angular acceleration in rad/s² (finite, at most 1,000) added to the ship's rotation rate. A plain `Vec` is a valid result. */
export interface GeneralizedForce {
  readonly x: number;
  readonly y: number;
  readonly angularAcceleration?: number;
}
/** Synchronous, pure callbacks: no hidden mutable authority, wall clock or random IO.
 * Acceleration is body-local m/s², evaluated at KDK kicks (also fractional contacts).
 * Each component is finite and at most 10,000 m/s² in magnitude; `angularAcceleration`
 * is likewise finite and at most 1,000 rad/s² and is integrated into `State.angularVelocity` and `heading`. All evaluations in
 * one outer step read the same state; commit runs once after verified motion.
 * Inputs are detached/read-only. Exceptions or invalid outputs abort this ship's step.
 * Work must be bounded by the author; synchronous JS cannot be preempted. */
export interface ForceHook {
  /** Include every force parameter in this local cache identity. */
  readonly modelIdentity: string;
  readonly initialState: ModuleState;
  evaluate(input: ForceEvaluation): GeneralizedForce;
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
/** Services provided to replacement integrators, including the base numerical kernel and acceleration query. */
export interface DynamicsServices {
  readonly numerical: NumericalKernel;
  /** For replacement integrators that accept force contributions. Same staged state
   * and validation as the built-in kernel; position/velocity are stage values. */
  acceleration(time: number, position: Vec, velocity: Vec): Vec;
}
/** Integrator extension providing custom numerical or analytic flight stepping. */
export interface DynamicsProvider {
  readonly id: string;
  readonly version: string;
  readonly modelIdentity: string;
  readonly supportsForces: boolean;
  step(input: MotionStep, services: DynamicsServices): State;
}
/** Configuration options supplied when creating a per-ship or headless simulation motion context. */
export interface MotionContextOptions {
  readonly services?: Partial<MotionServices>;
  /** Shared-world hooks require ordinary stepping even for stationary ships. */
  readonly worldRules?: boolean;
  readonly worldRuleIdentity?: string;
  readonly dynamics?: DynamicsProvider;
  /** Already resolved dependency/before/after order, captured at construction. */
  readonly forces?: readonly ForceExtension[];
}
/** Capabilities reported by a simulation context describing available analytic coasting, rails, and diagnostics. */
export interface MotionCapabilities {
  readonly analyticCoast: boolean;
  readonly rails: boolean;
  readonly orbitalDiagnostics: boolean;
  readonly legacyCompatible: boolean;
}
