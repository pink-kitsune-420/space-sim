import type { Disposable } from './modules';
import type { Camera, RenderThemeOptions } from './presentation';
import type { Vec } from './state';
import type { ServiceKey } from './modules-v2';
import type { ControllerFamily, FlightActionId, FlightGamepad, FlightTouch, FlightKeyboardOptions, FlightControllerProfiles, LocalPlayerPreferences } from './flight-input';
import type { WindowContentDefinition } from './window-content';

/** Device-local input. elapsed is wall seconds, never a simulation step. */
export interface InputFrame {
  readonly elapsed: number;
  readonly pilot: number;
  readonly flightAllowed: boolean;
  readonly shortcutsAllowed: boolean;
}
export interface ActionSink { set(action: string, value: number): void }
export interface ActionDefinitionV2 {
  readonly id: string;
  readonly label: string;
  readonly category: 'flight' | 'warp' | 'view' | 'system';
  readonly mode: 'held' | 'axis' | 'press';
  readonly defaultKeys: readonly string[];
}
export interface InputSource extends Disposable {
  readonly name: string;
  /** At most 256 writes. Output is committed only after a successful synchronous sample. */
  sample(frame: InputFrame, into: ActionSink): void;
  release(pilot?: number): void;
}
export interface PilotRegistry {
  readonly count: number;
  playerId(pilot: number): string | undefined;
  assign(pilot: number, device: string): void;
  release(pilot?: number): void;
}
export const CORE_PILOTS: ServiceKey<PilotRegistry> = Object.freeze({ slot: 'core.pilots', version: '1.0.0' });
/** Host callbacks read the active session and persisted local device preferences.
 * Assigning a device must never create a network player or grant ownership. */
export interface LocalPilotHost {
  count(): number;
  playerId(pilot: number): string | undefined;
  assign(pilot: number, device: string): void;
  release(pilot?: number): void;
}
export interface LocalPilotFactory {
  create(host: LocalPilotHost): PilotRegistry & Disposable;
  preferences(): LocalPlayerPreferences;
}
export const LOCAL_PILOTS: ServiceKey<LocalPilotFactory> = Object.freeze({ slot: 'input.local-pilots', version: '1.0.0' });

/** Local routing identity. A seat or viewport never grants session ownership. */
export interface ControlTargetBinding {
  readonly seatId: string;
  readonly playerId: string;
  readonly entityId: string;
  readonly viewportId?: string;
}
/** Explicit entity/session adapter. Implementations validate ownership again when
 * accepting intent. release clears only intent associated with this binding. */
export interface ControlTargetAdapter {
  readonly schema: 'spacelab-control-target/1';
  canControl(binding: ControlTargetBinding): boolean;
  actions(binding: ControlTargetBinding): readonly string[];
  setAction(binding: ControlTargetBinding, action: string, value: number): void;
  release(binding: ControlTargetBinding): void;
}
/** One independent instance per local seat. This service never steps a world. */
export interface PlayerInputBinding {
  /** Local device seat, separate from every identity in ControlTargetBinding. */
  readonly pilot: number;
  /** Borrowed, ordered sources. Last write wins; sources retain provider ownership. */
  readonly sources: readonly InputSource[];
}
export interface PlayerController extends Disposable {
  readonly target: ControlTargetBinding | undefined;
  select(target: ControlTargetBinding | undefined): void;
  /** Reassignment clears prior device and command intent, including rejected changes. */
  bindInput(input: PlayerInputBinding | undefined): void;
  /** Wall-time sampling only. Only declared target actions reach the adapter. */
  sample(frame: Omit<InputFrame, 'pilot'>): void;
  set(action: string, value: number): void;
  release(): void;
}
export interface PlayerControllerFactory {
  create(adapter: ControlTargetAdapter, input?: PlayerInputBinding): PlayerController;
}
export const PLAYER_CONTROLLERS: ServiceKey<PlayerControllerFactory> = Object.freeze({ slot: 'input.controller', version: '1.0.0' });
/** Immutable mapping for one keyboard device. Recreate on supported configuration changes. */
export interface KeyboardInputOptions {
  readonly actions: readonly ActionDefinitionV2[];
  readonly bindings?: Readonly<Record<string, readonly string[]>>;
  pilot(): number | undefined;
  /** False while the host owns input for a modal, editor or capture prompt. */
  capture?(): boolean;
}
export interface KeyboardInputFactory {
  create(options: KeyboardInputOptions): InputSource;
  readonly reservedKeys: ReadonlySet<string>;
  bindFlight(options: FlightKeyboardOptions): Disposable;
}
export const KEYBOARD_INPUT: ServiceKey<KeyboardInputFactory> = Object.freeze({ slot: 'input.keyboard', version: '1.0.0' });
export interface FlightActionBindings {
  readonly definitions: readonly ActionDefinitionV2[];
  load(): Readonly<Record<string, readonly string[]>>;
  save(bindings: Readonly<Record<string, readonly string[]>>): void;
  reset(): Readonly<Record<string, readonly string[]>>;
  label(action: FlightActionId): string;
}
export const FLIGHT_ACTIONS: ServiceKey<FlightActionBindings> = Object.freeze({ slot: 'input.flight-actions', version: '1.0.0' });
/** One physical axis or button mapped to an active namespaced action. */
export type GamepadActionBinding = { readonly action: string; readonly invert?: boolean } &
  ({ readonly axis: number; readonly button?: never } | { readonly button: number; readonly axis?: never });
