import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  assignDevice,
  defaultLocalPlayers,
  dynamicPaneRects,
  keyboardOwner,
  loadLocalPlayers,
  padDevice,
  padOwner,
  paneRects,
  saveLocalPlayers,
  setPlayerCount,
  updateSlot,
  computeNavballCenter,
  defaultNavballPlacement,
  normalizeNavballPlacement,
  setSlotNavball,
  setAllNavballsPinned,
} from '../../apps/web/src/local-players';
import { SplitScreen } from '../../apps/web/src/split-screen';
import { CameraController } from '../../apps/web/src/camera';
import { GamepadManager, DEFAULT_PAD_BUTTONS, DEFAULT_CONTROLLER_PROFILE, readPad, isButtonDown } from '../../apps/web/src/gamepad';
import { drawNavball, type NavballState } from '../../modules/navball/src/drawing';
import { IDLE, type State } from '../../packages/sim-core/src/index';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { LocalSession } from '../../apps/web/src/session';
import { HostSession } from '../../packages/net/src/host';

afterEach(() => vi.unstubAllGlobals());

describe('real local pilot seats', () => {
  it('routes held controls only to the guest owner and releases them when the guest leaves', () => {
    const local = new LocalSession(new World(DEFAULT_UNIVERSE), { name: 'Primary' });
    const primary = local.spawn('pad', false)!;
    const pilot = local.seatGuest('Wingman', 'a'.repeat(32));
    const guest = local.spawnGuest(pilot, 'pad');
    const burn = { turn: 0, throttle: 0, engine: true };
    local.guestControls(pilot, primary, burn);
    expect(local.world.ship(primary)!.controls.engine).toBe(false);
    local.guestControls(pilot, guest, burn);
    local.update(.02, primary, IDLE);
    expect(local.world.ship(guest)!.state.status).toBe('flying');
    expect(local.world.ship(primary)!.state.status).toBe('landed');
    expect(() => local.host.setControls(pilot, primary, burn)).toThrow(/own ships/);
    local.unseatGuest(pilot);
    expect(local.world.ship(guest)!.controls).toEqual(IDLE);
    expect(local.players().find(p => p.id === pilot)?.connected).toBe(false);
    expect(local.seatGuest('Returning pilot', 'a'.repeat(32))).toBe(pilot);
  });

  it('counts local seats toward the host player limit and preserves God mode on a guest respawn', () => {
    const host = new HostSession(new World(DEFAULT_UNIVERSE), { maxPlayers: 2 });
    host.seatHost('Primary', 'b'.repeat(32));
    const pilot = host.seatLocal('Wingman', 'c'.repeat(32));
    expect(host.connectedCount()).toBe(2);
    expect(() => host.seatLocal('Third', 'd'.repeat(32))).toThrow(/full/);
    const ship = host.spawnShip(pilot, 'pad', true);
    expect(host.respawnShip(pilot, ship.id, 'planet-orbit').state.godMode).toBe(true);
    expect(host.respawnShip(pilot, ship.id, 'pad', false).state.godMode).toBeUndefined();
    host.unseatLocal(pilot);
    expect(host.connectedCount()).toBe(1);
    expect(host.seatLocal('Third', 'd'.repeat(32))).toBeTruthy();
  });
});

function createMockElement(tag = 'div'): any {
  const listeners: Record<string, Function[]> = {};
  const attrs = new Map<string, string>();
  const children: any[] = [];
  const styleProps = new Map<string, string>();

  const styleObj: any = {
    setProperty: (k: string, v: string) => styleProps.set(k, v),
    getPropertyValue: (k: string) => styleProps.get(k) ?? '',
    removeProperty: (k: string) => { const value = styleProps.get(k) ?? ''; styleProps.delete(k); return value; },
  };

  const el: any = {
    tagName: tag.toUpperCase(),
    id: '',
    className: '',
    style: styleObj,
    dataset: {},
    children,
    hidden: false,
    clientWidth: 1920,
    clientHeight: 1080,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    toggleAttribute: (k: string, force?: boolean) => {
      const set = force !== undefined ? force : !attrs.has(k);
      if (set) attrs.set(k, ''); else attrs.delete(k);
      return set;
    },
    append: (...items: any[]) => {
      for (const item of items) children.push(item);
    },
    after: (sibling: any) => {
      children.push(sibling);
    },
    remove: vi.fn(),
    replaceWith: () => {},
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    addEventListener: (type: string, handler: Function) => {
      listeners[type] = listeners[type] || [];
      listeners[type].push(handler);
    },
    querySelector: (sel: string): any => {
      if (sel === 'canvas#flight-view' || sel === '#flight-view') {
        const found = children.find(c => c.id === 'flight-view');
        return found ?? createMockElement('canvas');
      }
      return null;
    },
  };

  Object.defineProperty(el, 'innerHTML', {
    get: () => '',
    set: () => {
      children.length = 0;
      children.push(createMockElement('b'), createMockElement('span'), createMockElement('span'));
    },
  });

  return el;
}

