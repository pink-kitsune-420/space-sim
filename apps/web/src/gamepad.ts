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

export interface GamepadSettings {
  readonly enabled: boolean;
  /** Axis index for yaw/roll turn [-1..1]. Default: 0 (Left Stick X / Joystick Roll). */
  readonly turnAxis: number;
  readonly invertTurn: boolean;
  /** Axis index for pitch/throttle [-1..1]. Default: 1 (Left Stick Y / Joystick Pitch). */
  readonly throttleAxis: number;
  readonly invertThrottle: boolean;
  /** Radial deadzone fraction [0..0.5]. Default: 0.15. */
  readonly deadzone: number;
  /** Primary button index for main engine burn. Default: 0 (A / Cross / Trigger). */
  readonly engineButton: number;
  /** Secondary button index for engine burn. Default: 7 (Right Trigger RT / R2). */
  readonly secondaryEngineButton: number;
}

export const DEFAULT_GAMEPAD_SETTINGS: GamepadSettings = Object.freeze({
  enabled: true,
  turnAxis: 0,
  invertTurn: false,
  throttleAxis: 1,
  invertThrottle: true,
  deadzone: 0.15,
  engineButton: 0,
  secondaryEngineButton: 7,
});

const STORAGE_KEY = 'space-sim:gamepad:v1';

export interface GamepadFlightInput {
  /** Analog turning rate in [-1, 1]. Negative = left/CCW, positive = right/CW. */
  readonly turn: number;
  /** Digital or analog throttle adjustment (-1 = decrease, 0 = neutral, 1 = increase). */
  readonly throttle: number;
  /** Engine burn state (held). */
  readonly engine: boolean;
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

export class GamepadManager {
  private settings: GamepadSettings = { ...DEFAULT_GAMEPAD_SETTINGS };
  private previousButtonStates: Map<number, boolean[]> = new Map();
  private onShortcutHandler?: (action: ActionId) => void;

  constructor() {
    this.loadSettings();
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepadconnected', () => {});
      window.addEventListener('gamepaddisconnected', (e) => {
        this.previousButtonStates.delete(e.gamepad.index);
      });
    }
  }

