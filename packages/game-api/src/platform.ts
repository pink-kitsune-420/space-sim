import type { Disposable } from './modules';
import type { Camera, RenderThemeOptions } from './presentation';
import type { Vec } from './state';
import type { ServiceKey } from './modules-v2';
import type { ControllerFamily, FlightActionId, FlightGamepad, FlightTouch, FlightKeyboardOptions, FlightControllerProfiles, LocalPlayerPreferences } from './flight-input';
import type { WindowContentDefinition } from './window-content';

/** Device-local input frame delivered to input sources. `elapsed` is wall-clock seconds
 * (never a simulation step dt). `pilot` is the local seat index (0–3). */
export interface InputFrame {
  /** Wall-clock seconds since the prior frame. Units: seconds. */
  readonly elapsed: number;
  /** Local seat index in [0, 3]. */
  readonly pilot: number;
  /** True when continuous flight control inputs should be sampled. */
  readonly flightAllowed: boolean;
  /** True when global UI and view shortcut actions should be sampled. */
  readonly shortcutsAllowed: boolean;
}

/** Synchronous receiver for action values written by an InputSource during sample(). */
export interface ActionSink {
  /** Writes an analog or digital action value. Clamped by consumers to [-1, 1]. */
  set(action: string, value: number): void;
}

/** Namespaced action definition contributed by platform-tier input modules. */
export interface ActionDefinitionV2 {
  /** Namespaced action identifier (e.g. `spacelab.input-actions/engine`). */
  readonly id: string;
  /** Friendly human-readable label shown in control configuration menus. */
  readonly label: string;
  /** Action category grouping for UI filtering and suppression. */
  readonly category: 'flight' | 'warp' | 'view' | 'system';
  /** Action trigger mode: continuous hold, bipolar axis, or discrete press. */
  readonly mode: 'held' | 'axis' | 'press';
  /** Default KeyboardEvent.code bindings or modifier chords. */
  readonly defaultKeys: readonly string[];
}

/** Device sampler that translates hardware events or DOM interactions into namespaced actions. */
export interface InputSource extends Disposable {
  /** Human-readable name identifying the hardware source type (e.g. 'keyboard', 'gamepad', 'touch'). */
  readonly name: string;
  /** Synchronous sampling pass writing at most 256 action entries into the sink. */
  sample(frame: InputFrame, into: ActionSink): void;
  /** Releases held inputs for the specified local pilot seat, or all seats if omitted. */
  release(pilot?: number): void;
}

/** Registry managing active local player seats and input device assignments. */
export interface PilotRegistry {
  /** Number of active local player seats in [1, 4]. */
  readonly count: number;
  /** Returns the session player ID for the specified local seat index. */
  playerId(pilot: number): string | undefined;
  /** Assigns an input device ('auto', 'keyboard', 'none', or 'pad:N') to a seat. */
  assign(pilot: number, device: string): void;
  /** Releases held inputs for a seat or all seats. */
  release(pilot?: number): void;
}

/** Host service key providing core local pilot registration. */
export const CORE_PILOTS: ServiceKey<PilotRegistry> = Object.freeze({ slot: 'core.pilots', version: '1.0.0' });

/** Host callbacks that read active session identities and device assignments.
 * Assigning a device must never create a network player or grant session ownership. */
export interface LocalPilotHost {
  /** Returns active local player seat count in [1, 4]. */
  count(): number;
  /** Returns session player ID for a local seat index, if assigned. */
  playerId(pilot: number): string | undefined;
  /** Assigns an input device ('auto', 'keyboard', 'none', or 'pad:N') to a seat index. */
  assign(pilot: number, device: string): void;
  /** Releases held inputs across host-managed controllers. */
  release(pilot?: number): void;
}

/** Factory creating local pilot seat registries and flight player preference codecs. */
export interface LocalPilotFactory {
  /** Creates an active local pilot registry wrapping the given host callbacks. */
  create(host: LocalPilotHost): PilotRegistry & Disposable;
  /** Returns the local player preferences codec backed by flight controller profiles. */
  preferences(): LocalPlayerPreferences;
}

/** Service key for the local pilot seats provider. */
export const LOCAL_PILOTS: ServiceKey<LocalPilotFactory> = Object.freeze({ slot: 'input.local-pilots', version: '1.0.0' });

/** Local routing identity connecting a seat and viewport to a session player and target entity. */
export interface ControlTargetBinding {
  /** Local seat identifier. */
  readonly seatId: string;
  /** Session player identifier. */
  readonly playerId: string;
  /** Target vessel or world entity identifier. */
  readonly entityId: string;
  /** Optional viewport identifier for multi-view split screen. */
  readonly viewportId?: string;
}