export interface GamepadInputOptions {
  readonly actions: readonly ActionDefinitionV2[];
  readonly bindings: readonly GamepadActionBinding[];
  readonly deadzone: number;
  pad(pilot: number): number | undefined;
  capture?(): boolean;
}
export interface GamepadInputFactory {
  create(options: GamepadInputOptions): InputSource;
  createFlight(): FlightGamepad;
  formatButton(index: number, family: ControllerFamily): string;
}
export const GAMEPAD_INPUT: ServiceKey<GamepadInputFactory> = Object.freeze({ slot: 'input.gamepad', version: '1.0.0' });
export const FLIGHT_PROFILES: ServiceKey<FlightControllerProfiles> = Object.freeze({ slot: 'input.flight-profiles', version: '1.0.0' });
export interface TouchActionBinding {
  readonly action: string;
  readonly element: HTMLElement;
  readonly gesture: 'hold' | 'axis-x' | 'axis-y';
  readonly invert?: boolean;
}
export interface TouchInputOptions {
  readonly actions: readonly ActionDefinitionV2[];
  readonly bindings: readonly TouchActionBinding[];
  pilot(): number | undefined;
  capture?(): boolean;
}
export interface TouchInputFactory {
  create(options: TouchInputOptions): InputSource;
  createFlight(): FlightTouch;
}
export const TOUCH_INPUT: ServiceKey<TouchInputFactory> = Object.freeze({ slot: 'input.touch', version: '1.0.0' });

