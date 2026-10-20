import type { Camera, CameraExtension, CameraTarget, RenderShip, Renderer, RendererProvider, ShaderPack } from './presentation';
import type { GhostEnd, GhostSample, Controls, State, Vec } from './state';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { ResolvedBody } from './universe';
import type { SurfaceProfile } from './surface';
import type { SimulationContext } from './context';
import type { WorldRead, WorldControl } from './engine';
import type { SessionRead, LocalSessionControl } from './session';
import type { Ship } from './world';
import type { FlightActionId, FlightControllerProfiles, FlightGamepad, LocalPlayerPreferences, LocalPlayersConfig } from './flight-input';
import type { LocalViewFactory } from './platform';
import type { FlightActionBindings } from './platform';

export interface SmartCandidate { readonly kind: 'ship' | 'body'; readonly id: string; readonly name: string; readonly position: Vec; readonly isPilotedShip?: boolean }
export interface SmartTargetMatch { readonly kind: 'ship' | 'body'; readonly id: string; readonly name: string; readonly isPilotedShip?: boolean }
export interface CameraFocusTarget { readonly kind: 'ship' | 'body'; readonly id: string; readonly name: string }
/** Flight adaptation of basic camera control; generic cameras use view.camera.
 * Smart target/focus state is optional presentation policy. A provider without that
 * add-on ignores smart assignments and retains ordinary follow/pan/zoom/inertia. */
export interface FlightCameraController extends Disposable {
  mode: string; pan: Vec; zoom: number; rotation: number; horizon: boolean; dragged: boolean;
  /** Fixed viewer orientation in radians. Follow, recenter, mode changes and new focus
   * release it; ordinary pan/zoom retain it. The chosen horizon preference is independent. */
  manualRotation?: number;
  last: Camera; panVelocity: Vec; smartTarget: SmartTargetMatch | undefined; focusTarget: CameraFocusTarget | undefined;
  readonly follow: boolean;
  label(cameras: readonly CameraExtension[]): string;
  scale(width: number, height: number): number;
  setZoom(zoom: number, maximum?: number): void;
  changeZoom(factor: number): void;
  followShip(): void; planetView(bodyRadius?: number): void; recenter(): void; clearFocus(): void;
  cycle(cameras: readonly CameraExtension[], bodyRadius?: number): void;
  retain(cameras: readonly CameraExtension[]): void;
  rebase(oldBody: Vec, newBody: Vec): void;
  drag(delta: Vec, body: Vec, ship: Vec, width: number, height: number): void;
  stopFling(): void;
  fling(screenVelocity: Vec, width: number, height: number, smartTarget?: SmartTargetMatch): void;
  update(options: { readonly body: Vec; readonly ship: Vec; readonly elapsed: number; readonly instant: boolean;
    readonly width: number; readonly height: number; readonly target?: CameraTarget; readonly focusPosition?: Vec }): Camera;
}
export interface FlightCameraFactory { create(): FlightCameraController }
export const FLIGHT_CAMERAS: ServiceKey<FlightCameraFactory> = Object.freeze({ slot: 'view.flight-camera', version: '1.0.0' });
/** Result of one completed tracing pass. `workMs` is wall-clock work, not simulated time;
 * `coarse` is true for a preview traced while the engine was burning. */
export interface PredictionSummary { end: GhostEnd; samples: number; workMs: number; coarse: boolean }
export interface PredictionPass { readonly samples: readonly GhostSample[]; readonly coarse: boolean; readonly workMs: number }
/** A progressive trajectory preview for one view. It traces on an isolated motion-context
 * clone (or `world.predictShip` when a world is passed) and never advances live authority.
 * Consumers read `path` and `pathEnd`; the remaining fields are diagnostics. `path` samples
 * are body-relative SI (metres, m/s, seconds of simulation time) in the frame each sample
 * names. Arrays are reused between passes: copy a path you need to keep. */