/** Explicit entity or session adapter for routing intent. Implementations validate ownership
 * and execute actions without advancing simulation state. Schema must be 'spacelab-control-target/1'. */
export interface ControlTargetAdapter {
  /** Explicit adapter contract schema identifier. */
  readonly schema: 'spacelab-control-target/1';
  /** Returns true if the session player currently owns and can command the target entity. */
  canControl(binding: ControlTargetBinding): boolean;
  /** Returns the bounded list of namespaced action IDs accepted by this target (max 256). */
  actions(binding: ControlTargetBinding): readonly string[];
  /** Sends an updated action value in [-1, 1] to the controlled entity. */
  setAction(binding: ControlTargetBinding, action: string, value: number): void;
  /** Clears active intent associated with the specified binding. */
  release(binding: ControlTargetBinding): void;
}

/** Input source binding for a single local player seat. */
export interface PlayerInputBinding {
  /** Local device seat index in [0, 3]. */
  readonly pilot: number;
  /** Borrowed, ordered input sources (at most 16). Last write wins; provider retains ownership. */
  readonly sources: readonly InputSource[];
}

/** Routes namespaced intent from input sources to a compatible control target adapter. */
export interface PlayerController extends Disposable {
  /** Active target binding, or undefined if no target is selected. */
  readonly target: ControlTargetBinding | undefined;
  /** Selects a target entity. Releasing or changing target clears prior intent. */
  select(target: ControlTargetBinding | undefined): void;
  /** Binds input sources for this seat. Reassignment clears held device state. */
  bindInput(input: PlayerInputBinding | undefined): void;
  /** Synchronously samples bound sources and dispatches changed actions to the adapter. */
  sample(frame: Omit<InputFrame, 'pilot'>): void;
  /** Manually sets an action value in [-1, 1] on the active target. */
  set(action: string, value: number): void;
  /** Releases all held actions and informs the adapter. */
  release(): void;
}

/** Factory creating player controllers over a control target adapter. */
export interface PlayerControllerFactory {
  /** Creates a player controller bound to the specified adapter and optional initial input. */
  create(adapter: ControlTargetAdapter, input?: PlayerInputBinding): PlayerController;
}

/** Service key for the player controller factory. */
export const PLAYER_CONTROLLERS: ServiceKey<PlayerControllerFactory> = Object.freeze({ slot: 'input.controller', version: '1.0.0' });

/** Configuration options for a keyboard input source. */
export interface KeyboardInputOptions {
  /** Action definitions to sample. */
  readonly actions: readonly ActionDefinitionV2[];
  /** Custom keybindings mapping action IDs to keyboard codes or chords. */
  readonly bindings?: Readonly<Record<string, readonly string[]>>;
  /** Returns the active local seat index in [0, 3], or undefined if unassigned. */
  pilot(): number | undefined;
  /** Optional callback returning false when modal UI captures keyboard input. */
  capture?(): boolean;
}

/** Factory creating keyboard input sources and legacy flight adapters. */
export interface KeyboardInputFactory {
  /** Creates an InputSource listening to window keyboard events. */
  create(options: KeyboardInputOptions): InputSource;
  /** Read-only set of reserved browser/system keys. */
  readonly reservedKeys: ReadonlySet<string>;
  /** Binds the legacy Space Sim flight keyboard adapter. */
  bindFlight(options: FlightKeyboardOptions): Disposable;
}

/** Service key for the keyboard input provider. */
export const KEYBOARD_INPUT: ServiceKey<KeyboardInputFactory> = Object.freeze({ slot: 'input.keyboard', version: '1.0.0' });

/** Keybinding storage, display and action definition registry. */
export interface FlightActionBindings {
  /** All registered flight action definitions. */
  readonly definitions: readonly ActionDefinitionV2[];
  /** Loads current keybindings from localStorage (`space-sim:keybindings:v1`) or defaults. */
  load(): Readonly<Record<string, readonly string[]>>;
  /** Persists updated keybindings to storage. */
  save(bindings: Readonly<Record<string, readonly string[]>>): void;
  /** Resets keybindings in storage and returns defaults. */
  reset(): Readonly<Record<string, readonly string[]>>;
  /** Returns a human-friendly display label for a flight action. */
  label(action: FlightActionId): string;
}

/** Service key for the flight action bindings service. */
export const FLIGHT_ACTIONS: ServiceKey<FlightActionBindings> = Object.freeze({ slot: 'input.flight-actions', version: '1.0.0' });

/** Binding mapping a physical gamepad axis or button to a namespaced action. */
export type GamepadActionBinding = { readonly action: string; readonly invert?: boolean } &
  ({ readonly axis: number; readonly button?: never } | { readonly button: number; readonly axis?: never });

