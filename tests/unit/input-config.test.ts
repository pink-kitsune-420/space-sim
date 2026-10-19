import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  ACTION_DEFINITIONS,
  DEFAULT_KEYBINDINGS,
  buildKeyLookup,
  formatKeyCode,
  isFlightAction,
  loadKeybindings,
  resetKeybindings,
  saveKeybindings,
  resolveKeybinding, shortcutBinding,
} from '../../apps/web/src/input-config';
import {
  GamepadManager,
  DEFAULT_GAMEPAD_SETTINGS,
  detectControllerFamily,
  formatControllerButton,
  getControllerFamilyDisplayName,
} from '../../apps/web/src/gamepad';
import { bindFlightInput } from '../../apps/web/src/input';

describe('input configuration and keybindings', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('defines all required core actions and default settings', () => {
    expect(ACTION_DEFINITIONS.length).toBeGreaterThan(10);
    expect(DEFAULT_GAMEPAD_SETTINGS.enabled).toBe(true);
    expect(DEFAULT_KEYBINDINGS.reset).toContain('KeyR');
    expect(DEFAULT_KEYBINDINGS.cameraRotateLeft).toEqual(['Shift+ArrowLeft']);
    expect(DEFAULT_KEYBINDINGS.cameraRotateRight).toEqual(['Shift+ArrowRight']);
    const lookup = buildKeyLookup(DEFAULT_KEYBINDINGS);
    expect(resolveKeybinding({ code: 'ArrowLeft', shiftKey: true, ctrlKey: false, metaKey: false }, lookup)).toBe('Shift+ArrowLeft');
    expect(lookup.get('Shift+ArrowLeft')).toEqual(['cameraRotateLeft']);
  });

  it('includes [ and ] in default warp bindings', () => {
    expect(DEFAULT_KEYBINDINGS.warpUp).toContain('BracketRight');
    expect(DEFAULT_KEYBINDINGS.warpUp).toContain('Period');
    expect(DEFAULT_KEYBINDINGS.warpDown).toContain('BracketLeft');
    expect(DEFAULT_KEYBINDINGS.warpDown).toContain('Comma');
    expect(DEFAULT_KEYBINDINGS.cycleShip).toContain('Backslash');
  });

  it('formats key codes into readable labels', () => {
    expect(formatKeyCode('Space')).toBe('Space');
    expect(formatKeyCode('BracketLeft')).toBe('[');
    expect(formatKeyCode('BracketRight')).toBe(']');
    expect(formatKeyCode('Backslash')).toBe('\\');
    expect(formatKeyCode('ArrowLeft')).toBe('←');
    expect(formatKeyCode('ArrowRight')).toBe('→');
    expect(formatKeyCode('ArrowUp')).toBe('↑');
    expect(formatKeyCode('ArrowDown')).toBe('↓');
    expect(formatKeyCode('KeyW')).toBe('W');
    expect(formatKeyCode('KeyA')).toBe('A');
    expect(formatKeyCode('Digit5')).toBe('5');
    expect(formatKeyCode('NumpadAdd')).toBe('Num Add');
  });

  it('correctly classifies flight continuous actions vs shortcut actions', () => {
    expect(isFlightAction('engine')).toBe(true);
    expect(isFlightAction('turnLeft')).toBe(true);
    expect(isFlightAction('turnRight')).toBe(true);
    expect(isFlightAction('throttleUp')).toBe(true);
    expect(isFlightAction('throttleDown')).toBe(true);

    expect(isFlightAction('warpUp')).toBe(false);
    expect(isFlightAction('warpDown')).toBe(false);
    expect(isFlightAction('pause')).toBe(false);
    expect(isFlightAction('camera')).toBe(false);
    expect(isFlightAction('cycleShip')).toBe(false);
  });

  it('builds inverted key lookup index', () => {
    const lookup = buildKeyLookup(DEFAULT_KEYBINDINGS);
    expect(lookup.get('BracketRight')).toEqual(['warpUp']);
    expect(lookup.get('BracketLeft')).toEqual(['warpDown']);
    expect(lookup.get('Period')).toEqual(['warpUp']);
    expect(lookup.get('Comma')).toEqual(['warpDown']);
    expect(lookup.get('Space')).toEqual(['engine']);
    expect(lookup.get('ArrowLeft')).toEqual(['turnLeft']);
  });

  it('persists and restores custom keybindings in localStorage', () => {
    const custom = loadKeybindings();
    custom.warpUp = ['KeyE'];
    custom.warpDown = ['KeyQ'];
    saveKeybindings(custom);

    const reloaded = loadKeybindings();
    expect(reloaded.warpUp).toEqual(['KeyE']);
    expect(reloaded.warpDown).toEqual(['KeyQ']);

    // Reset restores defaults
    const reset = resetKeybindings();
    expect(reset.warpUp).toContain('BracketRight');
    expect(reset.warpDown).toContain('BracketLeft');
  });

  it('migrates former throttle defaults and leaves customized actions intact', () => {
    mockStorage['space-sim:keybindings:v1'] = JSON.stringify({
      throttleUp: ['ArrowUp', 'KeyW'], throttleDown: ['ArrowDown', 'KeyS'],
      throttleFine: ['ShiftLeft', 'ShiftRight'], camera: ['Shift+KeyZ'],
    });
    const migrated = loadKeybindings();
    expect(migrated.throttleUp).toEqual(['ArrowUp']);
    expect(migrated.throttleDown).toEqual(['ArrowDown']);
    expect(migrated.throttleFine).toEqual(['ControlLeft', 'ControlRight']);
    expect(migrated.throttleRemember).toEqual([]);
    saveKeybindings(migrated);
    expect(loadKeybindings()).toEqual(migrated);
    migrated.throttleUp = ['KeyU']; migrated.throttleDown = [];
    saveKeybindings(migrated);
    expect(loadKeybindings().throttleUp).toEqual(['KeyU']);
    expect(loadKeybindings().throttleDown).toEqual([]);
    expect(formatKeyCode('ControlLeft')).toBe('Left Ctrl');
    expect(buildKeyLookup(DEFAULT_KEYBINDINGS).get('ShiftLeft')).toBeUndefined();
    expect(formatKeyCode('Shift+KeyZ')).toBe('Shift+Z');
    expect(Object.values(DEFAULT_KEYBINDINGS).flat().some(code => code.startsWith('Alt'))).toBe(false);
  });

  it('resolves remember chords ahead of recall while Ctrl allows fine arrow input', () => {
    const lookup = buildKeyLookup(DEFAULT_KEYBINDINGS);
    const key = { code: 'KeyZ', shiftKey: true, ctrlKey: false, metaKey: false };
    expect(shortcutBinding(key)).toBe('Shift+KeyZ');
    expect(resolveKeybinding(key, lookup)).toBe('Shift+KeyZ');
    expect(resolveKeybinding({ ...key, shiftKey: false }, lookup)).toBe('KeyZ');
    expect(resolveKeybinding({ ...key, code: 'ArrowUp', shiftKey: false, ctrlKey: true }, lookup)).toBe('ArrowUp');
  });

  it('preserves older custom keys without adding conflicting throttle actions', () => {
    mockStorage['space-sim:keybindings:v1'] = JSON.stringify({ camera: ['KeyZ'], pause: ['KeyX'], turnLeft: ['ShiftLeft'] });
    const loaded = loadKeybindings();
    expect(loaded.camera).toEqual(['KeyZ']);
    expect(loaded.throttleRecall).toEqual([]);
    expect(loaded.throttleCut).toEqual([]);
    expect(loaded.throttleFine).toEqual(['ControlLeft', 'ControlRight']);
    expect(loaded.throttleUp).toEqual(['ArrowUp']);
  });
});