  loadSettings(): GamepadSettings {
    if (typeof localStorage === 'undefined') return this.settings;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<GamepadSettings>;
        this.settings = { ...DEFAULT_GAMEPAD_SETTINGS, ...parsed };
      }
    } catch {
      // Use defaults
    }
    return this.settings;
  }

  saveSettings(settings: Partial<GamepadSettings>): void {
    this.settings = { ...this.settings, ...settings };
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Ignore
    }
  }

  resetSettings(): GamepadSettings {
    this.settings = { ...DEFAULT_GAMEPAD_SETTINGS };
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Ignore
      }
    }
    return this.settings;
  }

  getSettings(): Readonly<GamepadSettings> {
    return this.settings;
  }

  onShortcut(handler: (action: ActionId) => void): void {
    this.onShortcutHandler = handler;
  }

  /** Gets all active gamepads safely from navigator. */
  private getGamepads(): (Gamepad | null)[] {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    try {
      const pads = navigator.getGamepads();
      return pads ? Array.from(pads) : [];
    } catch {
      return [];
    }
  }

  /** Evaluates flight controls from the primary connected gamepad. */
  pollFlight(): GamepadFlightInput {
    if (!this.settings.enabled) {
      return { turn: 0, throttle: 0, engine: false };
    }

    const pads = this.getGamepads();
    let turn = 0;
    let throttle = 0;
    let engine = false;

    for (const pad of pads) {
      if (!pad || !pad.connected) continue;

      // Handle button edge transitions for single-shot shortcuts
      this.pollShortcuts(pad);

      // Read Turn Axis (Left Stick X / flight stick roll)
      if (pad.axes.length > this.settings.turnAxis) {
        const rawTurn = pad.axes[this.settings.turnAxis] ?? 0;
        const deadzoned = this.applyDeadzone(rawTurn, this.settings.deadzone);
        if (Math.abs(deadzoned) > Math.abs(turn)) {
          turn = this.settings.invertTurn ? -deadzoned : deadzoned;
        }
      }

      // Read Throttle Axis (Left Stick Y / flight stick pitch)
      if (pad.axes.length > this.settings.throttleAxis) {
        const rawThrottle = pad.axes[this.settings.throttleAxis] ?? 0;
        const deadzoned = this.applyDeadzone(rawThrottle, this.settings.deadzone);
        if (Math.abs(deadzoned) > 0.2) {
          const dir = this.settings.invertThrottle ? -deadzoned : deadzoned;
          throttle = dir > 0 ? 1 : -1;
        }
      }

      // Check D-pad up/down for throttle stepping (Buttons 12 and 13)
      if (pad.buttons.length > 12 && pad.buttons[12]?.pressed) throttle = 1;
      if (pad.buttons.length > 13 && pad.buttons[13]?.pressed) throttle = -1;

      // Check Engine Button (A/Cross or RT/R2 trigger)
      const primaryBtn = pad.buttons[this.settings.engineButton];
      const secondaryBtn = pad.buttons[this.settings.secondaryEngineButton];
      if ((primaryBtn && (primaryBtn.pressed || primaryBtn.value > 0.25)) ||
          (secondaryBtn && (secondaryBtn.pressed || secondaryBtn.value > 0.25))) {
        engine = true;
      }

      // Priority goes to first active connected controller
      break;
    }

    return { turn, throttle, engine };
  }

  /** Detects single-press button transitions and fires shortcuts. */
  private pollShortcuts(pad: Gamepad): void {
    if (!this.onShortcutHandler) return;

    let prev = this.previousButtonStates.get(pad.index);
    if (!prev || prev.length !== pad.buttons.length) {
      prev = pad.buttons.map(b => b.pressed);
      this.previousButtonStates.set(pad.index, prev);
      return;
    }

    const checkEdge = (buttonIndex: number, action: ActionId): void => {
      const isDown = pad.buttons[buttonIndex]?.pressed ?? false;
      const wasDown = prev![buttonIndex] ?? false;
      if (isDown && !wasDown) {
        this.onShortcutHandler!(action);
      }
      prev![buttonIndex] = isDown;
    };

    // Standard mappings for Steam Deck, Xbox, PlayStation:
    // LB / L1 (4) or D-Pad Left (14) -> warpDown
    // RB / R1 (5) or D-Pad Right (15) -> warpUp
    // Start / Menu / Options (9) -> pause
    // Back / View / Share (8) -> reset
    // Y / Triangle (3) -> camera
    // X / Square (2) -> orientation
    // Stick click L3 (10) -> warpReset
    // Touchpad click on PlayStation (17) -> reset
    checkEdge(4, 'warpDown');
    checkEdge(5, 'warpUp');
    checkEdge(14, 'warpDown');
    checkEdge(15, 'warpUp');
    checkEdge(9, 'pause');
    checkEdge(8, 'reset');
    checkEdge(3, 'camera');
    checkEdge(2, 'orientation');
    checkEdge(10, 'warpReset');
    if (pad.buttons.length > 17) {
      checkEdge(17, 'reset');
    }
  }

  private applyDeadzone(value: number, deadzone: number): number {
    const abs = Math.abs(value);
    if (abs <= deadzone) return 0;
    const scaled = (abs - deadzone) / (1 - deadzone);
    return Math.sign(value) * Math.min(1, Math.max(0, scaled));
  }

  /** Returns diagnostic snapshot of all connected gamepads for configuration UI. */
  getDiagnostics(): GamepadDiagnostic[] {
    const pads = this.getGamepads();
    const result: GamepadDiagnostic[] = [];
    for (const pad of pads) {
      if (!pad) continue;
      const family = detectControllerFamily(pad.id);
      result.push({
        index: pad.index,
        id: pad.id,
        family,
        familyName: getControllerFamilyDisplayName(family),
        connected: pad.connected,
        axes: Array.from(pad.axes),
        buttons: pad.buttons.map((b, idx) => ({
          pressed: b.pressed,
          value: b.value,
          label: formatControllerButton(idx, family),
        })),
      });
    }
    return result;
  }
}
