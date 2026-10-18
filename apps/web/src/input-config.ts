export type ActionId =
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
    defaultKeys: ['ArrowUp'],
    description: 'Increase persistent thrust by 1%; hold to ramp smoothly',
  },
  {
    id: 'throttleDown',
    name: 'Decrease Throttle',
    category: 'flight',
    defaultKeys: ['ArrowDown'],
    description: 'Decrease persistent thrust by 1%; hold to ramp smoothly',
  },
  {
    id: 'throttleFine', name: 'Fine Throttle', category: 'flight',
    defaultKeys: ['ControlLeft', 'ControlRight'], description: 'Hold for a slower throttle ramp and 0.2% taps',
  },
  {
    id: 'throttleCut', name: 'Cut Throttle', category: 'flight',
    defaultKeys: ['KeyX'], description: 'Set thrust to zero and coast',
  },
  {
    id: 'throttleRecall', name: 'Activate Remembered Throttle', category: 'flight',
    defaultKeys: ['KeyZ'], description: 'Start a persistent burn at the remembered activation throttle',
  },
  {
    id: 'throttleRemember', name: 'Remember Current Throttle', category: 'flight',
    defaultKeys: ['Shift+KeyZ'], description: 'Save current active thrust as this player’s activation throttle',
  },
  {
    id: 'throwShip',
    name: 'Throw Ship / Sling Orbit',
    category: 'flight',
    defaultKeys: ['KeyT'],
    description: 'Toggle or hold to slingshot your ship into orbit around any location',
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
    name: 'Next Ship / Target',
    category: 'system',
    defaultKeys: ['Tab', 'Backslash'],
    description: 'Switch pilot focus to next ship, or cycle celestial bodies in free view',
  },
  {
    id: 'cycleShipPrev',
    name: 'Previous Ship / Target',
    category: 'system',
    defaultKeys: ['Backspace'],
    description: 'Switch pilot focus to previous ship, or cycle celestial bodies in free view',
  },
  {
    id: 'cyclePlanet',
    name: 'Next Planet',
    category: 'view',
    defaultKeys: ['KeyN'],
    description: 'Focus camera on next planet in system order',
  },
  {
    id: 'cyclePlanetPrev',
    name: 'Previous Planet',
    category: 'view',
    defaultKeys: ['KeyB'],
    description: 'Focus camera on previous planet in system order',
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
  if (code.includes('+')) return code.split('+').map(formatKeyCode).join('+');
  if (code.startsWith('Key')) return code.slice(3).toUpperCase();
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  switch (code) {
    case 'Space': return 'Space';
    case 'ControlLeft': return 'Left Ctrl';
    case 'ControlRight': return 'Right Ctrl';
    case 'ShiftLeft': return 'Left Shift';
    case 'ShiftRight': return 'Right Shift';
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
    // Migrate only exact former defaults; retain custom throttle layouts and avoid
    // assigning newly introduced keys already owned by another customized action.
    const former = { throttleUp: ['ArrowUp', 'KeyW'], throttleDown: ['ArrowDown', 'KeyS'],
      throttleFine: ['ShiftLeft', 'ShiftRight'] } as const;
    const migrated = new Set<ActionId>();
    for (const action of Object.keys(former) as (keyof typeof former)[]) {
      const old = former[action];
      if (Array.isArray(parsed[action]) && result[action].length === old.length
        && result[action].every((code, i) => code === old[i])) {
        result[action] = [...DEFAULT_KEYBINDINGS[action]];
        migrated.add(action);
      }
    }
    for (const action of Object.keys(former) as (keyof typeof former)[]) {
      if (parsed[action] === undefined || migrated.has(action)) {
        result[action] = result[action].filter(code => !Object.keys(parsed).some(other =>
          other !== action && !migrated.has(other as ActionId) && result[other as ActionId]?.includes(code)));
      }
    }
    // Preserve older custom layouts when adding throttle actions to saved bindings.
    for (const action of ['throttleFine', 'throttleCut', 'throttleRecall', 'throttleRemember'] as const) {
      if (parsed[action] !== undefined) continue;
      result[action] = result[action].filter(code => !Object.keys(parsed).some(other =>
        other !== action && result[other as ActionId]?.includes(code)));
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
  'throttleFine',
  'turnLeft',
  'turnRight',
  'throttleUp',
  'throttleDown',
]);

/** Returns true if the action is a continuous flight hold action. */
export function isFlightAction(action: ActionId): boolean {
  return FLIGHT_ACTIONS.has(action);
}

/** Encode a shortcut chord. Modifier-only flight controls keep their physical key code. */
export function shortcutBinding(event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey'>): string {
  if (/^(Shift|Control|Meta|Alt)(Left|Right)$/.test(event.code)) return event.code;
  return `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Meta+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
}

/** An explicit chord wins over its bare key; held fine controls still allow bare arrows. */
export function resolveKeybinding(event: Pick<KeyboardEvent, 'code' | 'shiftKey' | 'ctrlKey' | 'metaKey'>,
  lookup: ReadonlyMap<string, readonly ActionId[]>): string {
  const chord = shortcutBinding(event);
  return lookup.has(chord) ? chord : event.code;
}
