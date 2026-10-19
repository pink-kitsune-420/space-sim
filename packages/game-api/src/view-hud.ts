import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { OverlayPrimitive } from './presentation';
import type { LocalViewBinding } from './platform';
import type { State, Vec } from './state';
export interface HudBinding extends LocalViewBinding { readonly session: object; readonly context?: object }
export interface HudSurface { readonly root: HTMLElement; readonly width: number; readonly height: number; readonly x: number; readonly y: number }
export interface HudAdapter<T = unknown> { readonly key: Pick<ServiceKey<T>, 'slot' | 'version'>; readonly service: T }
export interface HudInstrumentContext {
  readonly binding: HudBinding;
  use<T>(key: ServiceKey<T>): T;
}
export interface HudInstrument extends Disposable {
  cancel(): void;
  rebind(binding: HudBinding): void;
  resize(surface: HudSurface): void;
  update(elapsed: number): void;
  draw(into: OverlayPrimitive[]): void;
}
export interface HudInstrumentDefinition {
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
export interface ViewHudFactory extends Disposable { create(options: ViewHudOptions): ViewHud }
export const VIEW_HUD: ServiceKey<ViewHudFactory> = Object.freeze({slot:'ui.view-hud',version:'1.0.0'});

export interface ThrottleLeverState {
  readonly world: object; readonly shipId: string; readonly throttle: number; readonly locked: boolean; readonly firing: boolean;
}
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
export interface FlightHudAdapter {
  readonly pilot: number;
  navball(): FlightHudReadout | undefined;
  throttle(): ThrottleLeverState | undefined;
  /** Fit the independent lever's preferred pane-local position around host HUD obstacles.
   * Both input and result are CSS pixels; callers must not retain the scratch input. */
  placeThrottle?(preferred: Vec, surface: HudSurface): Vec;
  /** The adapter rechecks session ownership, target and input suppression at command time. */
  setThrottle(value: number): void;
  cancelGestures?(): void;
}
export const FLIGHT_HUD_STATE: ServiceKey<FlightHudAdapter> = Object.freeze({slot:'view.flight-hud-state',version:'1.0.0'});
export const NAVBALL_HUD: ServiceKey<HudInstrumentDefinition> = Object.freeze({slot:'hud.navball',version:'1.0.0'});
export const THROTTLE_HUD: ServiceKey<HudInstrumentDefinition> = Object.freeze({slot:'hud.throttle',version:'1.0.0'});
