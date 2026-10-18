import type { ActionId } from './input-config';

export type ControllerFamily = 'xbox' | 'playstation' | 'steam-deck' | 'nintendo' | 'generic';

export function detectControllerFamily(padId: string): ControllerFamily {
  const lower = (padId || '').toLowerCase();
  if (lower.includes('steam deck') || lower.includes('steam controller') || lower.includes('28de') || lower.includes('valve')) {
    return 'steam-deck';
  }
  if (lower.includes('dualsense') || lower.includes('dualshock') || lower.includes('sony') || lower.includes('054c') || lower.includes('playstation')) {
    return 'playstation';
  }
  if (lower.includes('xbox') || lower.includes('045e') || lower.includes('xinput') || lower.includes('microsoft')) {
    return 'xbox';
  }
  if (lower.includes('057e') || lower.includes('switch') || lower.includes('joy-con') || lower.includes('pro controller')) {
    return 'nintendo';
  }
  return 'generic';
}

export function getControllerFamilyDisplayName(family: ControllerFamily): string {
  switch (family) {
    case 'steam-deck': return 'Steam Deck Controller';
    case 'xbox': return 'Xbox Wireless / XInput Controller';
    case 'playstation': return 'PlayStation DualSense / DualShock';
    case 'nintendo': return 'Nintendo Switch Pro Controller';
    default: return 'Standard Gamepad / Flight Stick';
  }
}

export function formatControllerButton(buttonIndex: number, family: ControllerFamily): string {
  switch (family) {
    case 'playstation':
      switch (buttonIndex) {
        case 0: return 'Cross (✕)';
        case 1: return 'Circle (◯)';
        case 2: return 'Square (▢)';
        case 3: return 'Triangle (△)';
        case 4: return 'L1';
        case 5: return 'R1';
        case 6: return 'L2 Trigger';
        case 7: return 'R2 Trigger';
        case 8: return 'Share / Create';
        case 9: return 'Options';
        case 10: return 'L3 (Stick Click)';
        case 11: return 'R3 (Stick Click)';
        case 12: return 'D-Pad Up';
        case 13: return 'D-Pad Down';
        case 14: return 'D-Pad Left';
        case 15: return 'D-Pad Right';
        case 16: return 'PS Button';
        case 17: return 'Touchpad Click';
        default: return `Btn ${buttonIndex}`;
      }
    case 'xbox':
      switch (buttonIndex) {
        case 0: return 'A';
        case 1: return 'B';
        case 2: return 'X';
        case 3: return 'Y';
        case 4: return 'LB';
        case 5: return 'RB';
        case 6: return 'LT Trigger';
        case 7: return 'RT Trigger';
        case 8: return 'View (Back)';
        case 9: return 'Menu (Start)';
        case 10: return 'LS (Left Stick Click)';
        case 11: return 'RS (Right Stick Click)';
        case 12: return 'D-Pad Up';
        case 13: return 'D-Pad Down';
        case 14: return 'D-Pad Left';
        case 15: return 'D-Pad Right';
        case 16: return 'Xbox Button';
        default: return `Btn ${buttonIndex}`;
      }
    case 'steam-deck':
      switch (buttonIndex) {
        case 0: return 'A';
        case 1: return 'B';
        case 2: return 'X';
        case 3: return 'Y';
        case 4: return 'L1 (Bumper)';
        case 5: return 'R1 (Bumper)';
        case 6: return 'L2 (Trigger)';
        case 7: return 'R2 (Trigger)';
        case 8: return 'View';
        case 9: return 'Menu';
        case 10: return 'L3 (Left Stick)';
        case 11: return 'R3 (Right Stick)';
        case 12: return 'D-Pad Up';
        case 13: return 'D-Pad Down';
        case 14: return 'D-Pad Left';
        case 15: return 'D-Pad Right';
        case 16: return 'Quick Access';
        default: return `Btn ${buttonIndex}`;
      }
    default:
      switch (buttonIndex) {
        case 0: return 'Trigger / Btn 0';
        case 1: return 'Btn 1';
        case 2: return 'Btn 2';
        case 3: return 'Btn 3';
        case 4: return 'Left Bumper';
        case 5: return 'Right Bumper';
        case 6: return 'Left Trigger';
        case 7: return 'Right Trigger';
        case 8: return 'Select / Back';
        case 9: return 'Start / Menu';
        case 10: return 'Left Stick Click';
        case 11: return 'Right Stick Click';
        case 12: return 'D-Pad Up';
        case 13: return 'D-Pad Down';
        case 14: return 'D-Pad Left';
        case 15: return 'D-Pad Right';
        default: return `Btn ${buttonIndex}`;
      }
  }
}

