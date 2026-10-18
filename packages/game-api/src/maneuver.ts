import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { Controls, State, Vec, GhostSample } from './state';
import type { VehicleDefaults } from './universe';
/** Local intent policy. Call before each compatible fixed tick; the session validates
 * ownership/commands and advances the world. Disposal never mutates authority. */
export interface ManeuverBurnControl extends Disposable {
 readonly time: number; readonly delta: Vec; readonly start: number;
 readonly phase: 'aligning' | 'waiting' | 'burning' | 'complete';
 readonly remaining: number;
 next(state: State): { readonly controls: Controls; readonly throttle?: number };
}
export interface ManeuverBurnFactory { create(time: number, delta: Vec, vehicle: VehicleDefaults): ManeuverBurnControl }
export const MANEUVER_BURNS: ServiceKey<ManeuverBurnFactory> = Object.freeze({ slot: 'flight.maneuver-burn', version: '1.0.0' });

/** Velocity-relative prograde plus body-relative radial intent, in metres/second. */
export function maneuverDelta(sample: GhostSample, prograde: number, radial: number): Vec {
 const v = Math.hypot(sample.velocity.x, sample.velocity.y), r = Math.hypot(sample.position.x, sample.position.y);
 return { x: (v > 0 ? sample.velocity.x / v * prograde : 0) + (r > 0 ? sample.position.x / r * radial : 0),
  y: (v > 0 ? sample.velocity.y / v * prograde : 0) + (r > 0 ? sample.position.y / r * radial : 0) };
}
export interface ManeuverFlight {
 readonly world: import('./engine').WorldRead; readonly ship?: import('./world').Ship;
 readonly body: import('./universe').ResolvedBody;
 readonly enabled: boolean; readonly canWarp: boolean; readonly paused: boolean; readonly inputBlocked: boolean;
 readonly warp: number; readonly requestedWarp: number;
}
export interface ManeuverPlannerOptions {
 readonly container: HTMLElement; readonly id?: string;
 readonly shell?: Pick<import('./window-shell').WindowShell, 'addInstrument'>;
 flight(): ManeuverFlight;
 setWarp(factor: number): void;
 setThrottle(shipId: string, throttle: number): void;
 releaseControls(shipId: string): void;
 notify(text: string): void;
 event?(kind: string, detail: Record<string, unknown>): void;
}
export interface ManeuverPlannerControl extends Disposable {
 readonly executing: boolean;
 cancel(): void;
 step(manual: Controls): Controls;
 beforeAdvance(controls: Controls): void;
 place(pointer: Vec, camera: import('./presentation').Camera, origin: Vec, width: number, height: number, prediction: import('./flight-view').FlightPrediction): boolean;
 update(seconds: number, prediction: import('./flight-view').FlightPrediction, engine: boolean): void;
 snapshot(): import('./presentation').ManeuverPreview | undefined;
 diagnostics(): Record<string, unknown> | null;
}
export interface ManeuverPlannerFactory { create(options: ManeuverPlannerOptions): ManeuverPlannerControl }
export const MANEUVER_PLANNERS: ServiceKey<ManeuverPlannerFactory> = Object.freeze({ slot: 'view.maneuver-planner', version: '1.0.0' });
