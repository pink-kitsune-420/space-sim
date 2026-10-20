import { expect, it, vi } from 'vitest';
import { FLIGHT_HUD_STATE, FLIGHT_PLANS, LOCAL_PILOTS, THROTTLE_HUD, type FlightHudAdapter, type ManifestV2, type ModuleProfileV2,
  type OverlayPrimitive, type PredictionFactory, type RegisteredModuleV2, type ThrottleLeverState } from '../../packages/game-api/src/index';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { saveWorld } from '../../packages/sim-core/src/save';
import { createViewHud } from '../../modules/view-hud/src/index';
import throttleInitialize from '../../modules/throttle-hud/src/index';
import throttleDescriptor from '../../modules/throttle-hud/module.json';
import throttleGuide from '../../modules/throttle-hud/docs/creators/usage.json';
import predictionInitialize from '../../modules/flight-prediction/src/index';
import predictionDescriptor from '../../modules/flight-prediction/module.json';
import predictionGuide from '../../modules/flight-prediction/docs/creators/usage.json';
import plansInitialize from '../../modules/flight-plans/src/index';
import plansDescriptor from '../../modules/flight-plans/module.json';
import plansGuide from '../../modules/flight-plans/docs/creators/usage.json';
import readoutInitialize from '../../examples/modules/throttle-hud/src/main';
import readoutDescriptor from '../../examples/modules/throttle-hud/module.json';
import probeInitialize, { PREDICTION_PROBE, createProbe } from '../../examples/modules/flight-prediction/src/main';
import probeDescriptor from '../../examples/modules/flight-prediction/module.json';
import summaryInitialize, { PLAN_SUMMARY } from '../../examples/modules/flight-plans/src/main';
import summaryDescriptor from '../../examples/modules/flight-plans/module.json';

import actionsInitialize from '../../modules/input-actions/src/index';
import actionsDescriptor from '../../modules/input-actions/module.json';
import actionsGuide from '../../modules/input-actions/docs/creators/usage.json';
import inspectorInitialize, { ACTION_INSPECTOR } from '../../examples/modules/input-actions/src/main';
import inspectorDescriptor from '../../examples/modules/input-actions/module.json';

import gamepadInitialize from '../../modules/input-gamepad/src/index';
import gamepadDescriptor from '../../modules/input-gamepad/module.json';
import gamepadGuide from '../../modules/input-gamepad/docs/creators/usage.json';
import customGamepadInitialize, { CUSTOM_GAMEPAD } from '../../examples/modules/input-gamepad/src/main';
import customGamepadDescriptor from '../../examples/modules/input-gamepad/module.json';

import keyboardInitialize from '../../modules/input-keyboard/src/index';
import keyboardDescriptor from '../../modules/input-keyboard/module.json';
import keyboardGuide from '../../modules/input-keyboard/docs/creators/usage.json';
import customKeyboardInitialize, { CUSTOM_KEYBOARD } from '../../examples/modules/input-keyboard/src/main';
import customKeyboardDescriptor from '../../examples/modules/input-keyboard/module.json';

import profilesInitialize from '../../modules/input-profiles/src/index';
import profilesDescriptor from '../../modules/input-profiles/module.json';
import profilesGuide from '../../modules/input-profiles/docs/creators/usage.json';
import normalizerInitialize, { PROFILE_VALIDATOR } from '../../examples/modules/input-profiles/src/main';
import normalizerDescriptor from '../../examples/modules/input-profiles/module.json';

import touchInitialize from '../../modules/input-touch/src/index';
import touchDescriptor from '../../modules/input-touch/module.json';
import touchGuide from '../../modules/input-touch/docs/creators/usage.json';
import virtualPadInitialize, { TOUCH_VIRTUAL_PAD } from '../../examples/modules/input-touch/src/main';
import virtualPadDescriptor from '../../examples/modules/input-touch/module.json';