export interface FlightPrediction extends Disposable {
  pass: PredictionPass | undefined; passKey: string; pathKey: string; passCount: number; path: readonly GhostSample[]; pathEnd: GhostEnd;
  lastPass: PredictionSummary;
  /** Wall-clock milliseconds of tracing work allowed per `update`, from 0.1 to 16. */
  maxMs: number;
  /** Cancel the current pass and clear the path; the next `update` starts a new one. */
  invalidate(): void;
  /** Call once per rendered frame. Starts a new pass when the ship, body, surface, motion
   * model or relevant command epoch changed, otherwise continues the current one within
   * `maxMs`. `seconds` is the elapsed wall time used to earn sample work. Throws after dispose. */
  update(context: SimulationContext, state: State, activeBody: ResolvedBody, surface: SurfaceProfile | undefined,
    selectedShipId: string | undefined, seconds: number, engine: boolean, controls?: Controls, world?: WorldRead): void;
  /** Short status for a readout, such as `Full orbit · period 5400.0 s` or `Tracing · 120 points`. */
  text(state: State): string;
}
/** Creates independent previews. Each preview owns its job and cloned context; disposing the
 * preview or the provider closes both. `onComplete` runs once per finished pass. */
export interface PredictionFactory { create(onComplete: (summary: PredictionSummary) => void): FlightPrediction }
/** Progressive flight prediction, provided by `spacelab.flight-prediction` in Space Sim. */
export const PREDICTIONS: ServiceKey<PredictionFactory> = Object.freeze({ slot: 'view.prediction', version: '1.0.0' });
export interface FleetViewInput {
  readonly world: WorldRead; readonly time: number; readonly alpha: number; readonly paused: boolean; readonly skipId?: string;
  readonly playerId: string; readonly camera: Camera; readonly width: number; readonly height: number;
  previous(shipId: string): Ship | undefined; isRock?(ship: Ship): boolean; displayOffset(shipId: string): Vec;
  playerName(id: string): string | undefined; display?(state: State, bodyId: string): State;
  interpolate?(from: State, to: State, alpha: number, bodyId: string): State;
}
export interface FleetViewStats { ships: number; culledByOrbit: number; solved: number; reused: number; visible: number }
export interface FlightFleetView extends Disposable { readonly stats: FleetViewStats; build(input: FleetViewInput): RenderShip[] }
export interface FleetViewFactory { create(): FlightFleetView }
export const FLEET_VIEWS: ServiceKey<FleetViewFactory> = Object.freeze({ slot: 'view.fleet', version: '1.0.0' });
export interface FlightLocalSession extends SessionRead, Pick<LocalSessionControl, 'seatGuest' | 'unseatGuest' | 'guestControls' | 'spawnGuest' | 'respawnGuest'> { readonly world: WorldControl }
export interface FlightGuestPilot extends Disposable {
  readonly slot: number; readonly camera: FlightCameraController; readonly prediction: FlightPrediction; readonly fleetView: FlightFleetView;
  readonly pane: HTMLDivElement; canvas: HTMLCanvasElement;
  playerId: string | undefined; shipId: string | undefined; body: ResolvedBody | undefined; state: State | undefined; view: State | undefined;
  controls: Controls; renderer: Renderer | undefined; provider: RendererProvider | undefined; shaders: ShaderPack | undefined; problem: string;
  onPointerDown?: (event: PointerEvent) => boolean; onPointerMove?: (event: PointerEvent) => void; onPointerUp?: (event: PointerEvent) => void;
  ship(session: SessionRead): Ship | undefined;
  ensureShip(local: FlightLocalSession, presetId: string, godMode?: boolean): void;
  select(shipId: string | undefined): void; retrySpawn(): void; refresh(session: SessionRead): void;
}
export interface FlightSplitScreenHost {
  readonly gamepads?: FlightGamepad;
  /** Renderer replacement may replace the element; resolve the current surface at use. */
  primaryCanvas(): HTMLCanvasElement;
  session(): SessionRead; ownWorld(): FlightLocalSession | undefined; presetId(): string; isGodMode(): boolean;
  keyboardFlight(): Controls; resolveFlight?(slot: number, controls: Controls, elapsed: number): Controls;
  throttleAction?(slot: number, action: 'throttleCut' | 'throttleRecall' | 'throttleRemember'): void;
  releaseFlight?(slot: number): void; inputEnabled?(): boolean; consumesPad?(slot: number, pad: number): boolean;
  /** Release this seat's held device intent when its target or device assignment changes. */
  releaseInput?(slot: number): void;
  execute(action: FlightActionId): void; notify(text: string): void; changed(): void;
  onGuestPointer?(guest: FlightGuestPilot, action: 'down' | 'move' | 'up', event: PointerEvent): boolean | void;
  isSlotThrowing?(slot: number): boolean;
  isSessionError(error: unknown): error is Error;
}
export interface FlightSplitTuning {
  readonly joinButton?: number; readonly guestPredictionMs?: number; readonly wheelZoom?: number;
  readonly separateScreenRatio?: number; readonly mergeScreenRatio?: number;
  readonly separateDistance?: number; readonly mergeDistance?: number; readonly mergeDelayMs?: number;
}
export interface FlightSplitServices {
  readonly tuning?: FlightSplitTuning;
  readonly preferences: LocalPlayerPreferences; readonly profiles: FlightControllerProfiles;
  readonly cameras: FlightCameraFactory; readonly predictions: PredictionFactory; readonly fleets: FleetViewFactory;
  readonly layouts: Pick<LocalViewFactory, 'paneRects' | 'dynamicPaneRects'>;
}
export interface FlightSplitScreen extends Disposable {
  config: LocalPlayersConfig; readonly guests: ReadonlyMap<number, FlightGuestPilot>; readonly separatedGuests: ReadonlySet<number>;
  readonly active: number; readonly split: boolean; readonly keyboardSlot: number | undefined;
  isSeparated(slot: number): boolean; setConfig(next: LocalPlayersConfig): void; padsOf(slot: number): number[];
  pollPads(): void; join(pad: number): boolean; action(slot: number, action: FlightActionId): void; sync(): void;
  resetGuests(): void; layout(): void;
  updateDynamic(p1View: State | undefined, p1Body: ResolvedBody | undefined, camera: FlightCameraController, width: number, height: number, now?: number): { centroid?: Vec; zoomScale?: number };
  applyInput(elapsed: number): void;
  updateTags(player1: { readonly name: string; readonly text: string; readonly status: string }, describe: (guest: FlightGuestPilot) => { status: string; text: string }): void;
  rendererFor(guest: FlightGuestPilot, provider: RendererProvider | undefined, shaders: ShaderPack): Renderer | undefined;
}
export interface FlightSplitFactory { create(viewport: HTMLElement, host: FlightSplitScreenHost): FlightSplitScreen }
export const FLIGHT_SPLIT: ServiceKey<FlightSplitFactory> = Object.freeze({ slot: 'view.flight-split', version: '1.0.0' });
export interface ControllerMenu extends Disposable { open(): void; renderPlayers(): void; renderPad(): void }
export interface ControllerMenuOptions {
  readonly root: HTMLElement;
  readonly split: Pick<FlightSplitScreen, 'config' | 'setConfig'>;
  readonly gamepads?: FlightGamepad;
  pilotName(): string;
  isOpen(): boolean;
}
export interface ControllerMenuServices {
  readonly preferences: LocalPlayerPreferences;
  readonly profiles: FlightControllerProfiles;
  readonly actions: Pick<FlightActionBindings, 'label'>;
  formatButton(index: number, family: import('./flight-input').ControllerFamily): string;
}
export interface ControllerMenuFactory { create(options: ControllerMenuOptions): ControllerMenu }
export const CONTROLLER_MENUS: ServiceKey<ControllerMenuFactory> = Object.freeze({ slot: 'input.controller-menu', version: '1.0.0' });

/** Viewer-only anti-strobe orientation over the fixed prescribed rotation contract. */
export interface SpinViewControl extends Disposable {
 readonly holding: ReadonlySet<string>;
 update(bodies: readonly import('./state').Body[], time: number, elapsed: number, instant: boolean): void;
 angle(body: import('./state').Body, time: number): number;
 point(body: import('./state').Body, time: number, point: Vec): Vec;
 state(state: State, body: import('./state').Body): State;
 interpolate(from: State, to: State, alpha: number, body: import('./state').Body): State;
}
export interface SpinViewFactory { create(): SpinViewControl }
export const SPIN_VIEWS: ServiceKey<SpinViewFactory> = Object.freeze({ slot: 'view.spin', version: '1.0.0' });
