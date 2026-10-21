import { createGamepadCapture, validateCaptureId, type GamepadCapture, type GamepadState } from './capture';
import type { FlightActionId as ActionId, ControllerFamily, ControllerProfile, GamepadSettings, GamepadFlightInput, GamepadDiagnostic, FlightControllerProfiles } from '@space-sim/game-api';
export type { ControllerFamily, ControllerProfile, GamepadSettings, GamepadFlightInput, GamepadDiagnostic } from '@space-sim/game-api';



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


/** Held actions read every frame; every other bound action fires on press. */
const HELD = new Set<ActionId>(['engine', 'throttleFine', 'throttleUp', 'throttleDown', 'turnLeft', 'turnRight']);

const ENABLED_KEY = 'space-sim:gamepad:v1';



export const NO_PAD_INPUT: GamepadFlightInput = Object.freeze({ turn: 0, throttle: 0, engine: false, zoom: 0 });



export function applyDeadzone(value: number, deadzone: number): number {
  const abs = Math.abs(value);
  if (abs <= deadzone) return 0;
  const scaled = (abs - deadzone) / (1 - deadzone);
  return Math.sign(value) * Math.min(1, Math.max(0, scaled));
}

export const isButtonDown = (button: Pick<GamepadButton, 'pressed' | 'value'> | undefined): boolean => !!button && (button.pressed || button.value > 0.25);
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
  private disposed = false;
  private readonly devices: GamepadCapture;
  private readonly ownsCapture: boolean;
  private sampledCaptureId: number | undefined;
  get captureId(): number | undefined { return this.sampledCaptureId; }
  private readonly previous = new Map<number, boolean[]>();
  private readonly input = new Map<number, GamepadFlightInput>();
  /** A released device must return to neutral before it can drive another target. */
  private readonly inhibited = new Set<number>();
  /** Last time (ms) each pad had a button down or a stick outside its deadzone. */
  readonly activity = new Map<number, number>();
  private capture: ((pad: number, button: number) => void) | undefined;
  private readonly disconnect = (event: GamepadEvent): void => { this.release(event.gamepad.index); };

  constructor(private readonly profiles: FlightControllerProfiles, capture?: GamepadCapture) {
    this.devices = capture ?? createGamepadCapture(); this.ownsCapture = !capture;
    this.loadSettings();
    if (typeof window !== 'undefined') {
      window.addEventListener('gamepaddisconnected', this.disconnect);
    }
  }

  release(pad?: number): void {
    if (pad === undefined) {
      for (const index of this.previous.keys()) this.inhibited.add(index);
      for (const index of this.input.keys()) this.inhibited.add(index);
      this.previous.clear(); this.input.clear(); this.activity.clear();
    } else {
      this.inhibited.add(pad); this.previous.delete(pad); this.input.delete(pad); this.activity.delete(pad);
    }
  }

  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    if (typeof window !== 'undefined') window.removeEventListener('gamepaddisconnected', this.disconnect);
    this.release(); this.capture = undefined; this.legacyShortcutHandler = undefined;
    this.inhibited.clear(); this.sampledCaptureId = undefined; if (this.ownsCapture) this.devices.dispose();
  }

  private loadSettings(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      const raw = localStorage.getItem(ENABLED_KEY);
      if (raw) this.enabled = (JSON.parse(raw) as { enabled?: unknown }).enabled !== false;
    } catch {
      // Use defaults
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.release();
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(ENABLED_KEY, JSON.stringify({ enabled }));
    } catch {
      // Ignore
    }
  }

  /** Connected numeric copies from this input owner's capture. Native failure stays neutral. */
  private pads(captureId?: number): readonly GamepadState[] {
    validateCaptureId(captureId);
    if (this.disposed) return [];
    try { return this.devices.read(captureId).connected; } catch { return []; }
  }

  /** Indices of connected pads, lowest first; the returned list remains detached. */
  connected(captureId?: number): number[] {
    return this.pads(captureId).map(p => p.index).sort((a, b) => a - b);
  }

  /** Call once per frame. `profileFor` gives each pad's layout (undefined: unassigned, which
   * still reports raw presses through `onPress`); `onAction` receives mapped presses. */
  update(profileFor: (pad: number) => ControllerProfile | undefined,
      onAction: (pad: number, action: ActionId) => void,
      onPress?: (pad: number, button: number) => void, captureId?: number): void {
    if (this.disposed) return;
    const pads = this.pads(captureId); this.sampledCaptureId = captureId;
    this.updatePads(pads, profileFor, onAction, onPress);
  }

  private updatePads(pads: readonly GamepadState[], profileFor: (pad: number) => ControllerProfile | undefined,
      onAction: (pad: number, action: ActionId) => void, onPress?: (pad: number, button: number) => void): void {
    const now = typeof performance !== 'undefined' ? performance.now() : 0;
    // Polling must release a missing pad even when the browser supplies no event.
    for (const index of this.previous.keys()) {
      let connected = false;
      for (let i = 0; i < pads.length; i++) if (pads[i]!.index === index) { connected = true; break; }
      if (!connected) this.release(index);
    }
    for (const pad of pads) {
      const down = pad.buttons.map(isDown);
      const before = this.previous.get(pad.index);
      this.previous.set(pad.index, down);
      if (down.some(Boolean) || pad.axes.some(a => Math.abs(a) > 0.5)) this.activity.set(pad.index, now);
      if (!this.enabled) continue;
      const profile = profileFor(pad.index);
      const input = profile ? readPad(pad, profile) : NO_PAD_INPUT;
      if (this.inhibited.has(pad.index)) {
        if (!input.engine && input.turn === 0 && input.throttle === 0 && input.zoom === 0) this.inhibited.delete(pad.index);
        this.input.set(pad.index, NO_PAD_INPUT);
      } else this.input.set(pad.index, input);
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
    if (this.disposed) return;
    this.capture = listener;
  }
  get capturing(): boolean { return !!this.capture; }

  /** Borrowed numeric copies for synchronous cursor/input consumers, valid until next capture. */
  readDevices(captureId?: number): readonly GamepadState[] { return this.pads(captureId); }

  /** Diagnostic snapshot of all connected gamepads for the configuration UI. */
  getDiagnostics(captureId?: number): GamepadDiagnostic[] {
    return this.pads(captureId).map(pad => {
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
      turnAxis: this.profiles.defaultProfile.turnAxis,
      invertTurn: this.profiles.defaultProfile.invertTurn,
      throttleAxis: this.profiles.defaultProfile.throttleAxis,
      invertThrottle: this.profiles.defaultProfile.invertThrottle,
      deadzone: this.profiles.defaultProfile.deadzone,
      engineButton: 7,
      secondaryEngineButton: 7,
    };
  }

  private legacyShortcutHandler?: (action: ActionId) => void;
  onShortcut(handler: (action: ActionId) => void): void {
    if (this.disposed) return;
    this.legacyShortcutHandler = handler;
  }

  pollFlight(captureId?: number): GamepadFlightInput {
    if (this.disposed) return NO_PAD_INPUT;
    const pads = this.pads(captureId); this.sampledCaptureId = captureId;
    if (!pads.length || !this.enabled) return NO_PAD_INPUT;
    this.updatePads(pads, () => this.profiles.defaultProfile, (_pad, action) => {
      this.legacyShortcutHandler?.(action);
    });
    return this.flight(pads[0]!.index);
  }
}