/** Options configuring a generic gamepad input source. */
export interface GamepadInputOptions {
  /** Action definitions to sample. */
  readonly actions: readonly ActionDefinitionV2[];
  /** List of up to 256 gamepad axis/button bindings. */
  readonly bindings: readonly GamepadActionBinding[];
  /** Radial deadzone fraction in [0, 0.5]. */
  readonly deadzone: number;
  /** Returns the physical gamepad device index (0–31) assigned to this seat. */
  pad(pilot: number): number | undefined;
  /** Optional callback returning false when input capture is suppressed. */
  capture?(): boolean;
}

/** Factory creating generic gamepad input sources and flight gamepad managers. */
export interface GamepadInputFactory {
  /** Creates an InputSource sampling standard W3C Gamepad API devices. */
  create(options: GamepadInputOptions): InputSource;
  /** Creates a legacy FlightGamepad manager for flight HUD and controls. */
  createFlight(): FlightGamepad;
  /** Formats a physical button index into a family-specific label (e.g. 'A', 'Cross'). */
  formatButton(index: number, family: ControllerFamily): string;
}

/** Service key for the gamepad input provider. */
export const GAMEPAD_INPUT: ServiceKey<GamepadInputFactory> = Object.freeze({ slot: 'input.gamepad', version: '1.0.0' });

/** Service key for flight controller profile codecs and defaults. */
export const FLIGHT_PROFILES: ServiceKey<FlightControllerProfiles> = Object.freeze({ slot: 'input.flight-profiles', version: '1.0.0' });

/** Binding mapping a DOM element pointer gesture to a namespaced action. */
export interface TouchActionBinding {
  /** Namespaced action ID to trigger. */
  readonly action: string;
  /** HTML element capturing pointer events. */
  readonly element: HTMLElement;
  /** Gesture type: continuous hold button, horizontal axis or vertical axis. */
  readonly gesture: 'hold' | 'axis-x' | 'axis-y';
  /** Inverts the evaluated axis direction if true. */
  readonly invert?: boolean;
}

/** Options configuring a touch input source. */
export interface TouchInputOptions {
  /** Action definitions to sample. */
  readonly actions: readonly ActionDefinitionV2[];
  /** List of up to 256 element gesture bindings. */
  readonly bindings: readonly TouchActionBinding[];
  /** Returns active local seat index in [0, 3], or undefined if unassigned. */
  pilot(): number | undefined;
  /** Optional callback returning false when modal UI suppresses touch controls. */
  capture?(): boolean;
}

/** Factory creating touch input sources and flight touch overlays. */
export interface TouchInputFactory {
  /** Creates an InputSource tracking pointer gestures across caller elements. */
  create(options: TouchInputOptions): InputSource;
  /** Creates a legacy FlightTouch overlay manager. */
  createFlight(): FlightTouch;
}

/** Service key for the touch input provider. */
export const TOUCH_INPUT: ServiceKey<TouchInputFactory> = Object.freeze({ slot: 'input.touch', version: '1.0.0' });

/** System coordinates in metres, orientation in radians; a read must never step a world. */
export interface ViewTargetTransform { readonly position: Vec; readonly orientation: number }
/** Frame inputs for local camera calculations: wall-clock elapsed time, viewport CSS pixels, and target transforms. */
export interface LocalCameraInput {
  readonly elapsed: number; readonly width: number; readonly height: number;
  transform(targetId: string): ViewTargetTransform | undefined;
}
/** Independent viewport camera managing focus, zoom, and frame projection. */
export interface LocalViewCamera extends Disposable {
  readonly viewportId: string;
  readonly targetId: string | undefined;
  readonly mode: 'follow' | 'free';
  focus(targetId: string | undefined): void;
  changeZoom(factor: number): void;
  frame(input: LocalCameraInput): Camera;
}
/** Factory creating independent viewport cameras by viewport identity. */
export interface LocalCameraFactory { create(viewportId: string): LocalViewCamera }
/** Service key for independent viewport cameras (`view.camera@1.0.0`). */
export const VIEW_CAMERAS: ServiceKey<LocalCameraFactory> = Object.freeze({ slot: 'view.camera', version: '1.0.0' });
/** Layout arrangement for two-player splitscreen ('auto' | 'side' | 'stacked'). */
export type TwoPlayerLayout = 'auto' | 'side' | 'stacked';
/** Splitscreen display mode ('dynamic' merges when close, 'split' always partitions). */
export type ScreenMode = 'dynamic' | 'split';
/** Normalized rectangle (x, y, w, h in 0..1 range) defining a viewport pane. */
export interface PaneRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }
/** Viewport and seat identification binding tying a player to a camera and display pane. */
export interface LocalViewBinding {
  readonly viewportId: string; readonly seatId: string; readonly playerId?: string; readonly targetId?: string;
}
/** A surface borrows read-only world state from its renderer adapter. */
export interface LocalViewSurface extends Disposable {
  resize(rect: PaneRect, width: number, height: number, visible: boolean): void;
  draw(camera: Camera): void;
}
/** Options configuring multi-view local allocation and surface binding. */
export interface LocalViewOptions {
  readonly bindings: readonly LocalViewBinding[];
  readonly layout: TwoPlayerLayout;
  readonly mode: ScreenMode;
  surface(binding: LocalViewBinding): LocalViewSurface;
}
/** Controller managing independent local viewports, cameras, surfaces, reflow, and rendering. */
export interface LocalViews extends Disposable {
  readonly count: number;
  /** Connected support is independent of whether more than one pane is visible. */
  readonly splitActive: boolean;
  camera(viewportId: string): LocalViewCamera;
  reflow(width: number, height: number, separatedGuests?: ReadonlySet<number>): void;
  render(elapsed: number, transform: LocalCameraInput['transform']): void;
}
/** Factory creating local multi-view managers and calculating pane rectangle layouts. */
export interface LocalViewFactory {
  create(options: LocalViewOptions): LocalViews;
  paneRects(count: number, layout: TwoPlayerLayout, width: number, height: number): PaneRect[];
  dynamicPaneRects(count: number, separatedGuests: ReadonlySet<number>, layout: TwoPlayerLayout, width: number, height: number): { rects: PaneRect[]; visible: boolean[] };
}
/** Service key for the local view multi-pane manager (`view.local@1.0.0`). */
export const LOCAL_VIEWS: ServiceKey<LocalViewFactory> = Object.freeze({ slot: 'view.local', version: '1.0.0' });
/**
 * Bidirectional text transport connection with backpressure and lifecycle events.
 * Shared by browser WebSockets, WebRTC data channels, scoped tab channels, and Node server sockets.
 */
