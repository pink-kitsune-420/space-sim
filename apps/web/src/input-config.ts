export type ActionId =
  | 'engine'
  | 'turnLeft'
  | 'turnRight'
  | 'throttleUp'
  | 'throttleDown'
  | 'warpUp'
  | 'warpDown'
  | 'warpReset'
  | 'pause'
  | 'reset'
  | 'camera'
  | 'orientation'
  | 'fullscreen'
  | 'profiler'
  | 'zoomIn'
  | 'zoomOut'
  | 'cycleShip'
  | 'cycleShipPrev';

export type ActionCategory = 'flight' | 'warp' | 'view' | 'system';

export interface ActionDefinition {
  readonly id: ActionId;
  readonly name: string;
  readonly category: ActionCategory;
  readonly defaultKeys: readonly string[];
  readonly description: string;
}

export const ACTION_DEFINITIONS: readonly ActionDefinition[] = [
  // Flight controls
  {
    id: 'engine',
    name: 'Fire Main Engine',
    category: 'flight',
    defaultKeys: ['Space'],
    description: 'Thrust along the vessel nose direction',
  },
  {
    id: 'turnLeft',
    name: 'Turn Left (CCW)',
    category: 'flight',
    defaultKeys: ['ArrowLeft', 'KeyA'],
    description: 'Rotate ship counter-clockwise',
  },
  {
    id: 'turnRight',
    name: 'Turn Right (CW)',
    category: 'flight',
    defaultKeys: ['ArrowRight', 'KeyD'],
    description: 'Rotate ship clockwise',
  },
  {
    id: 'throttleUp',
    name: 'Increase Throttle',
    category: 'flight',
    defaultKeys: ['ArrowUp', 'KeyW'],
    description: 'Raise engine thrust percentage',
  },
  {
    id: 'throttleDown',
    name: 'Decrease Throttle',
    category: 'flight',
    defaultKeys: ['ArrowDown', 'KeyS'],
    description: 'Lower engine thrust percentage',
  },

  // Time warp
  {
    id: 'warpUp',
    name: 'Time Warp Up',
    category: 'warp',
    defaultKeys: ['BracketRight', 'Period'],
    description: 'Increase simulation time warp factor',
  },
  {
    id: 'warpDown',
    name: 'Time Warp Down',
    category: 'warp',
    defaultKeys: ['BracketLeft', 'Comma'],
    description: 'Decrease simulation time warp factor',
  },
  {
    id: 'warpReset',
    name: 'Reset Time Warp (1×)',
    category: 'warp',
    defaultKeys: ['Slash'],
    description: 'Return simulation immediately to real-time (1×)',
  },

  // View & Camera
  {
    id: 'camera',
    name: 'Cycle Camera Mode',
    category: 'view',
    defaultKeys: ['KeyC'],
    description: 'Switch between follow ship, planet view, and free pan',
  },
  {
    id: 'orientation',
    name: 'Toggle Orientation',
    category: 'view',
    defaultKeys: ['KeyH'],
    description: 'Toggle between North up and Ship horizon orientation',
  },
  {
    id: 'zoomIn',
    name: 'Zoom In',
    category: 'view',
    defaultKeys: ['Equal', 'NumpadAdd'],
    description: 'Zoom closer to the target',
  },
  {
    id: 'zoomOut',
    name: 'Zoom Out',
    category: 'view',
    defaultKeys: ['Minus', 'NumpadSubtract'],
    description: 'Zoom further away to see the wider orbit',
  },
  {
    id: 'fullscreen',
    name: 'Toggle Fullscreen',
    category: 'view',
    defaultKeys: ['KeyF'],
    description: 'Expand flight console to entire screen',
  },

  // System & Management
  {
    id: 'pause',
    name: 'Pause / Resume',
    category: 'system',
    defaultKeys: ['KeyP'],
    description: 'Pause or unpause physics simulation',
  },
  {
    id: 'reset',
    name: 'Reset Flight',
    category: 'system',
    defaultKeys: ['KeyR'],
    description: 'Restart flight from current preset scenario',
  },
  {
    id: 'cycleShip',
    name: 'Next Ship',
    category: 'system',
    defaultKeys: ['Backslash'],
    description: 'Switch pilot focus to next ship in world fleet',
  },
  {
    id: 'cycleShipPrev',
    name: 'Previous Ship',
    category: 'system',
    defaultKeys: [],
    description: 'Switch pilot focus to previous ship in fleet',
  },
  {
    id: 'profiler',
    name: 'Toggle Profiler',
    category: 'system',
    defaultKeys: ['Backquote'],
    description: 'Show frame timing graph and performance diagnostics',
  },
];

export type KeyBindings = Record<ActionId, string[]>;

export const DEFAULT_KEYBINDINGS: KeyBindings = Object.freeze(
  ACTION_DEFINITIONS.reduce((acc, def) => {
    acc[def.id] = [...def.defaultKeys];
    return acc;
  }, {} as KeyBindings)
);

const STORAGE_KEY = 'space-sim:keybindings:v1';

/** Maps KeyboardEvent.code strings to friendly human-readable glyphs or short labels. */
export function formatKeyCode(code: string): string {
  if (!code) return '';
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  switch (code) {
    case 'Space': return 'Space';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Backslash': return '\\';
    case 'Slash': return '/';
    case 'Period': return '.';
    case 'Comma': return ',';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'Backquote': return '`';
    case 'Escape': return 'Esc';
    case 'Tab': return 'Tab';
    case 'Enter': return 'Enter';
    case 'Backspace': return 'Backspace';
    default: return code;
  }
}

/** Loads active keybindings from localStorage or returns defaults if unset/invalid. */
export function loadKeybindings(): KeyBindings {
  const result: KeyBindings = { ...DEFAULT_KEYBINDINGS };
  for (const key of Object.keys(result) as ActionId[]) {
    result[key] = [...DEFAULT_KEYBINDINGS[key]];
  }

  if (typeof localStorage === 'undefined') return result;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return result;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null) return result;

    for (const def of ACTION_DEFINITIONS) {
      const keys = parsed[def.id];
      if (Array.isArray(keys) && keys.every(k => typeof k === 'string')) {
        result[def.id] = [...keys];
      }
    }
  } catch {
    // Ignore parse or storage errors and use defaults
  }
  return result;
}

/** Saves keybindings to localStorage. */
export function saveKeybindings(bindings: KeyBindings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  } catch {
    // Ignore storage quota errors
  }
}

/** Clears stored bindings from localStorage and returns fresh defaults. */
export function resetKeybindings(): KeyBindings {
  if (typeof localStorage !== 'undefined') {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
  return loadKeybindings();
}

/** Builds an inverted index mapping KeyCode -> ActionId[] for fast event dispatch. */
export function buildKeyLookup(bindings: KeyBindings): Map<string, ActionId[]> {
  const map = new Map<string, ActionId[]>();
  for (const [action, keys] of Object.entries(bindings) as Array<[ActionId, string[]]>) {
    for (const key of keys) {
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(action);
    }
  }
  return map;
}

/** Identifies continuous flight actions (held keys for flight physics). */
export const FLIGHT_ACTIONS = new Set<ActionId>([
  'engine',
  'turnLeft',
  'turnRight',
  'throttleUp',
  'throttleDown',
]);

/** Returns true if the action is a continuous flight hold action. */
export function isFlightAction(action: ActionId): boolean {
  return FLIGHT_ACTIONS.has(action);
}
