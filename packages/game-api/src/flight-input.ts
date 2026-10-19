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

export type ControllerFamily = 'xbox' | 'playstation' | 'steam-deck' | 'nintendo' | 'generic';

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

export interface GamepadDiagnostic {
  readonly index: number;
  readonly id: string;
  readonly family: ControllerFamily;
  readonly familyName: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number; readonly label: string }[];
}

export interface TouchFlightState {
  readonly turn: number;
  readonly throttle: number;
  readonly engine: boolean;
}
export type TouchMode = 'auto' | 'always' | 'never';

/** Explicit compatibility adapter for Space Sim's existing flight mappings. */
export interface FlightGamepad extends Disposable {
  readonly enabled: boolean;
  readonly activity: ReadonlyMap<number, number>;
  readonly capturing: boolean;
  setEnabled(enabled: boolean): void;
  connected(): number[];
  update(profileFor: (pad: number) => ControllerProfile | undefined,
    onAction: (pad: number, action: FlightActionId) => void, onPress?: (pad: number, button: number) => void): void;
  flight(pad: number): GamepadFlightInput;
  captureNextButton(listener: ((pad: number, button: number) => void) | undefined): void;
  getDiagnostics(): GamepadDiagnostic[];
  getSettings(): GamepadSettings;
  onShortcut(handler: (action: FlightActionId) => void): void;
  pollFlight(): GamepadFlightInput;
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
  /** Optional safe shortcuts while a button, summary or link has focus. Text/edit
   * controls still suppress flight shortcuts. Receives the resolved binding code. */
  readonly controlShortcut?: (code: string) => boolean;
}

export type PlayerCount = 1 | 2 | 3 | 4;

export type InputDevice = 'auto' | 'keyboard' | `pad:${number}` | 'none';

export type NavballAnchor = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left' | 'center-bottom' | 'custom';

export interface NavballPlacement {
  /** Anchor preset or 'custom' */
  readonly anchor: NavballAnchor;
  /** Normalized fraction [0..1] within the pane or shared viewport. */
  readonly x: number;
  readonly y: number;
  /** Whether the navball is pinned in place (cannot be dragged). */
  readonly pinned: boolean;
}

export interface PlayerSlot {
  /** Player 1's name is the pilot name; the others are named here. */
  readonly name: string;
  readonly device: InputDevice;
  readonly profile: ControllerProfile;
  /** Seat secret, so a returning player gets their own ships back in a saved world. */
  readonly token: string;
  readonly navball: NavballPlacement;
}

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
