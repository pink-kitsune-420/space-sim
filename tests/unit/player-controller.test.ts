import guide from '../../modules/player-controller/docs/creators/usage.json';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLAYER_CONTROLLERS, type ControlTargetAdapter, type ControlTargetBinding, type ManifestV2,
  type ActionSink, type InputSource, type ModuleProfileV2, type PlayerControllerFactory } from '../../packages/game-api/src/index';
import { createGamepadSource } from '../../modules/input-gamepad/src/index';
import { ModuleRegistryV2, moduleAssets } from '../../packages/game-runtime/src/modules-v2';
import initialize, { createPlayerController } from '../../modules/player-controller/src/index';
import descriptor from '../../modules/player-controller/module.json';

const binding: ControlTargetBinding = { seatId: 'seat-A', playerId: 'session-B', entityId: 'marker-C', viewportId: 'view-D' };
afterEach(() => vi.unstubAllGlobals());
function survey() {
  const values = new Map<string, number>(); let owner = binding.playerId;
  const adapter: ControlTargetAdapter = { schema: 'spacelab-control-target/1', canControl: b => b.playerId === owner,
    actions: () => ['fixture.survey/move', 'fixture.survey/record'],
    setAction(b, action, value) {
      if (b.playerId !== owner) throw new Error('Ownership rejected');
      values.set(`${b.entityId}/${action}`, value);
    }, release(b) { values.delete(`${b.entityId}/fixture.survey/move`); values.delete(`${b.entityId}/fixture.survey/record`); } };
  return { adapter, values, transfer() { owner = 'other-player'; } };
}
describe('portable player controllers', () => {
  it('routes bounded non-flight intent with separate identities and releases before target changes', () => {
    const state = survey(), controller = createPlayerController(state.adapter);
    controller.select(binding); controller.set('fixture.survey/move', 3);
    expect(controller.target).toEqual(binding);
    expect(state.values.get('marker-C/fixture.survey/move')).toBe(1);
    controller.select({ ...binding, entityId: 'marker-E' }); expect(state.values.size).toBe(0);
    controller.set('fixture.survey/record', 1);
    controller.release(); expect(state.values.size).toBe(0);
    controller.dispose(); expect(() => controller.set('fixture.survey/move', 1)).toThrow('disposed');
  });
  it('rejects unsupported/non-finite intent and ownership changes without retaining held intent', () => {
    const state = survey(), controller = createPlayerController(state.adapter);
    controller.select(binding); controller.set('fixture.survey/move', 1);
    expect(() => controller.set('builtin.flight/engine', 1)).toThrow('unsupported');
    expect(() => controller.set('fixture.survey/move', NaN)).toThrow('Invalid');
    state.transfer(); expect(() => controller.set('fixture.survey/move', 0)).toThrow('ownership');
    expect(state.values.size).toBe(0); expect(controller.target).toBeUndefined();
    expect(() => controller.select(binding)).toThrow('does not own');
  });
  it('keeps four independently selected non-flight control instances isolated', () => {
    const state = survey();
    const controllers = Array.from({ length: 4 }, (_, i) => {
      const controller = createPlayerController(state.adapter);
      controller.select({ ...binding, seatId: `seat-${i}`, entityId: `marker-${i}`, viewportId: `view-${i}` }); return controller;
    });
    for (const controller of controllers) controller.set('fixture.survey/move', 1);
    expect(state.values.size).toBe(4);
    controllers[1]!.dispose(); expect(state.values.size).toBe(3);
    controllers.forEach(c => c.dispose()); expect(state.values.size).toBe(0);
  });
  it('creates controllers after initialization and disposes them with their provider', () => {
    const registry = new ModuleRegistryV2(); let factory!: PlayerControllerFactory;
    const manifest = descriptor.manifest as ManifestV2;
    registry.register({ manifest, initialize }, moduleAssets(new Map([['docs/creators/usage.json', new TextEncoder().encode(JSON.stringify(guide))]])));
    registry.register({ manifest: { ...manifest, id: 'fixture.consumer', slots: [], provides: [], requires: [{ name: 'input.controller', version: '^1.0.0' }] },
      initialize(c) { factory = c.use(PLAYER_CONTROLLERS); } });
    const profile: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.controllers',
      modules: [manifest.id, 'fixture.consumer'].map(id => ({ id, version: '0.1.0' })), providers: { 'input.controller': manifest.id }, capabilities: {}, settings: {} };
    const candidate = registry.prepare(profile, 'browser'), state = survey();
    const controller = factory.create(state.adapter); controller.select(binding); controller.set('fixture.survey/move', 1);
    candidate.dispose(); expect(state.values.size).toBe(0); expect(() => factory.create(state.adapter)).toThrow('disposed');
  });
  it('routes ordered sampled actions, clears missing values and keeps source ownership with its provider', () => {
    const state = survey(), closed = vi.fn(); let held = true, captured!: ActionSink;
    const source: InputSource = { name: 'fixture', sample(_frame, into) { captured = into; if (held) into.set('fixture.survey/move', 1); into.set('fixture.other/unhandled', .5); },
      release: vi.fn(), dispose: closed };
    const override: InputSource = { name: 'override', sample(_frame, into) { if (held) into.set('fixture.survey/move', -.5); }, release() {}, dispose: closed };
    const controller = createPlayerController(state.adapter, { pilot: 2, sources: [source, override] });
    controller.select(binding);
    const frame = { elapsed: .01, flightAllowed: false, shortcutsAllowed: true };
    controller.sample(frame); expect(state.values.get('marker-C/fixture.survey/move')).toBe(-.5);
    expect(() => captured.set('fixture.survey/move', 1)).toThrow('outside its sample');
    held = false; controller.sample(frame); expect(state.values.get('marker-C/fixture.survey/move')).toBe(0);
    controller.sample({ ...frame, shortcutsAllowed: false }); expect(state.values.size).toBe(0);
    expect(source.release).toHaveBeenCalledWith(2);
    controller.bindInput({ pilot: 1, sources: [source] }); controller.dispose();
    expect(source.release).toHaveBeenLastCalledWith(1); expect(closed).not.toHaveBeenCalled();
  });
  it('releases real held device intent on target changes, suppression and disconnect before resuming', () => {
    const state = survey(), pad = { connected: true, axes: [0], buttons: [] };
    vi.stubGlobal('navigator', { getGamepads: () => [pad] });
    const source = createGamepadSource({ actions: [{ id: 'fixture.survey/move', label: 'Move', category: 'system', mode: 'axis', defaultKeys: [] }],
      bindings: [{ action: 'fixture.survey/move', axis: 0 }], deadzone: .15, pad: () => 0 });
    const controller = createPlayerController(state.adapter, { pilot: 0, sources: [source] });
    const frame = { elapsed: .01, flightAllowed: false, shortcutsAllowed: true };
    controller.select(binding); controller.sample(frame); pad.axes[0] = 1; controller.sample(frame);
    expect(state.values.get('marker-C/fixture.survey/move')).toBe(1);
    controller.select({ ...binding, entityId: 'marker-E' }); controller.sample(frame); expect(state.values.size).toBe(0);
    pad.axes[0] = 0; controller.sample(frame); pad.axes[0] = -1; controller.sample(frame);
    expect(state.values.get('marker-E/fixture.survey/move')).toBe(-1);
    pad.connected = false; controller.sample(frame); expect(state.values.get('marker-E/fixture.survey/move')).toBe(0);
    pad.connected = true; controller.sample(frame); expect(state.values.get('marker-E/fixture.survey/move')).toBe(0);
    pad.axes[0] = 0; controller.sample(frame); pad.axes[0] = 1; controller.sample(frame);
    controller.sample({ ...frame, shortcutsAllowed: false }); controller.sample(frame); expect(state.values.size).toBe(0);
    controller.dispose(); source.dispose();
  });
  it('discards failed samples and releases every source even when one release fails', () => {
    const state = survey(), secondRelease = vi.fn(); let broken = false;
    const first: InputSource = { name: 'broken', sample(_frame, sink) { sink.set('fixture.survey/move', 1); if (broken) throw new Error('Broken device'); },
      release() { if (broken) throw new Error('Broken release'); }, dispose() {} };
    const second: InputSource = { name: 'other', sample() {}, release: secondRelease, dispose() {} };
    const controller = createPlayerController(state.adapter, { pilot: 0, sources: [first, second] }); controller.select(binding);
    const frame = { elapsed: .01, flightAllowed: true, shortcutsAllowed: true };
    controller.sample(frame); expect(state.values.size).toBe(1); broken = true;
    expect(() => controller.sample(frame)).toThrow('Input sampling and release failed'); expect(state.values.size).toBe(0);
    expect(secondRelease).toHaveBeenCalled();
    expect(() => controller.bindInput(undefined)).toThrow('release failed');
    expect(() => controller.sample(frame)).toThrow('Bind input');
    controller.dispose();
  });
});