/** One player's controller layout: analog axes plus remappable buttons for every action. */
export interface ControllerProfile {
  /** Axis index for turning [-1..1]. Default: 0 (Left Stick X / Joystick Roll). */
  readonly turnAxis: number;
  readonly invertTurn: boolean;
  /** Axis index for throttle steps [-1..1]. Default: 1 (Left Stick Y / Joystick Pitch). */
  readonly throttleAxis: number;
  readonly invertThrottle: boolean;
  /** Axis index for analog zoom, or -1 for none. Default: 3 (Right Stick Y). */
  readonly zoomAxis: number;
  readonly invertZoom: boolean;
  /** Radial deadzone fraction [0..0.5]. Default: 0.15. */
  readonly deadzone: number;
  /** Standard-mapping button indices per action. Held actions (engine, throttle, turn) act
   * while pressed; the rest fire once per press. */
  readonly buttons: Readonly<Record<ActionId, readonly number[]>>;
}

/** Steam Deck, Xbox and PlayStation share the W3C standard mapping. */
export const DEFAULT_PAD_BUTTONS: Readonly<Record<ActionId, readonly number[]>> = Object.freeze({
  engine: [7],             // RT / R2 (held burn)
  throttleUp: [12],        // D-pad up
  throttleFine: [6],       // LT / L2
  throttleCut: [11],       // R3
  throttleRecall: [0],     // A / Cross
  throttleDown: [13],      // D-pad down
  turnLeft: [],
  turnRight: [],
  warpDown: [4, 14],       // LB / L1, D-pad left
  warpUp: [5, 15],         // RB / R1, D-pad right
  warpReset: [10],         // L3
  pause: [9],              // Start / Menu / Options
  reset: [8, 17],          // Back / View / Share, PlayStation touchpad
  camera: [3],             // Y / Triangle
  orientation: [2],        // X / Square
  cycleShip: [1],          // B / Circle
  cycleShipPrev: [],
  cyclePlanet: [],
  cyclePlanetPrev: [],
  zoomIn: [],
  zoomOut: [],
  fullscreen: [],
  profiler: [],
  throwShip: [],           // Bind explicitly; D-pad up belongs to throttle
});

export const DEFAULT_CONTROLLER_PROFILE: ControllerProfile = Object.freeze({
  turnAxis: 0,
  invertTurn: false,
  throttleAxis: 1,
  invertThrottle: true,
  zoomAxis: -1,
  invertZoom: true,
  deadzone: 0.15,
  buttons: DEFAULT_PAD_BUTTONS,
});

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

export const DEFAULT_GAMEPAD_SETTINGS: GamepadSettings = Object.freeze({
  enabled: true,
  turnAxis: DEFAULT_CONTROLLER_PROFILE.turnAxis,
  invertTurn: DEFAULT_CONTROLLER_PROFILE.invertTurn,
  throttleAxis: DEFAULT_CONTROLLER_PROFILE.throttleAxis,
  invertThrottle: DEFAULT_CONTROLLER_PROFILE.invertThrottle,
  deadzone: DEFAULT_CONTROLLER_PROFILE.deadzone,
  engineButton: 7,
  secondaryEngineButton: 7,
});

const MAX_INDEX = 31;
const index = (value: unknown, fallback: number, min = 0): number =>
  Number.isInteger(value) && (value as number) >= min && (value as number) <= MAX_INDEX ? value as number : fallback;

/** A stored or imported profile with every field checked; unknown actions are dropped. */
export function normalizeProfile(raw: unknown): ControllerProfile {
  const d = DEFAULT_CONTROLLER_PROFILE;
  if (typeof raw !== 'object' || raw === null) return d;
  const r = raw as Record<string, unknown>;
  const buttons = { ...d.buttons } as Record<ActionId, readonly number[]>;
  const rawButtons = typeof r.buttons === 'object' && r.buttons !== null ? r.buttons as Record<string, unknown> : {};
  for (const action of Object.keys(buttons) as ActionId[]) {
    const list = rawButtons[action];
    if (Array.isArray(list)) buttons[action] = [...new Set(list.filter(b => index(b, -1) >= 0) as number[])].slice(0, 4);
  }
  if (rawButtons.throttleRecall === undefined && buttons.engine.length === 2 && buttons.engine[0] === 0 && buttons.engine[1] === 7) buttons.engine = [7];
  // Migrate the former default collision; retain other custom throw mappings.
  if (rawButtons.throttleRecall === undefined && buttons.throwShip.length === 1 && buttons.throwShip[0] === 12 && buttons.throttleUp.includes(12)) buttons.throwShip = [];
  // New defaults must not take buttons already assigned by an older custom layout.
  for (const action of ['throttleFine', 'throttleCut', 'throttleRecall'] as const) {
    if (rawButtons[action] !== undefined) continue;
    buttons[action] = buttons[action].filter(button => !Object.entries(rawButtons).some(([other, indices]) =>
      other !== action && Array.isArray(indices) && buttons[other as ActionId]?.includes(button)));
  }
  const deadzone = typeof r.deadzone === 'number' && Number.isFinite(r.deadzone) ? Math.max(0, Math.min(0.5, r.deadzone)) : d.deadzone;
  const flag = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback;
  return {
    turnAxis: index(r.turnAxis, d.turnAxis), invertTurn: flag(r.invertTurn, d.invertTurn),
    throttleAxis: index(r.throttleAxis, d.throttleAxis), invertThrottle: flag(r.invertThrottle, d.invertThrottle),
    zoomAxis: index(r.zoomAxis, d.zoomAxis, -1), invertZoom: flag(r.invertZoom, d.invertZoom),
    deadzone, buttons,
  };
}