import controllerInitialize from '../../modules/player-controller/src/index';
import controllerDescriptor from '../../modules/player-controller/module.json';
import controllerGuide from '../../modules/player-controller/docs/creators/usage.json';
import turretInitialize, { TURRET_CONTROLLER } from '../../examples/modules/player-controller/src/main';
import turretDescriptor from '../../examples/modules/player-controller/module.json';

import pilotsInitialize from '../../modules/local-pilots/src/index';
import pilotsDescriptor from '../../modules/local-pilots/module.json';
import pilotsGuide from '../../modules/local-pilots/docs/creators/usage.json';
import pilotHostInitialize, { PILOT_HOST_HELPER } from '../../examples/modules/local-pilots/src/main';
import pilotHostDescriptor from '../../examples/modules/local-pilots/module.json';

import menuInitialize from '../../modules/controller-menu/src/index';
import menuDescriptor from '../../modules/controller-menu/module.json';
import menuGuide from '../../modules/controller-menu/docs/creators/usage.json';
import minimalMenuInitialize, { MINIMAL_MENU } from '../../examples/modules/controller-menu/src/main';
import minimalMenuDescriptor from '../../examples/modules/controller-menu/module.json';

// The Creators guides link these examples; each test exercises the behavior its guide describes.
function registry(entries: readonly (readonly [unknown, RegisteredModuleV2['initialize'], unknown?])[]): ModuleRegistryV2 {
  const result = new ModuleRegistryV2();
  for (const [descriptor, initialize, guide] of entries) {
    const files = new Map(guide ? [['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))] as const] : []);
    result.register({ manifest: (descriptor as { manifest: ManifestV2 }).manifest, initialize }, moduleAssets(files));
  }
  return result;
}
const profile = (modules: readonly unknown[], providers: Record<string, string>, settings: ModuleProfileV2['settings'] = {}): ModuleProfileV2 => ({
  format: 'space-sim-profile/2', id: 'fixture.api-examples', capabilities: {}, settings, providers,
  modules: modules.map(descriptor => { const { id, version } = (descriptor as { manifest: ManifestV2 }).manifest; return { id, version }; }),
});

it('replaces the hud.throttle provider with the readout example and keeps its draw path allocation-free', () => {
  const graph = registry([[throttleDescriptor, throttleInitialize, throttleGuide], [readoutDescriptor, readoutInitialize]]);
  const both = [throttleDescriptor, readoutDescriptor];
  expect(() => graph.prepare(profile(both, {}), 'browser', ['hud.throttle'])).toThrow('Select one provider for hud.throttle');
  const candidate = graph.prepare(profile(both, { 'hud.throttle': 'example.throttle-readout' }), 'browser', ['hud.throttle']);
  const lever: { -readonly [K in keyof ThrottleLeverState]: ThrottleLeverState[K] } = { world: {}, shipId: 'ship', throttle: .5, locked: false, firing: true };
  const requests: number[] = [];
  const adapter: FlightHudAdapter = { pilot: 0, navball: () => undefined, throttle: () => lever, setThrottle: value => requests.push(value) };
  const hud = createViewHud({ binding: { seatId: 'seat-0', viewportId: 'view-0', session: {} }, adapters: [{ key: FLIGHT_HUD_STATE, service: adapter }] });
  try {
    // The lock still records the unselected alternative, but only the selected provider initializes.
    expect(candidate.contributions('guide')).toEqual([]);
    hud.select([candidate.providedService(THROTTLE_HUD)]);
    hud.resize({ root: {} as HTMLElement, width: 400, height: 300, x: 0, y: 0 });
    hud.update(1 / 60);
    const first: OverlayPrimitive[] = [], second: OverlayPrimitive[] = [];
    hud.draw(first); hud.update(1 / 60); hud.draw(second);
    expect(first).toEqual([expect.objectContaining({ kind: 'text', text: 'THR 50% BURN' }), expect.objectContaining({ kind: 'line' })]);
    expect(second.every((shape, index) => shape === first[index])).toBe(true);
    lever.locked = true; hud.update(1 / 60); const locked: OverlayPrimitive[] = []; hud.draw(locked);
    expect(locked[0]).toMatchObject({ text: 'THR 50% LOCK' });
    hud.bind({ ...hud.binding, targetId: 'other' }); const rebound: OverlayPrimitive[] = []; hud.draw(rebound);
    expect(rebound).toEqual([]);
    expect(requests).toEqual([]);
    // A view without the flight adapter skips the instrument instead of failing.
    const bare = createViewHud({ binding: { seatId: 'seat-1', viewportId: 'view-1', session: {} }, adapters: [] });
    bare.select([candidate.providedService(THROTTLE_HUD)]); expect(bare.count).toBe(0); bare.dispose();
  } finally { hud.dispose(); candidate.dispose(); }
});

it('consumes view.prediction through the probe example without advancing the world, then cleans up with its provider', () => {
  const graph = registry([[predictionDescriptor, predictionInitialize, predictionGuide], [probeDescriptor, probeInitialize]]);
  const modules = [predictionDescriptor, probeDescriptor];
  const world = new World(DEFAULT_UNIVERSE, { id: 'api-example-prediction' });
  const candidate = graph.prepare(profile(modules, { 'view.prediction': 'spacelab.flight-prediction', 'example.prediction-probe': 'example.prediction-probe' }), 'node');
  try {
    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' }); world.step();
    const state = world.ship(ship.id)!.state, before = JSON.stringify(saveWorld(world));
    const input = { context: world.context, state, body: world.body(ship.bodyId), surface: world.surface(ship.bodyId), shipId: ship.id, world };
    const result = candidate.providedService(PREDICTION_PROBE).trace(input);
    expect(result.end).toBe('closed'); expect(result.samples.length).toBeGreaterThan(40); expect(result.period).toBeGreaterThan(0);
    expect(JSON.stringify(saveWorld(world))).toBe(before);
    const probe = candidate.providedService(PREDICTION_PROBE);
    candidate.dispose();
    expect(() => probe.trace(input)).toThrow('Prediction provider disposed');
  } finally { candidate.dispose(); world.dispose(); }
});

it('reports an unfinished probe trace after its update limit and copies the path before disposing the preview', () => {
  const path = [{ time: 0, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } }];
  let updates = 0, disposed = false;
  const preview = { path, update() { updates++; }, dispose() { disposed = true; path.length = 0; } };
  const factory = { create: () => preview as unknown as ReturnType<PredictionFactory['create']> };
  const result = createProbe(factory, 3).trace({} as Parameters<ReturnType<typeof createProbe>['trace']>[0]);
  expect(result).toEqual({ end: 'unfinished', samples: [{ time: 0, position: { x: 1, y: 0 }, velocity: { x: 0, y: 1 } }] });
  expect(updates).toBe(3); expect(disposed).toBe(true);
});

it('summarizes plans through the optional flight.plans service, reports rejected archives and works without a provider', () => {
  const graph = registry([[plansDescriptor, plansInitialize, plansGuide], [summaryDescriptor, summaryInitialize]]);
  const world = new World(DEFAULT_UNIVERSE, { id: 'api-example-plans' });
  const withPlans = graph.prepare(profile([plansDescriptor, summaryDescriptor], { 'flight.plans': 'spacelab.flight-plans', 'example.plan-summary': 'example.plan-summary' }), 'node');
  const without = graph.prepare(profile([summaryDescriptor], { 'example.plan-summary': 'example.plan-summary' }), 'node');
  try {
    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const plan = withPlans.providedService(FLIGHT_PLANS).capture(world, ship, [{ id: 'burn', label: 'Raise', bodyId: ship.bodyId, time: ship.state.time + 30, prograde: 12, radial: 0 }]);
    const archive = { format: 'space-sim-flight-plans/1', plans: [plan] };
    expect(withPlans.providedService(PLAN_SUMMARY).describe(archive)).toEqual([
      `${ship.id}: 1 node(s), starting around ${ship.bodyId}`, `  Raise at T+30.0 s around ${ship.bodyId}: prograde 12 m/s, radial 0 m/s`]);
    expect(withPlans.providedService(PLAN_SUMMARY).describe({ format: 'other', plans: [] })[0]).toMatch(/^Rejected\. Flight plan: /);
    expect(without.lock.order).toEqual(['example.plan-summary']);
    expect(without.providedService(PLAN_SUMMARY).describe(archive)).toEqual(['Flight plans are not available in this game.']);
  } finally { withPlans.dispose(); without.dispose(); world.dispose(); }
});

it('inspects flight action definitions and formats active bindings via input-actions example', () => {
  const graph = registry([[actionsDescriptor, actionsInitialize, actionsGuide], [inspectorDescriptor, inspectorInitialize]]);
  const candidate = graph.prepare(profile([actionsDescriptor, inspectorDescriptor], {
    'input.flight-actions': 'spacelab.input-actions',
    'example.flight-actions-inspector': 'example.flight-actions-inspector',
  }), 'browser');
  try {
    const inspector = candidate.providedService(ACTION_INSPECTOR);
    const summary = inspector.summarize();
    expect(summary.total).toBeGreaterThan(20);
    expect(summary.categories.flight).toBeGreaterThan(0);
    expect(summary.categories.warp).toBeGreaterThan(0);
    const engineDesc = inspector.describeBinding('spacelab.input-actions/engine');
    expect(engineDesc).toContain('Fire Main Engine');
    expect(engineDesc).toContain('held');
    expect(engineDesc).toContain('Space');
    expect(inspector.describeBinding('unknown')).toBe('Unknown action: unknown');
  } finally {
    candidate.dispose();
  }
});

it('samples custom gamepad inputs and formats button labels via input-gamepad example', () => {
  const graph = registry([[gamepadDescriptor, gamepadInitialize, gamepadGuide], [customGamepadDescriptor, customGamepadInitialize]]);
  const candidate = graph.prepare(profile([gamepadDescriptor, customGamepadDescriptor], {
    'input.gamepad': 'spacelab.input-gamepad',
    'example.gamepad-custom-source': 'example.gamepad-custom-source',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOM_GAMEPAD);
    expect(helper.format(0, 'xbox')).toBe('A');
    expect(helper.format(0, 'playstation')).toBe('Cross (✕)');
    expect(helper.format(0, 'nintendo')).toBe('Trigger / Btn 0');
    expect(helper.format(0, 'steam-deck')).toBe('A');

    const source = helper.createSource(0, 0, 1);
    const sinkValues = new Map<string, number>();
    const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
    const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

    const mockPad = {
      connected: true,
      axes: [0],
      buttons: [{ value: 0 }, { value: 0 }],
    };
    vi.stubGlobal('navigator', { getGamepads: () => [mockPad] });
    try {
      source.sample(frame, sink);
      expect(sinkValues.size).toBe(0);

      mockPad.axes[0] = 0.8;
      mockPad.buttons[1] = { value: 1 };
      source.sample(frame, sink);
      expect(sinkValues.get('example.vehicle/steer')).toBeCloseTo(0.764, 2);
      expect(sinkValues.get('example.vehicle/boost')).toBe(1);

      source.release(0);
      sinkValues.clear();
      source.dispose();
      expect(() => source.sample(frame, sink)).toThrow('Gamepad source is disposed');
    } finally {
      vi.unstubAllGlobals();
    }
  } finally {
    candidate.dispose();
  }
});

it('samples keyboard shortcuts and respects reserved keys via input-keyboard example', () => {
  const graph = registry([[keyboardDescriptor, keyboardInitialize, keyboardGuide], [customKeyboardDescriptor, customKeyboardInitialize]]);
  const candidate = graph.prepare(profile([keyboardDescriptor, customKeyboardDescriptor], {
    'input.keyboard': 'spacelab.input-keyboard',
    'example.keyboard-custom-source': 'example.keyboard-custom-source',
  }), 'browser');
  try {
    const helper = candidate.providedService(CUSTOM_KEYBOARD);
    expect(helper.reserved.has('Space')).toBe(true);
    expect(helper.reserved.has('KeyP')).toBe(true);

    const listeners = new Map<string, (e: unknown) => void>();
    const fakeWindow = {
      addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, fn); },
      removeEventListener: (type: string) => { listeners.delete(type); },
    };
    const fakeDoc = {
      hidden: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const prevWin = globalThis.window, prevDoc = globalThis.document;
    try {
      (globalThis as unknown as { window: unknown }).window = fakeWindow;
      (globalThis as unknown as { document: unknown }).document = fakeDoc;

      const source = helper.createSource(0);
      const sinkValues = new Map<string, number>();
      const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
      const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

      listeners.get('keydown')?.({ code: 'Enter', altKey: false, preventDefault: () => {} });
      source.sample(frame, sink);
      expect(sinkValues.get('example.menu/select')).toBe(1);

      sinkValues.clear();
      source.sample(frame, sink);
      expect(sinkValues.get('example.menu/select')).toBeUndefined();

      source.dispose();
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWin;
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  } finally {
    candidate.dispose();
  }
});

it('normalizes controller profiles and enforces deadzone bounds via input-profiles example', () => {
  const graph = registry([[profilesDescriptor, profilesInitialize, profilesGuide], [normalizerDescriptor, normalizerInitialize]]);
  const candidate = graph.prepare(profile([profilesDescriptor, normalizerDescriptor], {
    'input.flight-profiles': 'spacelab.input-profiles',
    'example.profile-normalizer': 'example.profile-normalizer',
  }), 'browser');
  try {
    const validator = candidate.providedService(PROFILE_VALIDATOR);
    const defaults = validator.getDefaults();
    expect(defaults.deadzone).toBe(0.15);
    expect(defaults.turnAxis).toBe(0);

    const normalized = validator.validateAndNormalize({
      deadzone: 0.85,
      buttons: { engine: [7, 7, 999] },
    });
    expect(normalized.deadzone).toBe(0.5);
    expect(normalized.buttons.engine).toEqual([7]);
  } finally {
    candidate.dispose();
  }
});

it('tracks pointer gestures across touch controls via input-touch example', () => {
  const graph = registry([[touchDescriptor, touchInitialize, touchGuide], [virtualPadDescriptor, virtualPadInitialize]]);
  const candidate = graph.prepare(profile([touchDescriptor, virtualPadDescriptor], {
    'input.touch': 'spacelab.input-touch',
    'example.touch-virtual-pad': 'example.touch-virtual-pad',
  }), 'browser');
  try {
    const helper = candidate.providedService(TOUCH_VIRTUAL_PAD);
    const createMockElement = () => {
      const handlers = new Map<string, (e: unknown) => void>();
      return {
        addEventListener: (type: string, fn: (e: unknown) => void) => { handlers.set(type, fn); },
        removeEventListener: (type: string) => { handlers.delete(type); },
        setPointerCapture: () => {},
        releasePointerCapture: () => {},
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }),
        _fire: (type: string, e: unknown) => { handlers.get(type)?.(e); },
      };
    };
    const button = createMockElement(), slider = createMockElement();
    const fakeWin = { addEventListener: () => {}, removeEventListener: () => {} };
    const fakeDoc = { hidden: false, addEventListener: () => {}, removeEventListener: () => {} };
    const prevWin = globalThis.window, prevDoc = globalThis.document;
    try {
      (globalThis as unknown as { window: unknown }).window = fakeWin;
      (globalThis as unknown as { document: unknown }).document = fakeDoc;

      const source = helper.bindControls(0, button as unknown as HTMLElement, slider as unknown as HTMLElement);
      const sinkValues = new Map<string, number>();
      const sink = { set: (action: string, value: number) => { sinkValues.set(action, value); } };
      const frame = { elapsed: 1 / 60, pilot: 0, flightAllowed: true, shortcutsAllowed: true };

      button._fire('pointerdown', { pointerId: 1, pointerType: 'touch', preventDefault: () => {} });
      source.sample(frame, sink);
      expect(sinkValues.get('example.touch/fire')).toBe(1);

      slider._fire('pointerdown', { pointerId: 2, pointerType: 'touch', clientY: 10, clientX: 50, preventDefault: () => {} });
      sinkValues.clear();
      source.sample(frame, sink);
      expect(sinkValues.get('example.touch/pitch')).toBeCloseTo(-0.8, 2);

      source.dispose();
    } finally {
      (globalThis as unknown as { window: unknown }).window = prevWin;
      (globalThis as unknown as { document: unknown }).document = prevDoc;
    }
  } finally {
    candidate.dispose();
  }
});

it('routes namespaced intent to a custom control target adapter via player-controller example', () => {
  const graph = registry([[controllerDescriptor, controllerInitialize, controllerGuide], [turretDescriptor, turretInitialize]]);
  const candidate = graph.prepare(profile([controllerDescriptor, turretDescriptor], {
    'input.controller': 'spacelab.player-controller',
    'example.custom-control-target': 'example.custom-control-target',
  }), 'browser');
  try {
    const helper = candidate.providedService(TURRET_CONTROLLER);
    const { state, controller, target } = helper.createTurretSession('player-pilot');
    expect(controller.target).toEqual(target);

    controller.set('example.turret/yaw', 0.5);
    expect(state.yaw).toBe(0.5);

    controller.release();
    expect(state.released).toBe(true);
    expect(state.yaw).toBe(0);

    controller.dispose();
  } finally {
    candidate.dispose();
  }
});

it('manages local seat device assignments and release passes via local-pilots example', () => {
  const graph = registry([[pilotsDescriptor, pilotsInitialize, pilotsGuide], [pilotHostDescriptor, pilotHostInitialize]]);
  const candidate = graph.prepare(profile([pilotsDescriptor, pilotHostDescriptor], {
    'input.local-pilots': 'spacelab.local-pilots',
    'example.headless-pilot-host': 'example.headless-pilot-host',
  }), 'browser');
  try {
    const helper = candidate.providedService(PILOT_HOST_HELPER);
    const { registry: reg, devices, releases } = helper.createRegistry(['player-1', 'player-2']);
    expect(reg.count).toBe(2);
    expect(reg.playerId(0)).toBe('player-1');
    expect(reg.playerId(1)).toBe('player-2');

    reg.assign(0, 'keyboard');
    expect(devices.get(0)).toBe('keyboard');
    expect(releases.length).toBeGreaterThan(0);

    reg.dispose();
  } finally {
    candidate.dispose();
  }
});

it('configures player counts and device assignments headlessly via controller-menu example', () => {
  const graph = registry([
    [actionsDescriptor, actionsInitialize, actionsGuide],
    [pilotsDescriptor, pilotsInitialize, pilotsGuide],
    [profilesDescriptor, profilesInitialize, profilesGuide],
    [menuDescriptor, menuInitialize, menuGuide],
    [minimalMenuDescriptor, minimalMenuInitialize],
  ]);
  const candidate = graph.prepare(profile(
    [actionsDescriptor, pilotsDescriptor, profilesDescriptor, menuDescriptor, minimalMenuDescriptor],
    {
      'input.flight-actions': 'spacelab.input-actions',
      'input.local-pilots': 'spacelab.local-pilots',
      'input.flight-profiles': 'spacelab.input-profiles',
      'input.controller-menu': 'spacelab.controller-menu',
      'example.minimal-controller-menu': 'example.minimal-controller-menu',
    },
  ), 'browser');
  try {
    const prefs = candidate.providedService(LOCAL_PILOTS).preferences();
    const config = prefs.defaultLocalPlayers();
    expect(config.count).toBe(1);

    const menu = candidate.providedService(MINIMAL_MENU);
    const updated = menu.setPlayerCount(config, 3);
    expect(updated.count).toBe(3);

    const assigned = menu.assignDevice(updated, 1, 'keyboard');
    expect(assigned.slots[1]?.device).toBe('keyboard');
  } finally {
    candidate.dispose();
  }
});

