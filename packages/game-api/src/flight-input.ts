import type { Disposable } from './modules';
import type { ScreenMode, TwoPlayerLayout } from './platform';

/** Legacy Space Sim flight identifiers, retained only by compatible flight adapters. */
export type FlightActionId =
  | 'engine'
  | 'turnLeft'
  | 'turnRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'throttleFine'
  | 'throttleCut'
  | 'throttleRecall'
  | 'throttleRemember'
  | 'warpUp'
  | 'warpDown'
  | 'warpReset'
  | 'pause'
  | 'reset'
  | 'camera'
  | 'cameraRotateLeft'
  | 'cameraRotateRight'
  | 'orientation'
  | 'fullscreen'
  | 'profiler'
  | 'zoomIn'
  | 'zoomOut'
  | 'cycleShip'
  | 'cycleShipPrev'
  | 'cyclePlanet'
  | 'cyclePlanetPrev'
  | 'throwShip';

/** Hardware controller family used for formatting button labels (e.g. A vs Cross vs B). */
export type ControllerFamily = 'xbox' | 'playstation' | 'steam-deck' | 'nintendo' | 'generic';

/** Per-seat gamepad axis, inversion, radial deadzone, and action button mapping profile. */
export interface ControllerProfile {
  /** Axis index for turning [-1..1]. Default: 0 (Left Stick X / Joystick Roll). */
  readonly turnAxis: number;
  readonly invertTurn: boolean;
  /** Axis index for throttle adjustment [-1..1]. Default: 1 (Left Stick Y / Joystick Pitch). */
  readonly throttleAxis: number;
  readonly invertThrottle: boolean;
  /** Axis index for analog zoom, or -1 for none. Default: 3 (Right Stick Y). */
  readonly zoomAxis: number;
  readonly invertZoom: boolean;
  /** Radial deadzone fraction [0..0.5]. Default: 0.15. */
  readonly deadzone: number;
  /** Standard-mapping button indices per action. Held actions (engine, throttle, turn) act
   * while pressed; the rest fire once per press. */
  readonly buttons: Readonly<Record<FlightActionId, readonly number[]>>;
}

/** Legacy flat controller settings format stored in `space-sim:gamepad:v1`. */
export interface GamepadSettings {
  readonly enabled: boolean;
  readonly turnAxis: number;
  readonly invertTurn: boolean;
  readonly throttleAxis: number;
  readonly invertThrottle: boolean;
  readonly deadzone: number;
  readonly engineButton: number;
  readonly secondaryEngineButton: number;
}

/** Normalized per-frame flight control intent sampled from a physical gamepad (`[-1, 1]` axes). */
export interface GamepadFlightInput {
  /** Turning rate in [-1, 1]: positive turns left (CCW), as the keyboard and touch stick do. */
  readonly turn: number;
  /** Signed throttle adjustment intent: ±1 normal, ±0.2 fine, 0 neutral. */
  readonly throttle: number;
  /** Engine burn state (held). */
  readonly engine: boolean;
  /** Analog zoom rate in [-1, 1]: positive zooms in. */
  readonly zoom: number;
}

/** Provider-owned numeric device values. Axes are dimensionless in [-1,1]; button values
 * are in [0,1]. No native browser objects. Read synchronously without mutation or retention:
 * the provider may reuse these arrays/records on its next capture or disposal. */
export interface GamepadDeviceState {
  readonly index: number;
  readonly id: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number }[];
}

/** Diagnostic telemetry for a connected physical gamepad device. */
export interface GamepadDiagnostic {
  readonly index: number;
  readonly id: string;
  readonly family: ControllerFamily;
  readonly familyName: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number; readonly label: string }[];
}

/** Flight control state produced by the touch overlay. */
export interface TouchFlightState {
  readonly turn: number;
  readonly throttle: number;
  readonly engine: boolean;
}

/** Touch controls overlay activation mode. */
export type TouchMode = 'auto' | 'always' | 'never';

/** Explicit compatibility adapter for Space Sim's existing flight mappings. */
export interface FlightGamepad extends Disposable {
  readonly enabled: boolean;
  readonly activity: ReadonlyMap<number, number>;
  readonly capturing: boolean;
  setEnabled(enabled: boolean): void;
  /** Last explicit update capture identity, if supplied. Optional for older providers.
   * Diagnostics may reuse it while the host continues sampling input frames. */
  readonly captureId?: number;
  /** Connected indices from this capture; omission samples fresh. Returned list is detached. */
  connected(captureId?: number): number[];
  update(profileFor: (pad: number) => ControllerProfile | undefined,
    onAction: (pad: number, action: FlightActionId) => void, onPress?: (pad: number, button: number) => void, captureId?: number): void;
  flight(pad: number): GamepadFlightInput;
  captureNextButton(listener: ((pad: number, button: number) => void) | undefined): void;
  /** Optional borrowed access to provider-owned copied numbers for this capture,
   * avoiding detached diagnostic copies. Storage may grow when device/channel topology changes.
   * Borrowed until the next provider capture/disposal; never mutate or retain. Older providers
   * may omit this capability; hosts can use detached getDiagnostics results instead. */
  readDevices?(captureId?: number): readonly GamepadDeviceState[];
  /** Detached diagnostic values, optionally reusing numeric input capture for this frame. */
  getDiagnostics(captureId?: number): GamepadDiagnostic[];
  getSettings(): GamepadSettings;
  onShortcut(handler: (action: FlightActionId) => void): void;
  pollFlight(captureId?: number): GamepadFlightInput;
  release(pad?: number): void;
}
/** Flight mapping defaults and migration remain reusable without a gamepad device. */
export interface FlightControllerProfiles {
  readonly defaultProfile: ControllerProfile;
  normalize(raw: unknown): ControllerProfile;
  legacy(): ControllerProfile | undefined;
}
/** Editable flight overlay; generic touch sources can use other controls/actions. */
export interface FlightTouch extends Disposable {
  loadSettings(): TouchMode;
  saveMode(mode: TouchMode): void;
  getMode(): TouchMode;
  onShortcut(handler: (action: FlightActionId) => void): void;
  onZoom(handler: (factor: number) => void): void;
  onSlingHold(handler: (holding: boolean) => void): void;
  setSlingVisible(visible: boolean): void;
  setSlingActive(active: boolean): void;
  isTouchDevice(): boolean;
  attach(container: HTMLElement): void;
  updateVisibility(): void;
  pollFlight(): TouchFlightState;
  isVisible(): boolean;
  release(): void;
}