export interface TextConnection {
  /** Human-readable peer label or endpoint address for diagnostics. */
  readonly label: string;
  /** Number of bytes currently queued but not yet transmitted over the wire. */
  readonly bufferedAmount: number;
  /** Transmit an application text message. Dropped or throws if the connection is closed. */
  send(text: string): void;
  /** Close the connection cleanly, optionally passing a reason message to the remote peer. */
  close(reason?: string): void;
  /** Handler invoked when a text message arrives from the remote peer. */
  onmessage: ((text: string) => void) | null;
  /** Handler invoked once when the connection closes, receiving the close reason. */
  onclose: ((reason: string) => void) | null;
}
/**
 * Pluggable network transport provider capable of opening or listening for reliable text connections.
 */
export interface TransportProvider {
  /** Transport identifier, such as 'websocket' or 'tab'. */
  readonly name: string;
  /** Supported URL schemes, e.g. ['ws', 'wss'] or ['tab']. */
  readonly schemes: readonly string[];
  /** Signal owns pending IO and the established connection's lifetime. */
  connect(address: string, signal: AbortSignal): Promise<TextConnection>;
  /** Signal owns pending IO and the listener; accepted peers remain separately owned. */
  listen?(address: string, accept: (peer: TextConnection) => void, signal: AbortSignal): Promise<Disposable>;
}
/** ServiceKey for the WebSocket transport provider (slot `net.websocket`). */
export const WEBSOCKET_TRANSPORT: ServiceKey<TransportProvider> = Object.freeze({ slot: 'net.websocket', version: '1.0.0' });
/** Advertised server information discovered over LAN, tab broadcast, or directory service. */
export interface ServerAdvert {
  /** Unique server session identifier. */
  readonly id: string;
  /** Human-readable session or world name. */
  readonly name: string;
  /** Address URL used by a TransportProvider to connect (e.g. `ws://...` or `tab://...`). */
  readonly address: string;
  /** Current count of connected players. */
  readonly players: number;
  /** Maximum supported players for this session. */
  readonly maxPlayers: number;
  /** Protocol identifier expected by the session host (e.g. `space-sim-flight/1`). */
  readonly protocol: string;
}
/** Service for scanning local or tab networks to discover advertised sessions. */
export interface DiscoveryProvider {
  /** Name of the discovery mechanism (e.g. 'lan' or 'tab'). */
  readonly name: string;
  /** Scan for active server adverts until signal is aborted, invoking emit for each found server. */
  scan(emit: (advert: ServerAdvert) => void, signal: AbortSignal): Promise<void>;
}
/** @deprecated Use ManualSignalingProvider: reply codes must precede connection. */
export interface InviteProvider {
  /** Generate an invitation offer. */
  create(signal: AbortSignal): Promise<{
    readonly offer: string;
    accept(reply: string): Promise<TextConnection>;
    dispose(): void;
  }>;
  /** Answer an invitation offer with a reply. */
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