describe('gamepad manager', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
  });

  it('initializes with default settings', () => {
    const manager = new GamepadManager();
    const settings = manager.getSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.turnAxis).toBe(0);
    expect(settings.deadzone).toBe(0.15);
    expect(settings.engineButton).toBe(7);
  });

  it('safely handles environments with no gamepad connected', () => {
    vi.stubGlobal('navigator', {
      getGamepads: () => [],
    });

    const manager = new GamepadManager();
    const flight = manager.pollFlight();
    expect(flight).toEqual({ turn: 0, throttle: 0, engine: false, zoom: 0 });
    expect(manager.getDiagnostics()).toEqual([]);
  });

  it('reads analog turn and throttle with deadzone from connected gamepad', () => {
    const fakePad = {
      index: 0,
      id: 'Standard Flight Stick',
      connected: true,
      axes: [-0.75, -0.8, 0, 0], // Axis 0: turn left (CCW); Axis 1: push forward (throttle up with invert)
      buttons: [
        { pressed: false, value: 0 }, // Button 0: persistent activation
        ...Array.from({ length: 7 }, (_, i) => ({ pressed: i === 6, value: i === 6 ? 1 : 0 })),
      ],
    };

    vi.stubGlobal('navigator', {
      getGamepads: () => [fakePad],
    });

    const manager = new GamepadManager();
    const flight = manager.pollFlight();

    // Turn should be positive (scaled by deadzone: (0.75 - 0.15) / 0.85 ~= 0.705)
    expect(flight.turn).toBeGreaterThan(0.5);
    // Throttle should be positive (stick forward with invertThrottle = true)
    expect(flight.throttle).toBe(1);
    // Engine button pressed
    expect(flight.engine).toBe(true);
  });

  it('filters out stick jitter within deadzone', () => {
    const jitterPad = {
      index: 0,
      id: 'Jittery Stick',
      connected: true,
      axes: [0.08, 0.05, 0, 0], // Jitter <= 0.15 deadzone
      buttons: [{ pressed: false, value: 0 }],
    };

    vi.stubGlobal('navigator', {
      getGamepads: () => [jitterPad],
    });

    const manager = new GamepadManager();
    const flight = manager.pollFlight();
    expect(flight.turn).toBe(0);
    expect(flight.throttle).toBe(0);
    expect(flight.engine).toBe(false);
  });

  it('fires edge-triggered button shortcuts', () => {
    let capturedShortcut = '';
    const fakePad = {
      index: 0,
      id: 'Gamepad 1',
      connected: true,
      axes: [0, 0],
      buttons: new Array(16).fill(null).map(() => ({ pressed: false, value: 0 })),
    };

    vi.stubGlobal('navigator', {
      getGamepads: () => [fakePad],
    });

    const manager = new GamepadManager();
    manager.onShortcut(action => {
      capturedShortcut = action;
    });

    // Initial poll: no buttons pressed
    manager.pollFlight();
    expect(capturedShortcut).toBe('');

    // Press RB (button 5) -> warpUp
    fakePad.buttons[5] = { pressed: true, value: 1 };
    manager.pollFlight();
    expect(capturedShortcut).toBe('warpUp');

    // Holding button across next frame should NOT refire shortcut
    capturedShortcut = '';
    manager.pollFlight();
    expect(capturedShortcut).toBe('');

    // Release and press LB (button 4) -> warpDown
    fakePad.buttons[5] = { pressed: false, value: 0 };
    fakePad.buttons[4] = { pressed: true, value: 1 };
    manager.pollFlight();
    expect(capturedShortcut).toBe('warpDown');
  });

  it('detects Steam Deck, Xbox, and PlayStation controller families and formats buttons', () => {
    // Steam Deck
    expect(detectControllerFamily('Steam Deck (Vendor: 28de Product: 11ff)')).toBe('steam-deck');
    expect(detectControllerFamily('Valve Steam Controller')).toBe('steam-deck');
    expect(getControllerFamilyDisplayName('steam-deck')).toContain('Steam Deck');
    expect(formatControllerButton(0, 'steam-deck')).toBe('A');
    expect(formatControllerButton(4, 'steam-deck')).toBe('L1 (Bumper)');
    expect(formatControllerButton(7, 'steam-deck')).toBe('R2 (Trigger)');

    // Xbox
    expect(detectControllerFamily('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(detectControllerFamily('Xbox Wireless Controller (045e:0b12)')).toBe('xbox');
    expect(getControllerFamilyDisplayName('xbox')).toContain('Xbox');
    expect(formatControllerButton(0, 'xbox')).toBe('A');
    expect(formatControllerButton(4, 'xbox')).toBe('LB');
    expect(formatControllerButton(7, 'xbox')).toBe('RT Trigger');

    // PlayStation
    expect(detectControllerFamily('Sony Interactive Entertainment Wireless Controller (054c:0ce6)')).toBe('playstation');
    expect(detectControllerFamily('DualSense Wireless Controller')).toBe('playstation');
    expect(detectControllerFamily('PS4 DualShock 4')).toBe('playstation');
    expect(getControllerFamilyDisplayName('playstation')).toContain('PlayStation');
    expect(formatControllerButton(0, 'playstation')).toBe('Cross (✕)');
    expect(formatControllerButton(1, 'playstation')).toBe('Circle (◯)');
    expect(formatControllerButton(2, 'playstation')).toBe('Square (▢)');
    expect(formatControllerButton(3, 'playstation')).toBe('Triangle (△)');
    expect(formatControllerButton(4, 'playstation')).toBe('L1');
    expect(formatControllerButton(5, 'playstation')).toBe('R1');
    expect(formatControllerButton(7, 'playstation')).toBe('R2 Trigger');
  });
});