describe('split-screen configuration and dynamic viewports', () => {
  let mockStorage: Record<string, string> = {};

  beforeEach(() => {
    mockStorage = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => mockStorage[key] ?? null,
      setItem: (key: string, value: string) => { mockStorage[key] = value; },
      removeItem: (key: string) => { delete mockStorage[key]; },
      clear: () => { mockStorage = {}; },
    });
    vi.stubGlobal('document', {
      createElement: (tag: string) => createMockElement(tag),
    });
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
      unobserve() {}
    });
  });

  describe('LocalPlayersConfig & Device Assignments', () => {
    it('requires neutral flight input after release, disable and a polled disconnect', () => {
      const pad = { index: 0, connected: true, id: 'Test pad', axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })) };
      let connected = true;
      vi.stubGlobal('navigator', { getGamepads: () => connected ? [pad] : [] });
      const pads = new GamepadManager();
      const poll = () => pads.update(() => DEFAULT_CONTROLLER_PROFILE, () => {});
      poll(); pad.buttons[7] = { pressed: true, value: 1 }; poll(); expect(pads.flight(0).engine).toBe(true);
      pads.release(0); poll(); expect(pads.flight(0).engine).toBe(false);
      pad.buttons[7] = { pressed: false, value: 0 }; poll();
      pad.buttons[7] = { pressed: true, value: 1 }; poll(); expect(pads.flight(0).engine).toBe(true);
      connected = false; poll(); expect(pads.flight(0).engine).toBe(false);
      connected = true; poll(); expect(pads.flight(0).engine).toBe(false);
      pad.buttons[7] = { pressed: false, value: 0 }; poll();
      pad.buttons[7] = { pressed: true, value: 1 }; poll(); expect(pads.flight(0).engine).toBe(true);
      pads.setEnabled(false); poll(); pads.setEnabled(true); poll(); expect(pads.flight(0).engine).toBe(false);
      pads.dispose();
    });
    it('initializes with default 1 player and dynamic screen mode', () => {
      const config = defaultLocalPlayers();
      expect(config.count).toBe(1);
      expect(config.screenMode).toBe('dynamic');
      expect(config.twoPlayerLayout).toBe('auto');
      expect(config.slots.length).toBe(4);
      expect(config.slots[0]!.device).toBe('auto');
      expect(config.slots[1]!.device).toBe('none');
    });

    it('assigns and transfers devices cleanly', () => {
      let config = defaultLocalPlayers();
      config = setPlayerCount(config, 2);
      config = assignDevice(config, 1, padDevice(0));
      expect(config.slots[1]!.device).toBe('pad:0');

      // Reassigning pad:0 to slot 0 takes it away from slot 1
      config = assignDevice(config, 0, padDevice(0));
      expect(config.slots[0]!.device).toBe('pad:0');
      expect(config.slots[1]!.device).toBe('none');

      // Reassigning pad:0 to slot 1 causes slot 0 to fall back to 'auto'
      config = assignDevice(config, 1, padDevice(0));
      expect(config.slots[1]!.device).toBe('pad:0');
      expect(config.slots[0]!.device).toBe('auto');
    });

    it('determines pad owners based on active player count', () => {
      let config = defaultLocalPlayers();
      // Solo player on auto owns all connected pads
      expect(padOwner(config, 0, [0, 1])).toBe(0);
      expect(padOwner(config, 1, [0, 1])).toBe(0);

      // In 2-player split screen, P1 on auto only claims the first free pad
      config = setPlayerCount(config, 2);
      expect(padOwner(config, 0, [0, 1])).toBe(0);
      expect(padOwner(config, 1, [0, 1])).toBeUndefined(); // Pad 1 is left free for join/P2

      // Explicit claim wins
      config = assignDevice(config, 1, padDevice(1));
      expect(padOwner(config, 1, [0, 1])).toBe(1);
    });

    it('determines keyboard owner correctly', () => {
      let config = defaultLocalPlayers();
      expect(keyboardOwner(config)).toBe(0);

      config = setPlayerCount(config, 2);
      config = assignDevice(config, 1, 'keyboard');
      expect(keyboardOwner(config)).toBe(1);
    });

    it('persists and normalizes config in localStorage', () => {
      let config = defaultLocalPlayers();
      config = setPlayerCount(config, 3);
      config = updateSlot(config, 1, { name: 'Wingman One' });
      saveLocalPlayers(config);

      const loaded = loadLocalPlayers();
      expect(loaded.count).toBe(3);
      expect(loaded.slots[1]!.name).toBe('Wingman One');
    });
  });

  describe('paneRects & dynamicPaneRects', () => {
    it('computes standard static pane rectangles', () => {
      // 1 player
      expect(paneRects(1, 'auto', 1920, 1080)).toEqual([{ x: 0, y: 0, w: 1, h: 1 }]);

      // 2 players landscape (side-by-side)
      const rects2 = paneRects(2, 'auto', 1920, 1080);
      expect(rects2[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
      expect(rects2[1]).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });

      // 4 players (quads)
      const rects4 = paneRects(4, 'auto', 1920, 1080);
      expect(rects4.length).toBe(4);
      expect(rects4[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 0.5 });
      expect(rects4[3]).toEqual({ x: 0.5, y: 0.5, w: 0.5, h: 0.5 });
    });

    it('computes dynamic pane rects when players are shared vs separated', () => {
      // 2 players, 0 separated (shared screen)
      const shared2 = dynamicPaneRects(2, new Set(), 'auto', 1920, 1080);
      expect(shared2.visible).toEqual([true, false]);
      expect(shared2.rects[0]).toEqual({ x: 0, y: 0, w: 1, h: 1 });
      expect(shared2.rects[1]!.w).toBe(0); // Collapsed

      // 2 players, guest 1 separated
      const split2 = dynamicPaneRects(2, new Set([1]), 'auto', 1920, 1080);
      expect(split2.visible).toEqual([true, true]);
      expect(split2.rects[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
      expect(split2.rects[1]).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });

      // 4 players, only player 2 is separated
      const split4 = dynamicPaneRects(4, new Set([2]), 'auto', 1920, 1080);
      expect(split4.visible).toEqual([true, false, true, false]);
      // Active slots are 0 and 2, each taking half the screen
      expect(split4.rects[0]).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
      expect(split4.rects[2]).toEqual({ x: 0.5, y: 0, w: 0.5, h: 1 });
      expect(split4.rects[1]!.w).toBe(0);
      expect(split4.rects[3]!.w).toBe(0);
    });
  });

  describe('SplitScreen Dynamic Split Logic', () => {
    function createMockSplitScreen(withGamepads = true, singleView?: () => boolean): {
      split: SplitScreen;
      p1Camera: CameraController;
      container: any;
      local: any;
      gamepads: GamepadManager;
    } {
      const container = createMockElement('div');
      const canvas = createMockElement('canvas');
      canvas.id = 'flight-view';
      container.append(canvas);

      const gamepads = new GamepadManager();
      const mockSession = {
        world: {
          ship: () => undefined,
          record: () => undefined,
          records: () => [],
          ownedBy: () => [],
          presetId: (p: string) => p,
          system: {
            getBodyPosition: () => ({ x: 0, y: 0 }),
          },
          hasBody: () => true,
          body: () => ({ id: 'primus', name: 'Primus', radius: 600000, mu: 3.5e12 }),
        },
        seatGuest: () => 'guest-1',
        unseatGuest: () => {},
        spawnGuest: () => 'ship-2',
        respawnGuest: () => {},
        guestControls: () => {},
        paused: false,
      };

      const split = new SplitScreen(container, {
        gamepads: withGamepads ? gamepads : undefined,
        session: () => mockSession as any,
        ownWorld: () => mockSession as any,
        singleView,
        presetId: () => 'pad',
        isGodMode: () => false,
        keyboardFlight: () => withGamepads ? IDLE : { turn: 1, throttle: 0, engine: true },
        execute: () => {},
        notify: () => {},
        changed: () => {},
      });

      return { split, p1Camera: new CameraController(), container, local: mockSession, gamepads };
    }

    function mockState(x: number, y: number, status: 'landed' | 'flying' | 'crashed' = 'landed'): State {
      return { time: 10, position: { x, y }, velocity: { x: 0, y: 0 }, heading: 0, throttle: 0, revision: 1, status };
    }

    it('suspends all guest seats for a single-view policy and restores saved players without rewriting preferences', () => {
      let restricted = false;
      const { split, local } = createMockSplitScreen(true, () => restricted);
      split.setConfig(setPlayerCount(split.config, 4)); split.sync();
      const saved = JSON.stringify(loadLocalPlayers());
      const config = split.config;
      expect(split.active).toBe(4); expect(split.guests.size).toBe(3);
      const guests = [...split.guests.values()], dispose = guests.map(g => vi.spyOn(g, 'dispose'));
      const unseat = vi.spyOn(local, 'unseatGuest'), controls = vi.spyOn(local, 'guestControls');
      restricted = true; split.sync();
      expect(split.singleView).toBe(true); expect(split.active).toBe(1); expect(split.split).toBe(false);
      expect(split.guests.size).toBe(0); expect(split.separatedGuests.size).toBe(0);
      expect(unseat).toHaveBeenCalledTimes(3); expect(controls).toHaveBeenCalledTimes(3);
      for (const d of dispose) expect(d).toHaveBeenCalledOnce();
      expect(split.join(0)).toBe(false); expect(split.config).toBe(config);
      expect(JSON.stringify(loadLocalPlayers())).toBe(saved);
      restricted = false; split.sync();
      expect(split.singleView).toBe(false); expect(split.active).toBe(4); expect(split.guests.size).toBe(3);
      expect(split.config).toBe(config); expect(JSON.stringify(loadLocalPlayers())).toBe(saved);
      split.dispose();
    });

    it('routes a keyboard-owned guest without connected gamepad support', () => {
      const { split, local } = createMockSplitScreen(false);
      const controls = vi.spyOn(local, 'guestControls');
      split.setConfig(assignDevice(setPlayerCount(split.config, 2), 1, 'keyboard')); split.sync();
      split.pollPads(); split.applyInput(.01);
      const guest = split.guests.get(1)!;
      expect(split.keyboardSlot).toBe(1); expect(split.padsOf(1)).toEqual([]);
      expect(controls).toHaveBeenCalledWith(guest.playerId, guest.shipId, { turn: 1, throttle: 0, engine: true });
      split.dispose();
      expect(controls).toHaveBeenLastCalledWith(guest.playerId, guest.shipId, IDLE);
    });

    it('attaches guest panes to the current canvas after renderer replacement', () => {
      const { split, container } = createMockSplitScreen();
      const replacement = createMockElement('canvas'), originalQuery = container.querySelector;
      replacement.after = vi.fn();
      container.querySelector = (selector: string) => selector === 'canvas#flight-view' ? replacement : originalQuery(selector);
      split.setConfig({ ...split.config, count: 2 }); split.sync();
      expect(replacement.after).toHaveBeenCalledWith(split.guests.get(1)!.pane);
      expect(replacement.getAttribute('data-local-primary')).toBe('');
    });

    it('releases the old guest target before selecting another vessel', () => {
      const { split, local } = createMockSplitScreen();
      split.setConfig({ ...split.config, count: 2 }); split.sync();
      const guest = split.guests.get(1)!, oldShip = guest.shipId!;
      const release = vi.fn(); local.guestControls = release;
      guest.controls = { turn: 1, throttle: 0, engine: true };
      guest.select('replacement-ship');
      expect(release).toHaveBeenCalledWith(guest.playerId, oldShip, IDLE);
      expect(guest.controls).toEqual(IDLE); expect(guest.shipId).toBe('replacement-ship');
    });

    it('releases an auto-owned pad when another seat claims it', () => {
      const { split, gamepads } = createMockSplitScreen(), release = vi.spyOn(gamepads, 'release');
      vi.spyOn(gamepads, 'connected').mockReturnValue([0]);
      let next = setPlayerCount(split.config, 2); next = assignDevice(next, 1, 'pad:0');
      split.setConfig(next); expect(release).toHaveBeenCalledWith(0);
      gamepads.dispose();
    });

    it('closes every guest resource and removes panes when a renderer fails during disposal', () => {
      const { split, local } = createMockSplitScreen();
      split.setConfig({ ...split.config, count: 3 }); split.sync();
      const first = split.guests.get(1)!, second = split.guests.get(2)!;
      const camera = vi.spyOn(first.camera, 'dispose'), prediction = vi.spyOn(first.prediction, 'dispose');
      const fleet = vi.spyOn(first.fleetView, 'dispose'), secondCamera = vi.spyOn(second.camera, 'dispose');
      local.unseatGuest = vi.fn();
      first.renderer = { dispose() { throw new Error('Broken renderer cleanup'); } } as any;
      expect(() => split.dispose()).toThrow('Split-screen cleanup failed');
      expect(camera).toHaveBeenCalledTimes(1); expect(prediction).toHaveBeenCalledTimes(1); expect(fleet).toHaveBeenCalledTimes(1);
      expect(secondCamera).toHaveBeenCalledTimes(1); expect(first.pane.remove).toHaveBeenCalled(); expect(second.pane.remove).toHaveBeenCalled();
      expect(local.unseatGuest).toHaveBeenCalledTimes(2); expect(split.guests.size).toBe(0);
      split.dispose(); expect(camera).toHaveBeenCalledTimes(1);
    });

    it('splits immediately if either player opens a map or non-follow view', () => {
      const { split, p1Camera } = createMockSplitScreen();
      split.setConfig({ ...split.config, count: 2, screenMode: 'dynamic' });
      split.sync();

      const guest = split.guests.get(1)!;
      guest.body = { id: 'primus', name: 'Primus', radius: 600000, mu: 3.5e12 } as any;
      guest.state = mockState(100, 600100);
      guest.view = guest.state;

      const p1Body = guest.body!;
      const p1View = mockState(110, 600100);

      // Close together in follow mode: stays merged
      p1Camera.mode = 'follow';
      guest.camera.mode = 'follow';
      split.updateDynamic(p1View, p1Body, p1Camera, 1920, 1080, 1000);
      expect(split.isSeparated(1)).toBe(false);

      // Player 1 opens map / planet view -> splits immediately
      p1Camera.planetView(p1Body.radius);
      split.updateDynamic(p1View, p1Body, p1Camera, 1920, 1080, 1010);
      expect(split.isSeparated(1)).toBe(true);

      // Return to follow view: needs 600ms debounce before merging back
      p1Camera.followShip();
      split.updateDynamic(p1View, p1Body, p1Camera, 1920, 1080, 1050);
      expect(split.isSeparated(1)).toBe(true); // Still separated at +40ms

      split.updateDynamic(p1View, p1Body, p1Camera, 1920, 1080, 1660);
      expect(split.isSeparated(1)).toBe(false); // Merged back after 610ms
    });

    it('splits immediately if screen distance exceeds 55% or world distance exceeds 5000m', () => {
      const { split, p1Camera } = createMockSplitScreen();
      split.setConfig({ ...split.config, count: 2, screenMode: 'dynamic' });
      split.sync();

      const guest = split.guests.get(1)!;
      guest.body = { id: 'primus', name: 'Primus', radius: 600000, mu: 3.5e12 } as any;
      guest.state = mockState(0, 600000);
      guest.view = guest.state;

      const p1Body = guest.body!;
      p1Camera.mode = 'follow';
      p1Camera.zoom = 10;

      // Close: 25m apart (at zoom 10, ~180px on 1080p screen, well within 35%)
      const p1ViewNear = mockState(25, 600000);
      split.updateDynamic(p1ViewNear, p1Body, p1Camera, 1920, 1080, 1000);
      expect(split.isSeparated(1)).toBe(false);

      // Far: 6000m apart (> 5000m) -> splits immediately
      const p1ViewFar = mockState(6000, 600000);
      split.updateDynamic(p1ViewFar, p1Body, p1Camera, 1920, 1080, 1020);
      expect(split.isSeparated(1)).toBe(true);
    });

    it('computes shared centroid and zoom scale when players share Pane 0', () => {
      const { split, p1Camera } = createMockSplitScreen();
      split.setConfig({ ...split.config, count: 2, screenMode: 'dynamic' });
      split.sync();

      const guest = split.guests.get(1)!;
      guest.body = { id: 'primus', name: 'Primus', radius: 600000, mu: 3.5e12 } as any;
      guest.state = mockState(10, 600000);
      guest.view = guest.state;

      const p1Body = guest.body!;
      const p1View = mockState(20, 600000);

      const dynamic = split.updateDynamic(p1View, p1Body, p1Camera, 1920, 1080, 1000);
      expect(dynamic.centroid).toBeDefined();
      expect(dynamic.centroid!.x).toBeCloseTo(15);
      expect(dynamic.centroid!.y).toBeCloseTo(600000);
    });
  });

  describe('controller cursor and slingshot launch configuration', () => {
    it('reserves D-Pad Up for throttle by default', () => {
      expect(DEFAULT_PAD_BUTTONS.throwShip).toEqual([]);
    });

    it('sets zoomAxis to -1 by default so right stick acts as dedicated viewport cursor', () => {
      expect(DEFAULT_CONTROLLER_PROFILE.zoomAxis).toBe(-1);
    });

    it('detects button down via isButtonDown', () => {
      expect(isButtonDown(undefined)).toBe(false);
      expect(isButtonDown({ pressed: false, value: 0 } as any)).toBe(false);
      expect(isButtonDown({ pressed: true, value: 0 } as any)).toBe(true);
      expect(isButtonDown({ pressed: false, value: 0.6 } as any)).toBe(true);
    });

    it('allows throttleUp on D-Pad Up', () => {
      const buttons = Array.from({ length: 18 }, () => ({ pressed: false, value: 0, touched: false }));
      // Button 12 is D-pad Up, dedicated to throttle
      buttons[12] = { pressed: true, value: 1.0, touched: true };

      const input = readPad({ axes: [0, 0, 0, 0], buttons }, DEFAULT_CONTROLLER_PROFILE);
      expect(input.throttle).toBe(1);
    });

    it('allows throttleDown normally on D-Pad Down', () => {
      const buttons = Array.from({ length: 18 }, () => ({ pressed: false, value: 0, touched: false }));
      buttons[13] = { pressed: true, value: 1.0, touched: true }; // D-Pad Down

      const input = readPad({ axes: [0, 0, 0, 0], buttons }, DEFAULT_CONTROLLER_PROFILE);
      expect(input.throttle).toBe(-1);
    });
  });

  describe('customizable navball locations and pin/drag options', () => {
    it('provides sensible default placement anchors for up to 4 players', () => {
      expect(defaultNavballPlacement(0).anchor).toBe('bottom-right');
      expect(defaultNavballPlacement(0).pinned).toBe(true);

      expect(defaultNavballPlacement(1).anchor).toBe('bottom-left');
      expect(defaultNavballPlacement(1).pinned).toBe(true);

      expect(defaultNavballPlacement(2).anchor).toBe('top-left');
      expect(defaultNavballPlacement(2).pinned).toBe(true);

      expect(defaultNavballPlacement(3).anchor).toBe('top-right');
      expect(defaultNavballPlacement(3).pinned).toBe(true);
    });

    it('normalizes navball placement and bounds fractional coordinates', () => {
      const fallback = defaultNavballPlacement(0);
      const normalized = normalizeNavballPlacement({ anchor: 'custom', x: -0.5, y: 1.5, pinned: false }, fallback);
      expect(normalized.anchor).toBe('custom');
      expect(normalized.x).toBe(0.02);
      expect(normalized.y).toBe(0.98);
      expect(normalized.pinned).toBe(false);

      const invalid = normalizeNavballPlacement(null, fallback);
      expect(invalid).toEqual(fallback);
    });

    it('computes navball centers for corner anchors and custom dragged positions', () => {
      const w = 1920, h = 1080;
      const br = computeNavballCenter({ anchor: 'bottom-right', x: 0.88, y: 0.82, pinned: true }, w, h, 1);
      expect(br.x).toBeGreaterThan(1500);
      expect(br.y).toBeGreaterThan(800);

      const bl = computeNavballCenter({ anchor: 'bottom-left', x: 0.14, y: 0.82, pinned: true }, w, h, 1);
      expect(bl.x).toBeLessThan(400);
      expect(bl.y).toBeGreaterThan(800);

      const tl = computeNavballCenter({ anchor: 'top-left', x: 0.14, y: 0.22, pinned: true }, w, h, 1);
      expect(tl.x).toBeLessThan(400);
      expect(tl.y).toBeLessThan(300);

      const tr = computeNavballCenter({ anchor: 'top-right', x: 0.88, y: 0.22, pinned: true }, w, h, 1);
      expect(tr.x).toBeGreaterThan(1500);
      expect(tr.y).toBeLessThan(300);

      const custom = computeNavballCenter({ anchor: 'custom', x: 0.5, y: 0.5, pinned: false }, w, h, 1);
      expect(custom.x).toBeCloseTo(960);
      expect(custom.y).toBeCloseTo(540);
    });

    it('updates slot navball configuration via setSlotNavball', () => {
      const config = defaultLocalPlayers();
      const updated = setSlotNavball(config, 1, { anchor: 'custom', x: 0.3, y: 0.7, pinned: false });
      expect(updated.slots[1]!.navball.anchor).toBe('custom');
      expect(updated.slots[1]!.navball.x).toBe(0.3);
      expect(updated.slots[1]!.navball.y).toBe(0.7);
      expect(updated.slots[1]!.navball.pinned).toBe(false);
    });

    it('pins and unpins all navballs simultaneously via setAllNavballsPinned', () => {
      const config = defaultLocalPlayers();
      const unpinned = setAllNavballsPinned(config, false);
      expect(unpinned.slots.every(s => s.navball.pinned === false)).toBe(true);

      const pinned = setAllNavballsPinned(unpinned, true);
      expect(pinned.slots.every(s => s.navball.pinned === true)).toBe(true);
    });

    it('draws vector pin glyph, status badges, and drag highlight ring', () => {
      const mockNavState: NavballState = {
        frame: 'orbit',
        zenith: 0,
        nadir: Math.PI,
        nose: 0,
        speed: 150,
        forward: 1,
        pitch: 0,
      };

      // Pinned dial: draws PIN text badge and does NOT draw drag handle ring
      const pinnedPrimitives = drawNavball(mockNavState, { x: 500, y: 500 }, 0, 'horizon', '#38ef7d', 'P1', 1, undefined, true, false);
      const pinText = pinnedPrimitives.find(p => p.kind === 'text' && p.text === 'PIN');
      expect(pinText).toBeDefined();

      // Unpinned dial: draws UNPIN badge and 'DRAG TO MOVE' status
      const unpinnedPrimitives = drawNavball(mockNavState, { x: 500, y: 500 }, 0, 'horizon', '#38ef7d', 'P1', 1, undefined, false, false);
      const unpinText = unpinnedPrimitives.find(p => p.kind === 'text' && p.text === 'UNPIN');
      expect(unpinText).toBeDefined();
      const dragPrompt = unpinnedPrimitives.find(p => p.kind === 'text' && p.text?.includes('DRAG TO MOVE'));
      expect(dragPrompt).toBeDefined();

      // Actively dragging dial: draws 'DRAGGING' status
      const draggingPrimitives = drawNavball(mockNavState, { x: 500, y: 500 }, 0, 'horizon', '#38ef7d', 'P1', 1, undefined, false, true);
      const draggingPrompt = draggingPrimitives.find(p => p.kind === 'text' && p.text?.includes('DRAGGING'));
      expect(draggingPrompt).toBeDefined();
    });
  });
});