/** Options configuring the legacy Space Sim flight keyboard adapter. */
export interface FlightKeyboardOptions {
  readonly keys: Set<string>;
  /** Resolve explicitly bound shortcut chords before falling back to a bare key. */
  readonly binding?: (event: KeyboardEvent) => string;
  readonly pointers: Map<number, string>;
  readonly paused: () => boolean;
  readonly shortcut: (code: string) => void;
  /** Initial held-action press, including taps shorter than one rendered frame. */
  readonly flightPress?: (code: string) => void;
  /** A module command key; true when one is bound to `code`. */
  readonly command: (code: string) => boolean;
  readonly autoPause: (reason: string) => void;
  readonly autoResume?: (reason: string) => void;
  readonly visibility: () => void;
  readonly isFlightKey?: (code: string) => boolean;
  readonly isShortcutKey?: (code: string) => boolean;
  /** Optional safe shortcuts while a button, checkbox, radio, summary or link has focus. Text/edit
   * controls still suppress flight shortcuts. Receives the resolved binding code. */
  readonly controlShortcut?: (code: string) => boolean;
}

/** Supported local player seat count: 1 to 4 players. */
export type PlayerCount = 1 | 2 | 3 | 4;

/** Device assigned to fly a local player seat. */
export type InputDevice = 'auto' | 'keyboard' | `pad:${number}` | 'none';

/** Preset screen anchor location for a player's HUD navball. */
export type NavballAnchor = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center-bottom' | 'custom';

/** Normalized viewport position (`[0, 1]`), anchor preset, and drag-lock flag for a seat's HUD navball. */
export interface NavballPlacement {
  /** Anchor preset or 'custom' */
  readonly anchor: NavballAnchor;
  /** Normalized fraction [0..1] within the pane or shared viewport. */
  readonly x: number;
  /** Normalized fraction [0..1] within the pane or shared viewport. */
  readonly y: number;
  /** Whether the navball is pinned in place (cannot be dragged). */
  readonly pinned: boolean;
}

/** Per-seat local player preference slot. */
export interface PlayerSlot {
  /** Player 1's name is the pilot name; the others are named here. */
  readonly name: string;
  readonly device: InputDevice;
  readonly profile: ControllerProfile;
  /** Seat secret, so a returning player gets their own ships back in a saved world. */
  readonly token: string;
  readonly navball: NavballPlacement;
}

/** Full local multiplayer and splitscreen preference configuration. */
export interface LocalPlayersConfig {
  readonly count: PlayerCount;
  readonly twoPlayerLayout: TwoPlayerLayout;
  readonly screenMode: ScreenMode;
  readonly slots: readonly PlayerSlot[];
}

/** Persisted flight seat preferences; separate from the session's authority and identity. */
export interface LocalPlayerPreferences {
  readonly colors: readonly string[];
  readonly maximumPlayers: number;
  defaultNavballPlacement(slot: number): NavballPlacement;
  normalizeNavballPlacement(raw: unknown, fallback: NavballPlacement): NavballPlacement;
  padDevice(index: number): InputDevice;
  deviceIndex(device: InputDevice): number | undefined;
  defaultLocalPlayers(player1Profile?: ControllerProfile): LocalPlayersConfig;
  normalizeLocalPlayers(raw: unknown, player1Profile?: ControllerProfile): LocalPlayersConfig;
  loadLocalPlayers(player1Profile?: ControllerProfile): LocalPlayersConfig;
  saveLocalPlayers(config: LocalPlayersConfig): void;
  assignDevice(config: LocalPlayersConfig, slot: number, device: InputDevice): LocalPlayersConfig;
  updateSlot(config: LocalPlayersConfig, slot: number, change: Partial<Omit<PlayerSlot, 'token' | 'device'>>): LocalPlayersConfig;
  setPlayerCount(config: LocalPlayersConfig, count: number): LocalPlayersConfig;
  padOwner(config: LocalPlayersConfig, index: number, connected: readonly number[]): number | undefined;
  keyboardOwner(config: LocalPlayersConfig): number | undefined;
  computeNavballCenter(placement: NavballPlacement, width: number, height: number, scale?: number): { x: number; y: number };
  setSlotNavball(config: LocalPlayersConfig, slot: number, placement: Partial<NavballPlacement>): LocalPlayersConfig;
  setAllNavballsPinned(config: LocalPlayersConfig, pinned: boolean): LocalPlayersConfig;
}