/** System coordinates in metres, orientation in radians; a read must never step a world. */
export interface ViewTargetTransform { readonly position: Vec; readonly orientation: number }
export interface LocalCameraInput {
  readonly elapsed: number; readonly width: number; readonly height: number;
  transform(targetId: string): ViewTargetTransform | undefined;
}
export interface LocalViewCamera extends Disposable {
  readonly viewportId: string;
  readonly targetId: string | undefined;
  readonly mode: 'follow' | 'free';
  focus(targetId: string | undefined): void;
  changeZoom(factor: number): void;
  frame(input: LocalCameraInput): Camera;
}
export interface LocalCameraFactory { create(viewportId: string): LocalViewCamera }
export const VIEW_CAMERAS: ServiceKey<LocalCameraFactory> = Object.freeze({ slot: 'view.camera', version: '1.0.0' });
export type TwoPlayerLayout = 'auto' | 'side' | 'stacked';
export type ScreenMode = 'dynamic' | 'split';
export interface PaneRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
export interface LocalViewBinding {
  readonly viewportId: string; readonly seatId: string; readonly playerId?: string; readonly targetId?: string;
}
/** A surface borrows read-only world state from its renderer adapter. */
export interface LocalViewSurface extends Disposable {
  resize(rect: PaneRect, width: number, height: number, visible: boolean): void;
  draw(camera: Camera): void;
}
export interface LocalViewOptions {
  readonly bindings: readonly LocalViewBinding[];
  readonly layout: TwoPlayerLayout;
  readonly mode: ScreenMode;
  surface(binding: LocalViewBinding): LocalViewSurface;
}
export interface LocalViews extends Disposable {
  readonly count: number;
  /** Connected support is independent of whether more than one pane is visible. */
  readonly splitActive: boolean;
  camera(viewportId: string): LocalViewCamera;
  reflow(width: number, height: number, separatedGuests?: ReadonlySet<number>): void;
  render(elapsed: number, transform: LocalCameraInput['transform']): void;
}
export interface LocalViewFactory {
  create(options: LocalViewOptions): LocalViews;
  paneRects(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[];
  dynamicPaneRects(count: number, separatedGuests: ReadonlySet<number>, layout: TwoPlayerLayout, width: number, height: number): { rects: PaneRect[]; visible: boolean[] };
}
export const LOCAL_VIEWS: ServiceKey<LocalViewFactory> = Object.freeze({ slot: 'view.local', version: '1.0.0' });
/** Text and backpressure contract shared by browser and headless adapters. */
export interface TextConnection {
  readonly label: string;
  readonly bufferedAmount: number;
  send(text: string): void;
  close(reason?: string): void;
  onmessage: ((text: string) => void) | null;
  onclose: ((reason: string) => void) | null;
}
export interface TransportProvider {
  readonly name: string;
  readonly schemes: readonly string[];
  /** Signal owns pending IO and the established connection's lifetime. */
  connect(address: string, signal: AbortSignal): Promise<TextConnection>;
  /** Signal owns pending IO and the listener; accepted peers remain separately owned. */
  listen?(address: string, accept: (peer: TextConnection) => void, signal: AbortSignal): Promise<Disposable>;
}
export const WEBSOCKET_TRANSPORT: ServiceKey<TransportProvider> = Object.freeze({ slot: 'net.websocket', version: '1.0.0' });
export interface ServerAdvert {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly players: number;
  readonly maxPlayers: number;
  readonly protocol: string;
}
export interface DiscoveryProvider {
  readonly name: string;
  scan(emit: (advert: ServerAdvert) => void, signal: AbortSignal): Promise<void>;
}
/** @deprecated Use ManualSignalingProvider: reply codes must precede connection. */
export interface InviteProvider {
  create(signal: AbortSignal): Promise<{
    readonly offer: string;
    accept(reply: string): Promise<TextConnection>;
    dispose(): void;
  }>;
  answer(offer: string, signal: AbortSignal): Promise<{
    readonly reply: string;
    readonly connection: TextConnection;
  }>;
}
export type UiControl =
  | { readonly kind: 'text'; readonly id: string; readonly text: string }
  | { readonly kind: 'button' | 'toggle'; readonly id: string; readonly label: string; readonly action: string }
  | { readonly kind: 'slider'; readonly id: string; readonly label: string; readonly action: string;
      readonly minimum: number; readonly maximum: number; readonly step: number }
  | { readonly kind: 'canvas'; readonly id: string; readonly label: string };
export interface WindowDefinition {
  readonly name: string;
  readonly title: string;
  readonly controls: readonly UiControl[];
  readonly content?: readonly WindowContentDefinition[];
}
/** The browser adapter supplies raw DOM separately; this contract stays headless-safe. */
export interface UiShell {
  open(windowId: string): void;
  close(windowId: string): void;
  set(id: string, value: string | number | boolean): void;
  onAction(id: string, callback: (value: string | number | boolean) => void): Disposable;
}
export interface TrustedDomShell {
  mountTrusted(windowId: string, mount: (root: HTMLElement) => Disposable): Disposable;
}
export interface ThemeService {
  current(): Readonly<RenderThemeOptions>;
  set(value: Readonly<RenderThemeOptions>): void;
  subscribe(change: (theme: Readonly<RenderThemeOptions>) => void): Disposable;
}
export const CORE_UI: ServiceKey<UiShell> = Object.freeze({ slot: 'core.ui', version: '1.0.0' });
export const CORE_DOM: ServiceKey<TrustedDomShell> = Object.freeze({ slot: 'core.dom', version: '1.0.0' });
export const CORE_THEME: ServiceKey<ThemeService> = Object.freeze({ slot: 'core.theme', version: '1.0.0' });
export interface GuidePage {
  readonly id: string;
  readonly audience: 'players' | 'creators';
  readonly title: string;
  readonly summary: string;
  readonly asset: string;
}
export interface MaterialDefinition {
  readonly name: string;
  readonly bodyIds: readonly string[];
  readonly fragmentAsset: string;
  readonly uniforms: Readonly<Record<string, number>>;
}
export interface PostEffectDefinition {
  readonly name: string;
  readonly fragmentAsset: string;
  readonly after: readonly string[];
  readonly scale: 0.5 | 1;
  readonly uniforms: Readonly<Record<string, number>>;
}
/** Resolved inert assets; IDs and ordering retain their owning module namespace. */
export interface RenderMaterial extends Omit<MaterialDefinition, 'name' | 'fragmentAsset'> { readonly id: string; readonly fragment: string }
export interface RenderPostEffect extends Omit<PostEffectDefinition, 'name' | 'fragmentAsset'> { readonly id: string; readonly fragment: string }
export interface ShaderEffects {
  /** Atomic compilation. Sources implement material(vec2) or effect(vec2,vec4), with
   * fixed uniforms; the renderer owns masks, framebuffers and all graphics objects. */
  configure(materials: readonly RenderMaterial[], post: readonly RenderPostEffect[]): void;
}
