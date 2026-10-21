import { afterEach, expect, it, vi } from 'vitest';
import { GAMEPAD_INPUT, FLIGHT_PROFILES, type InputFrame } from '../../packages/game-api/src/index';
import initialize, { createGamepadSource } from '../../modules/input-gamepad/src/index';
import descriptor from '../../modules/input-gamepad/module.json';
import guide from '../../modules/input-gamepad/docs/creators/usage.json';
import profilesInitialize, { FLIGHT_PROFILE_CODEC } from '../../modules/input-profiles/src/index';
import profilesDescriptor from '../../modules/input-profiles/module.json';
import profilesGuide from '../../modules/input-profiles/docs/creators/usage.json';
import { GamepadManager } from '../../modules/input-gamepad/src/flight';
import { readFlightDevices } from '../../apps/web/src/gamepad';
import { prepareBundledPlan, bundledRegistration } from '../../packages/game-runtime/src/bundled-plan';
import { BoundedSurvey, SURVEY_ACTIONS } from '../../examples/bounded-survey/world';
import { createPlayerController } from '../../modules/player-controller/src/index';

afterEach(() => vi.unstubAllGlobals());
const makePads = () => Array.from({length: 4}, (_, index) => ({index, id: 'Xbox capture ' + index, connected: true,
  axes: [0, 0, 0, 0], buttons: Array.from({length: 18}, () => ({pressed: false, touched: false, value: 0}))}));
const options = {actions: SURVEY_ACTIONS, bindings: [{action: 'fixture.survey/move', axis: 0}, {action: 'fixture.survey/record', button: 0}], deadzone: .15, pad: (pilot: number) => pilot};
const frame = (captureId?: number): InputFrame & {captureId?: number} => ({elapsed: .01, pilot: 0, flightAllowed: false, shortcutsAllowed: true, captureId});

it('captures copied numeric device state once across seats and refreshes the same mutable frame on its next explicit identity', () => {
  const pads = makePads(), poll = vi.fn(() => pads); vi.stubGlobal('navigator', {getGamepads: poll});
  const source = createGamepadSource(options), current = {...frame(0)}, values: [number, string, number][] = [];
  const sink = {set: (id: string, value: number) => values.push([current.pilot, id, value])};
  for (let pilot = 0; pilot < 4; pilot++) {current.pilot = pilot; source.sample(current, sink);}
  current.captureId = 1; pads.forEach(pad => {pad.axes[0] = 1; pad.buttons[0]!.value = 1;});
  for (let pilot = 0; pilot < 4; pilot++) {
    current.pilot = pilot; source.sample(current, sink);
    if (pilot === 0) pads.forEach(pad => {pad.axes[0] = -1; pad.buttons[0]!.value = 0;});
  }
  expect(values.filter(([,id]) => id.endsWith('/move')).map(([pilot,,value]) => [pilot,value])).toEqual([[0,1],[1,1],[2,1],[3,1]]);
  expect(values.filter(([,id]) => id.endsWith('/record'))).toHaveLength(4);
  values.length = 0; current.captureId = 2;
  for (let pilot = 0; pilot < 4; pilot++) {current.pilot = pilot; source.sample(current, sink);}
  expect(values.map(([,id,value]) => [id,value])).toEqual(Array.from({length:4},()=>['fixture.survey/move',-1]));
  expect(poll).toHaveBeenCalledTimes(3); source.dispose();
});

it('keeps omitted-identity samples fresh even with the same elapsed and mutable frame object', () => {
  const pads = makePads(), poll = vi.fn(() => pads); vi.stubGlobal('navigator', {getGamepads: poll});
  const source = createGamepadSource(options), current = frame(), values: number[] = [];
  source.sample(current, {set: (_,value) => values.push(value)});
  pads[0]!.axes[0] = 1; source.sample(current, {set: (_,value) => values.push(value)});
  pads[0]!.axes[0] = -1; source.sample(current, {set: (_,value) => values.push(value)});
  expect(values).toEqual([1,-1]); expect(poll).toHaveBeenCalledTimes(3); source.dispose();
});

function provider() {
  const refs = [descriptor.manifest, profilesDescriptor.manifest].map(({id,version}) => ({id,version}));
  return prepareBundledPlan({packages: [], requiredSlots: [GAMEPAD_INPUT.slot], profile: {format: 'space-sim-profile/2', id: 'fixture.capture',
    modules: refs, providers: {[GAMEPAD_INPUT.slot]: descriptor.manifest.id, [FLIGHT_PROFILES.slot]: profilesDescriptor.manifest.id}, capabilities: {}, settings: {}}},
  'browser', [bundledRegistration(descriptor, initialize, {'docs/creators/usage.json': guide}),
    bundledRegistration(profilesDescriptor, profilesInitialize, {'docs/creators/usage.json': profilesGuide})]);
}