describe('bindFlightInput lifecycle events', () => {
  it('releases held steering when a modifier selects a camera shortcut, without restoring stale intent', () => {
    const handlers: Record<string, ((event: KeyboardEvent) => void)[]> = {};
    const target = { addEventListener(type: string, fn: (event: KeyboardEvent) => void) { (handlers[type] ??= []).push(fn); }, removeEventListener() {} };
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', { ...target, querySelectorAll: () => [] });
    const keys = new Set<string>(), shortcuts: string[] = [], lookup = buildKeyLookup(DEFAULT_KEYBINDINGS);
    const binding = bindFlightInput({ keys, pointers: new Map(), paused: () => false,
      binding: event => resolveKeybinding(event, lookup),
      isFlightKey: code => lookup.get(code)?.some(isFlightAction) ?? false,
      isShortcutKey: code => lookup.get(code)?.some(action => !isFlightAction(action)) ?? false,
      shortcut: code => { shortcuts.push(code); }, command: () => false, autoPause() {}, visibility() {} });
    const down = (code: string, shiftKey = false) => {
      const event = { code, shiftKey, ctrlKey: false, metaKey: false, altKey: false, repeat: false,
        target: { closest: () => null }, preventDefault() {} } as unknown as KeyboardEvent;
      for (const handler of handlers.keydown ?? []) handler(event);
    };
    down('ArrowLeft'); expect(keys.has('ArrowLeft')).toBe(true);
    down('ShiftLeft', true); expect(keys.has('ArrowLeft')).toBe(false);
    down('ArrowLeft', true); expect(shortcuts).toEqual(['Shift+ArrowLeft']); expect(keys.size).toBe(0);
    down('ShiftLeft'); expect(keys.size).toBe(0);
    down('ArrowLeft'); expect(keys.has('ArrowLeft')).toBe(true);
    binding.dispose();
  });

  it('calls autoPause on blur and pagehide, and autoResume on focus and pageshow', () => {
    const windowListeners: Record<string, Function[]> = {};
    const docListeners: Record<string, Function[]> = {};

    const mockWindow = {
      addEventListener: (type: string, fn: Function) => {
        windowListeners[type] = windowListeners[type] || [];
        windowListeners[type].push(fn);
      },
    };
    const mockDocument = {
      addEventListener: (type: string, fn: Function) => {
        docListeners[type] = docListeners[type] || [];
        docListeners[type].push(fn);
      },
      querySelectorAll: () => [],
      hidden: false,
    };

    vi.stubGlobal('window', mockWindow);
    vi.stubGlobal('document', mockDocument);

    const pauses: string[] = [];
    const resumes: string[] = [];
    bindFlightInput({
      keys: new Set(),
      pointers: new Map(),
      paused: () => false,
      shortcut: () => {},
      command: () => false,
      autoPause: (reason) => pauses.push(reason),
      autoResume: (reason) => resumes.push(reason),
      visibility: () => {},
    });

    // blur triggers autoPause
    for (const h of windowListeners['blur'] || []) h();
    expect(pauses).toContain('Window lost focus');

    // focus triggers autoResume
    for (const h of windowListeners['focus'] || []) h();
    expect(resumes).toContain('Window focused');

    // visibility change hidden triggers autoPause
    mockDocument.hidden = true;
    for (const h of docListeners['visibilitychange'] || []) h();
    expect(pauses).toContain('Tab was hidden');

    // visibility change visible triggers autoResume
    mockDocument.hidden = false;
    for (const h of docListeners['visibilitychange'] || []) h();
    expect(resumes).toContain('Tab was shown');

    // pageshow triggers autoResume
    for (const h of windowListeners['pageshow'] || []) h();
    expect(resumes).toContain('Page was shown');
  });
});