/** Held actions read every frame; every other bound action fires on press. */
const HELD = new Set<ActionId>(['engine', 'throttleFine', 'throttleUp', 'throttleDown', 'turnLeft', 'turnRight']);

const ENABLED_KEY = 'space-sim:gamepad:v1';

export interface GamepadFlightInput {
  /** Turning rate in [-1, 1]: positive turns left (CCW), as the keyboard and touch stick do. */
  readonly turn: number;
  /** Signed throttle step intent: ±1 normal, ±0.2 fine, 0 neutral. */
  readonly throttle: number;
  /** Engine burn state (held). */
  readonly engine: boolean;
  /** Analog zoom rate in [-1, 1]: positive zooms in. */
  readonly zoom: number;
}

export const NO_PAD_INPUT: GamepadFlightInput = Object.freeze({ turn: 0, throttle: 0, engine: false, zoom: 0 });

export interface GamepadDiagnostic {
  readonly index: number;
  readonly id: string;
  readonly family: ControllerFamily;
  readonly familyName: string;
  readonly connected: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean; readonly value: number; readonly label: string }[];
}

export function applyDeadzone(value: number, deadzone: number): number {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  const scaled = (abs - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(1, Math.max(0, scaled));
}

export const isButtonDown = (button: GamepadButton | undefined): boolean => !!button && (button.pressed || button.value > 0.25);
const isDown = isButtonDown;

/** Flight input from one pad under `profile`. Pure, for tests and the poller. */
export function readPad(pad: Pick<Gamepad, 'axes' | 'buttons'>, profile: ControllerProfile): GamepadFlightInput {
  const axis = (i: number): number => i >= 0 && i < pad.axes.length ? applyDeadzone(pad.axes[i] ?? 0, profile.deadzone) : 0;
  const held = (action: ActionId): boolean => profile.buttons[action].some(b => isDown(pad.buttons[b]));
  // Stick right reads +1; turning right is negative.
  let turn = profile.invertTurn ? axis(profile.turnAxis) : -axis(profile.turnAxis);
  if (held('turnLeft')) turn = 1;
  if (held('turnRight')) turn = -1;
  const stick = profile.invertThrottle ? -axis(profile.throttleAxis) : axis(profile.throttleAxis);
  let throttle = Math.abs(stick) > 0.2 ? Math.sign(stick) : 0;
  if (held('throttleUp') && !held('throwShip')) throttle = 1;
  if (held('throttleDown')) throttle = -1;
  const zoom = profile.zoomAxis < 0 ? 0 : profile.invertZoom ? -axis(profile.zoomAxis) : axis(profile.zoomAxis);
  const norm = (v: number): number => v === 0 ? 0 : v;
  return { turn: norm(turn), throttle: norm(throttle * (held('throttleFine') ? .2 : 1)), engine: held('engine'), zoom: norm(zoom) };
}

/** Reads every connected pad once per frame: flight input per pad, button presses mapped
 * through each pad's profile, and raw presses for joining and rebinding. Runs while paused,
 * so a Start button can resume. */
export class GamepadManager {
  enabled = true;
  private readonly previous = new Map<number, boolean[]>();
  private readonly input = new Map<number, GamepadFlightInput>();
  /** Last time (ms) each pad had a button down or a stick outside its deadzone. */
  readonly activity = new Map<number, number>();
  private capture: ((pad: number, button: number) => void) | undefined;

  constructor() {
    this.loadSettings();
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepaddisconnected', e => {
        this.previous.delete(e.gamepad.index);
        this.input.delete(e.gamepad.index);
        this.activity.delete(e.gamepad.index);
      });
    }
  }

  private loadSettings(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      if (raw) this.enabled = (JSON.parse(raw) as { enabled?: unknown }).enabled !== false;
    } catch {
      // Use defaults
    }
  }

  /** The version 1 layout, for migrating player 1's controller settings. */
  static legacyProfile(): ControllerProfile | undefined {
    if (typeof localStorage === 'undefined') return undefined;
    try {
      const raw = localStorage.getItem(ENABLED_KEY);
      if (!raw) return undefined;
      const old = JSON.parse(raw) as Record<string, unknown>;
      const buttons = { ...DEFAULT_PAD_BUTTONS } as Record<ActionId, readonly number[]>;
      if (Number.isInteger(old.engineButton) || Number.isInteger(old.secondaryEngineButton)) {
        buttons.engine = [old.engineButton, old.secondaryEngineButton].filter(b => Number.isInteger(b)) as number[];
        if (buttons.engine.length === 2 && buttons.engine[0] === 0 && buttons.engine[1] === 7) buttons.engine = [7];
      }
      // Version 1 steered backwards unless inverted; either way, the corrected default is right.
      return normalizeProfile({ ...old, invertTurn: false, zoomAxis: undefined, invertZoom: undefined, buttons });
    } catch {
      return undefined;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.input.clear();
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(ENABLED_KEY, JSON.stringify({ enabled }));
    } catch {
      // Ignore
    }
  }

  /** All connected pads from navigator. */
  private pads(): Gamepad[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return [];
    try {
      return Array.from(navigator.getGamepads() ?? []).filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      return [];
    }
  }

  /** Indices of connected pads, lowest first. */
  connected(): number[] {
    return this.pads().map(p => p.index).sort((a, b) => a - b);
  }

  /** Call once per frame. `profileFor` gives each pad's layout (undefined: unassigned, which
   * still reports raw presses through `onPress`); `onAction` receives mapped presses. */
  update(profileFor: (pad: number) => ControllerProfile | undefined,
      onAction: (pad: number, action: ActionId) => void,
      onPress?: (pad: number, button: number) => void): void {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    for (const pad of this.pads()) {
      const down = pad.buttons.map(isDown);
      const before = this.previous.get(pad.index);
      this.previous.set(pad.index, down);
      if (down.some(Boolean) || pad.axes.some(a => Math.abs(a) > 0.5)) this.activity.set(pad.index, now);
      if (!this.enabled) continue;
      const profile = profileFor(pad.index);
      this.input.set(pad.index, profile ? readPad(pad, profile) : NO_PAD_INPUT);
      // The first sight of a pad only records which buttons were already down.
      if (!before || before.length !== down.length) continue;
      for (let b = 0; b < down.length; b++) {
        if (!down[b] || before[b]) continue;
        if (this.capture) { const capture = this.capture; this.capture = undefined; capture(pad.index, b); continue; }
        onPress?.(pad.index, b);
        if (!profile) continue;
        for (const [action, list] of Object.entries(profile.buttons) as [ActionId, readonly number[]][]) {
          if (!HELD.has(action) && list.includes(b)) onAction(pad.index, action);
        }
      }
    }
  }

  /** This frame's flight input from `pad`. */
  flight(pad: number): GamepadFlightInput {
    return this.enabled ? this.input.get(pad) ?? NO_PAD_INPUT : NO_PAD_INPUT;
  }

  /** The next newly pressed button on any pad goes to `listener` instead of the game. */
  captureNextButton(listener: ((pad: number, button: number) => void) | undefined): void {
    this.capture = listener;
  }
  get capturing(): boolean { return !!this.capture; }

  /** Diagnostic snapshot of all connected gamepads for the configuration UI. */
  getDiagnostics(): GamepadDiagnostic[] {
    return this.pads().map(pad => {
      const family = detectControllerFamily(pad.id);
      return {
        index: pad.index, id: pad.id, family, familyName: getControllerFamilyDisplayName(family), connected: pad.connected,
        axes: Array.from(pad.axes),
        buttons: pad.buttons.map((b, idx) => ({ pressed: b.pressed, value: b.value, label: formatControllerButton(idx, family) })),
      };
    });
  }

  getSettings(): GamepadSettings {
    return {
      enabled: this.enabled,
      turnAxis: DEFAULT_CONTROLLER_PROFILE.turnAxis,
      invertTurn: DEFAULT_CONTROLLER_PROFILE.invertTurn,
      throttleAxis: DEFAULT_CONTROLLER_PROFILE.throttleAxis,
      invertThrottle: DEFAULT_CONTROLLER_PROFILE.invertThrottle,
      deadzone: DEFAULT_CONTROLLER_PROFILE.deadzone,
      engineButton: 7,
      secondaryEngineButton: 7,
    };
  }

  private legacyShortcutHandler?: (action: ActionId) => void;
  onShortcut(handler: (action: ActionId) => void): void {
    this.legacyShortcutHandler = handler;
  }

  pollFlight(): GamepadFlightInput {
    const pads = this.pads();
    if (!pads.length || !this.enabled) return NO_PAD_INPUT;
    this.update(() => DEFAULT_CONTROLLER_PROFILE, (_pad, action) => {
      this.legacyShortcutHandler?.(action);
    });
    return this.flight(pads[0]!.index);
  }
}