it('shares capture within the selected provider while preserving independent owners, detached diagnostics and disposal', () => {
  const pads = makePads(), poll = vi.fn(() => pads); vi.stubGlobal('navigator', {getGamepads: poll});
  const candidate = provider(), factory = candidate.providedService(GAMEPAD_INPUT), one = factory.create(options), two = factory.create(options), manager = factory.createFlight();
  one.sample(frame(1), {set(){}}); two.sample(frame(1), {set(){}});
  manager.update(() => FLIGHT_PROFILE_CODEC.defaultProfile, () => {}, undefined, 1);
  const diagnostic = manager.getDiagnostics(1);
  expect(readFlightDevices(manager, 1)[0]!.axes[0]).toBe(0);
  expect(manager.connected(1)).toEqual([0,1,2,3]); expect(poll).toHaveBeenCalledTimes(1);
  pads[0]!.axes[0] = 1; manager.update(() => FLIGHT_PROFILE_CODEC.defaultProfile, () => {}, undefined, 2);
  expect(manager.getDiagnostics(2)[0]!.axes[0]).toBe(1); expect(diagnostic[0]!.axes[0]).toBe(0);
  const independent = createGamepadSource(options); independent.sample(frame(2), {set(){}});
  expect(poll).toHaveBeenCalledTimes(3);
  one.dispose(); two.sample(frame(3), {set(){}}); // A child cannot dispose its provider's shared capture.
  manager.dispose(); expect(manager.connected(4)).toEqual([]); expect(manager.getDiagnostics(4)).toEqual([]);
  const before = poll.mock.calls.length; two.sample(frame(4), {set(){}}); expect(poll.mock.calls.length).toBe(before + 1);
  candidate.dispose(); independent.dispose();
  expect(() => one.sample(frame(3), {set(){}})).toThrow('disposed');
  expect(() => factory.create(options)).toThrow('disposed');
});

it('uses the same capture through four actual non-flight survey controllers without replaying a press', () => {
  const pads = makePads(), poll = vi.fn(() => pads); vi.stubGlobal('navigator', {getGamepads: poll});
  const world = new BoundedSurvey(), source = createGamepadSource(options);
  const controllers = Array.from({length:4}, (_, pilot) => {const controller = createPlayerController(world.controls, {pilot,sources:[source]}); controller.select(world.binding(pilot)); return controller;});
  const sample = (captureId: number) => controllers.forEach(controller => controller.sample(frame(captureId)));
  sample(0); world.step(); pads.forEach(pad => {pad.axes[0] = 1; pad.buttons[0]!.value = 1;});
  sample(1); world.step(); expect(Array.from(world.positions)).toEqual([1,1,1,1]); expect(Array.from(world.observations)).toEqual([1,1,1,1]);
  pads.forEach(pad => {pad.axes[0] = -1; pad.buttons[0]!.value = 0;});
  sample(1); world.step(); expect(Array.from(world.positions)).toEqual([2,2,2,2]); expect(Array.from(world.observations)).toEqual([1,1,1,1]);
  sample(2); world.step(); expect(Array.from(world.positions)).toEqual([1,1,1,1]); expect(poll).toHaveBeenCalledTimes(3);
  for (const controller of controllers) controller.dispose(); source.dispose();
});

it('keeps the manager usable when browser access to optional preference storage is denied', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', {configurable: true, get() {throw new DOMException('Storage denied','SecurityError');}});
  try {
    const manager = new GamepadManager(FLIGHT_PROFILE_CODEC);
    expect(manager.enabled).toBe(true); expect(() => manager.setEnabled(false)).not.toThrow(); expect(manager.enabled).toBe(false); manager.dispose();
  } finally {if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else Reflect.deleteProperty(globalThis,'localStorage');}
});


it('drops copied devices and channels on topology changes without retaining native objects', async () => {
  const { createGamepadCapture } = await import('../../modules/input-gamepad/src/capture');
  const pads = makePads(); vi.stubGlobal('navigator', { getGamepads: () => pads });
  const capture = createGamepadCapture();
  const first = capture.read(1);
  expect(first.connected).toHaveLength(4);
  pads[0]!.axes.length = 1; pads[0]!.buttons.length = 1;
  const smaller = capture.read(2);
  expect(smaller.byIndex[0]!.axes).toHaveLength(1);
  expect(smaller.byIndex[0]!.buttons).toHaveLength(1);
  pads[0]!.connected = false;
  expect(capture.read(3).byIndex[0]).toBeUndefined();
  expect(capture.read(3).connected).toHaveLength(3);
  pads[0]!.connected = true; pads[0]!.id = 'Replacement device';
  expect(capture.read(4).byIndex[0]!.id).toBe('Replacement device');
  capture.dispose(); expect(first.connected).toHaveLength(0);
  expect(() => capture.read(5)).toThrow('disposed');
});

it('keeps missing devices neutral, caches a failed explicit capture, and retries on a new identity', async () => {
  const { createGamepadCapture } = await import('../../modules/input-gamepad/src/capture');
  vi.stubGlobal('navigator', {});
  const capture = createGamepadCapture();
  expect(capture.read(0).connected).toEqual([]);
  let denied = true;
  const poll = vi.fn(() => { if (denied) throw new Error('Device access denied'); return makePads(); });
  vi.stubGlobal('navigator', { getGamepads: poll });
  expect(() => capture.read(1)).toThrow('Device access denied');
  denied = false;
  expect(() => capture.read(1)).toThrow('Device access denied');
  expect(poll).toHaveBeenCalledTimes(1);
  expect(capture.read(2).connected).toHaveLength(4);
  for (const invalid of [-1, .5, NaN, Number.MAX_SAFE_INTEGER + 1]) expect(() => capture.read(invalid)).toThrow('captureId');
  expect(poll).toHaveBeenCalledTimes(2);
  capture.dispose();
});

it('uses detached diagnostics when a replacement provider omits borrowed device reads', () => {
  const devices = [{ index: 3, id: 'Replacement', connected: true, family: 'generic' as const, familyName: 'Generic', axes: [0], buttons: [] }];
  const getDiagnostics = vi.fn(() => devices);
  expect(readFlightDevices({ getDiagnostics }, 7)).toBe(devices);
  expect(getDiagnostics).toHaveBeenCalledWith(7);
});
