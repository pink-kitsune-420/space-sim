import type { FlightActionId as ActionId, ControllerProfile, GamepadSettings, FlightControllerProfiles, ModuleInitializationV2 } from '@space-sim/game-api';
import { FLIGHT_PROFILES } from '@space-sim/game-api';
const ENABLED_KEY = 'space-sim:gamepad:v1';

/** Steam Deck, Xbox and PlayStation share the W3C standard mapping. */
export const DEFAULT_PAD_BUTTONS: Readonly<Record<ActionId, readonly number[]>> = Object.freeze({
  engine: [7],             // RT / R2 (held burn)
  throttleUp: [12],        // D-pad up
  throttleFine: [6],       // LT / L2
  throttleCut: [11],       // R3
  throttleRemember: [],   // Optional per-controller binding
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
  cameraRotateLeft: [], cameraRotateRight: [],
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
export function normalizeProfile(raw: unknown, d:ControllerProfile = DEFAULT_CONTROLLER_PROFILE): ControllerProfile {
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
  for (const action of ['throttleFine', 'throttleCut', 'throttleRecall', 'throttleRemember'] as const) {
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


/** The version 1 layout, for migrating player 1's controller settings. */
export function legacyProfile(defaults:ControllerProfile = DEFAULT_CONTROLLER_PROFILE): ControllerProfile | undefined {
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
      return normalizeProfile({ ...old, invertTurn: false, zoomAxis: undefined, invertZoom: undefined, buttons },defaults);
    } catch {
      return undefined;
    }
  }


export const FLIGHT_PROFILE_CODEC: FlightControllerProfiles = Object.freeze({
  defaultProfile: DEFAULT_CONTROLLER_PROFILE, normalize: normalizeProfile, legacy: legacyProfile,
});
export function createFlightProfileCodec(deadzone=.15):FlightControllerProfiles {
 if(!Number.isFinite(deadzone)||deadzone<0||deadzone>.5)throw new Error('Default controller deadzone must be in [0,0.5]');
 const defaults=Object.freeze({...DEFAULT_CONTROLLER_PROFILE,deadzone});
 return Object.freeze<FlightControllerProfiles>({defaultProfile:defaults,normalize:raw=>normalizeProfile(raw,defaults),legacy:()=>legacyProfile(defaults)});
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({"id": "usage", "audience": "creators", "title": "Flight controller profiles", "summary": "Editable flight mappings and legacy controller preference migration.", "asset": "docs/creators/usage.json"});
  context.provide(FLIGHT_PROFILES,createFlightProfileCodec(context.settings.defaultDeadzone??.15));
}
