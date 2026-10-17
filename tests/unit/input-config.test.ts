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
} from '../../apps/web/src/input-config';
import {
  GamepadManager,
  DEFAULT_GAMEPAD_SETTINGS,
  detectControllerFamily,
  formatControllerButton,
  getControllerFamilyDisplayName,
} from '../../apps/web/src/gamepad';

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
    expect(settings.engineButton).toBe(0);
  });

  it('safely handles environments with no gamepad connected', () => {
    vi.stubGlobal('navigator', {
      getGamepads: () => [],
    });

    const manager = new GamepadManager();
    const flight = manager.pollFlight();
    expect(flight).toEqual({ turn: 0, throttle: 0, engine: false });
    expect(manager.getDiagnostics()).toEqual([]);
  });

  it('reads analog turn and throttle with deadzone from connected gamepad', () => {
    const fakePad = {
      index: 0,
      id: 'Standard Flight Stick',
      connected: true,
      axes: [0.75, -0.8, 0, 0], // Axis 0: turn right; Axis 1: push forward (throttle up with invert)
      buttons: [
        { pressed: true, value: 1.0 }, // Button 0: Engine firing
        { pressed: false, value: 0 },
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

