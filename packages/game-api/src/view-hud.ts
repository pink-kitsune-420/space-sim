import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { OverlayPrimitive } from './presentation';
import type { LocalViewBinding } from './platform';
import type { State, Vec } from './state';
export interface HudBinding extends LocalViewBinding { readonly session: object; readonly context?: object }
/** The pane an instrument draws in. Sizes and offsets are CSS pixels; `root` is the DOM parent
 * the instrument may append its own elements to and must remove them on dispose. */
export interface HudSurface { readonly root: HTMLElement; readonly width: number; readonly height: number; readonly x: number; readonly y: number }
export interface HudAdapter<T = unknown> { readonly key: Pick<ServiceKey<T>, 'slot' | 'version'>; readonly service: T }
export interface HudInstrumentContext {
  readonly binding: HudBinding;
  /** Returns an adapter listed in the definition's `requires`; throws for any other key. */
  use<T>(key: ServiceKey<T>): T;
}
/** One instrument instance for one seat and viewport, owned by a ViewHud. A method that throws
 * disables only this instrument: the owner cancels and disposes it and reports the fault. */
export interface HudInstrument extends Disposable {
  /** Stop any pointer or keyboard gesture in progress; a new gesture is needed afterwards. */
  cancel(): void;
  /** The seat's session, player or target changed. Gestures were cancelled first. */
  rebind(binding: HudBinding): void;
  resize(surface: HudSurface): void;
  /** Once per rendered frame. `elapsed` is wall-clock seconds since the previous frame,
   * not simulation time; do not advance or write the world here. */
  update(elapsed: number): void;
  /** Append overlay shapes for this frame; shapes appended before a throw are discarded. */
  draw(into: OverlayPrimitive[]): void;
}
/** A selectable instrument, published as a service such as `THROTTLE_HUD`. Stateless and
 * reusable: the HUD owner calls `create` once per seat and disposes each instance. */
export interface HudInstrumentDefinition {
  /** Namespaced ID, such as `spacelab.throttle-hud`; unique within one selection. */
  readonly id: string;
  /** Exact-version, read-only view adapters. An incompatible view omits this contribution. */
  readonly requires: readonly Pick<ServiceKey<unknown>, 'slot' | 'version'>[];
  create(context: HudInstrumentContext): HudInstrument;
}
export interface ViewHud extends Disposable {
  readonly binding: HudBinding;
  readonly count: number;
  bind(binding: HudBinding): void;
  select(instruments: readonly HudInstrumentDefinition[]): void;
  /** Cancel instrument gestures without removing the current selection. */
  cancel?(): void;
  resize(surface: HudSurface): void;
  update(elapsed: number): void;
  draw(into: OverlayPrimitive[]): void;
}
export interface ViewHudOptions {
  readonly binding: HudBinding;
  readonly adapters: readonly HudAdapter[];
  readonly instruments?: readonly HudInstrumentDefinition[];
  fault?(id: string, error: unknown): void;
}
/** Creates one ViewHud per seat and viewport. Each ViewHud owns the instruments it creates. */
export interface ViewHudFactory extends Disposable { create(options: ViewHudOptions): ViewHud }
export const VIEW_HUD: ServiceKey<ViewHudFactory> = Object.freeze({slot:'ui.view-hud',version:'1.0.0'});

/** Throttle readout for one seat. `throttle` is a fraction from 0 to 1; Space Sim reports 0
 * while the engine is not firing. `locked` means the host is ignoring throttle input, for
 * example while paused. `world` and `shipId` identify the target so a gesture can detect a switch. */
export interface ThrottleLeverState {
  readonly world: object; readonly shipId: string; readonly throttle: number; readonly locked: boolean; readonly firing: boolean;
}
/** Keyboard increments as fractions of full thrust in (0, 1]. Defaults: 0.01 and 0.1. */
export interface ThrottleLeverOptions { readonly keyboardStep?: number; readonly pageStep?: number }
/** Detached/read-only flight readout in the body's inertial frame. No world-step or write API. */
export interface FlightHudReadout {
  readonly state: State; readonly radius: number; readonly spin: number; readonly clearance: number | null;
  readonly center: Vec; readonly scale: number; readonly cameraRotation: number;
  readonly frameSetting: number; readonly orientation: 'horizon' | 'camera';
  readonly accentColor?: string; readonly playerLabel?: string; readonly trajectory?: string;
  readonly pinned: boolean; readonly dragging: boolean; readonly editing: boolean;
  readonly maneuver?: number;
}
/** Per-seat flight bridge supplied by the host as the `view.flight-hud-state` adapter.
 * Reads return detached values or undefined when the seat has no flyable target. */
export interface FlightHudAdapter {
  /** Zero-based local seat index; Player 1 is 0. */
  readonly pilot: number;
  navball(): FlightHudReadout | undefined;
  throttle(): ThrottleLeverState | undefined;
  /** Fit the independent lever's preferred pane-local position around host HUD obstacles.
   * Both input and result are CSS pixels; callers must not retain the scratch input. */
  placeThrottle?(preferred: Vec, surface: HudSurface): Vec;
  /** Request thrust as a fraction from 0 to 1. The adapter rechecks session ownership, target
   * and input suppression at command time and ignores out-of-range or locked requests. */
  setThrottle(value: number): void;
  cancelGestures?(): void;
}
/** Host adapter for flight instruments. Declare it in `HudInstrumentDefinition.requires`. */
export const FLIGHT_HUD_STATE: ServiceKey<FlightHudAdapter> = Object.freeze({slot:'view.flight-hud-state',version:'1.0.0'});
export const NAVBALL_HUD: ServiceKey<HudInstrumentDefinition> = Object.freeze({slot:'hud.navball',version:'1.0.0'});
/** Per-seat throttle lever instrument, provided by `spacelab.throttle-hud` in Space Sim. */
export const THROTTLE_HUD: ServiceKey<HudInstrumentDefinition> = Object.freeze({slot:'hud.throttle',version:'1.0.0'});
