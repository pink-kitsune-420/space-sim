import { afterEach, describe, expect, it, vi } from 'vitest';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLEET_VIEWS, FLIGHT_CAMERAS, FLIGHT_SPLIT, FLIGHT_ACTIONS, GAMEPAD_INPUT, LOCAL_VIEWS, PLAYER_CONTROLLERS, PREDICTIONS, VIEW_CAMERAS, type ModuleProfileV2, type RegisteredModuleV2 } from '../../packages/game-api/src/index';
import { BoundedSurvey, SURVEY_ACTIONS, surveyCameras } from '../fixtures/bounded-survey';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule, unpackPackage } from '../../packages/module-tools/package.mjs';

const temporary: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true }); });
const names = ['input-actions', 'input-keyboard', 'input-touch', 'input-gamepad', 'player-controller', 'local-pilots', 'local-views', 'input-profiles', 'controller-menu', 'flight-split'];
async function directory() { const path = await mkdtemp(join(tmpdir(), 'portable-controls-')); temporary.push(path); return path; }
async function built(name: string, root: string) {
  const folder = join(root, name); await cp(resolve('modules', name), folder, { recursive: true });
  const output = join(root, `${name}.spacemod`); await buildPortableModule(join(folder, 'module.json'), output, { typecheck: false });
  return { bytes: new Uint8Array(await readFile(output)), folder, output };
}
function profile(modules: readonly RegisteredModuleV2[]): ModuleProfileV2 {
  return { format: 'space-sim-profile/2', id: 'fixture.portable-controls', modules: modules.map(m => ({ id: m.manifest.id, version: m.manifest.version })),
    providers: Object.fromEntries(modules.flatMap(m => m.manifest.slots.map(slot => [slot, m.manifest.id]))), capabilities: {}, settings: {} };
}
describe('extracted package portability', () => {
  it('builds and imports real editable input modules through consent and public services', async () => {
    const root = await directory(), registry = new ModuleRegistryV2(), modules: RegisteredModuleV2[] = [];
    for (const name of names) {
      const { bytes } = await built(name, root), checked = await inspectRuntimePackage(bytes);
      const registration = checked.register({ environment: 'offline', allowRuntimeCode: true, approvedDigests: new Set([checked.digest]) });
      modules.push(registration.module); registry.register(registration.module, registration.assets);
    }
    expect(() => registry.prepare(profile(modules), 'offline')).toThrow('view.camera');
    // This package-graph test does not create surfaces. Runtime view behavior is
    // exercised separately; these factory declarations establish explicit ports.
    const slots = ['view.camera', 'view.flight-camera', 'view.prediction', 'view.fleet'];
    const camera: RegisteredModuleV2 = { manifest: { ...modules[0]!.manifest, id: 'fixture.camera', provides: slots.map(name => ({ name, version: '1.0.0' })), requires: [], slots },
      initialize(c) {
        const notRequested = { create() { throw new Error('A surface was not requested by this package-graph test'); } };
        c.provide(VIEW_CAMERAS, surveyCameras()); c.provide(FLIGHT_CAMERAS, notRequested);
        c.provide(PREDICTIONS, notRequested); c.provide(FLEET_VIEWS, notRequested);
      } };
    modules.push(camera); registry.register(camera);
    const candidate = registry.prepare(profile(modules), 'offline');
    expect(candidate.providedService(FLIGHT_ACTIONS).definitions.some(a => a.id === 'spacelab.input-actions/engine')).toBe(true);
    // Actual imported device/controller/view implementations over a bounded
    // non-flight fixture, with no Space Sim application or flight world wiring.
    for (const count of [1, 2, 3, 4]) {
      const survey = new BoundedSurvey(), pads = Array.from({ length: count }, () => ({ connected: true, axes: [0], buttons: [{ value: 0 }] }));
      vi.stubGlobal('navigator', { getGamepads: () => pads });
      const source = candidate.providedService(GAMEPAD_INPUT).create({ actions: SURVEY_ACTIONS,
        bindings: [{ action: 'fixture.survey/move', axis: 0 }, { action: 'fixture.survey/record', button: 0 }], deadzone: .15, pad: pilot => pilot });
      const controllers = Array.from({ length: count }, (_, pilot) => {
        const control = candidate.providedService(PLAYER_CONTROLLERS).create(survey.controls, { pilot, sources: [source] });
        control.select(survey.binding(pilot)); return control;
      });
      const draws = new Uint32Array(count), scales = new Float64Array(count), closed: string[] = [];
      const views = candidate.providedService(LOCAL_VIEWS).create({ bindings: controllers.map(control => {
        const target = control.target!; return { viewportId: target.viewportId!, seatId: target.seatId, playerId: target.playerId, targetId: target.entityId };
      }), layout: 'auto', mode: 'split', surface(binding) {
        const pilot = Number(binding.viewportId.slice(4)) - 20;
        return { resize() {}, draw(camera) { draws[pilot] = draws[pilot]! + 1; scales[pilot] = camera.scale;
          expect(camera.center.x).toBe(survey.positions[pilot]); }, dispose() { closed.push(binding.viewportId); } };
      } });
      views.reflow(1000, 600); views.camera(survey.binding(0).viewportId!).changeZoom(2);
      const frame = { elapsed: .02, flightAllowed: false, shortcutsAllowed: true };
      controllers.forEach(control => control.sample(frame));
      pads.forEach((pad, i) => { pad.axes[0] = i % 2 ? -1 : 1; pad.buttons[0]!.value = 1; });
      const advance = () => {
        controllers.forEach(control => control.sample(frame)); survey.step(); views.render(.02, survey.transform);
      };
      advance(); expect(survey.tick).toBe(1); expect(Array.from(survey.observations.slice(0, count))).toEqual(Array(count).fill(1));
      controllers[0]!.release(); if (pads[1]) pads[1].connected = false;
      advance(); expect(survey.positions[0]).toBe(1); if (pads[1]) expect(survey.positions[1]).toBe(-1);
      pads.forEach(pad => { pad.connected = true; pad.axes[0] = 0; }); advance();
      pads.forEach((pad, i) => { pad.axes[0] = i % 2 ? -1 : 1; });
      for (let tick = 0; tick < 20; tick++) advance();
      expect(survey.tick).toBe(23); expect(Array.from(draws)).toEqual(Array(count).fill(23));
      expect(Array.from(survey.positions.slice(0, count))).toEqual(Array.from({ length: count }, (_, i) => i % 2 ? -10 : 10));
      expect(scales[0]).toBe(2); expect(Array.from(scales.slice(1))).toEqual(Array(count - 1).fill(1));
      expect(views.splitActive).toBe(count > 1);
      controllers.forEach(control => control.dispose()); views.dispose(); source.dispose(); expect(closed.length).toBe(count);
      survey.step(); expect(Array.from(survey.positions.slice(0, count))).toEqual(Array.from({ length: count }, (_, i) => i % 2 ? -10 : 10));
    }
    const controls = candidate.providedService(PLAYER_CONTROLLERS), intent: number[] = [];
    const controller = controls.create({ schema: 'spacelab-control-target/1', actions: () => ['fixture.survey/record'], canControl: b => b.playerId === 'survey-owner',
      setAction(_binding, _action, value) { intent.push(value); }, release() { intent.push(0); } });
    controller.select({ seatId: 'physical-seat', playerId: 'survey-owner', entityId: 'survey-marker', viewportId: 'map-pane' });
    controller.set('fixture.survey/record', 1); candidate.dispose(); expect(intent).toEqual([1, 0]);
    const keyboardOnly = modules.filter(module => module.manifest.id !== 'spacelab.input-gamepad');
    const withoutGamepad = registry.prepare(profile(keyboardOnly), 'offline');
    expect(withoutGamepad.providedService(FLIGHT_SPLIT).create).toBeTypeOf('function');
    expect(withoutGamepad.lock.capabilities['spacelab.flight-split']?.['input.gamepad']).toBeUndefined();
    withoutGamepad.dispose();
    expect(() => registry.resolve(profile(modules), 'node')).toThrow('cannot run');
  }, 60000);
  it('exports, unpacks, edits, rebuilds and replaces a provider without retaining its old actions', async () => {
    const root = await directory(), original = await built('input-actions', root), unpacked = join(root, 'edited');
    await unpackPackage(original.output, unpacked);
    const descriptorPath = join(unpacked, 'module.json'), descriptor = JSON.parse(await readFile(descriptorPath, 'utf8'));
    descriptor.manifest.id = 'fixture.actions'; await writeFile(descriptorPath, JSON.stringify(descriptor));
    const entry = join(unpacked, 'src/index.ts'); await writeFile(entry, (await readFile(entry, 'utf8')).replaceAll('spacelab.input-actions/', 'fixture.actions/'));
    const bindings = join(unpacked, 'src/bindings.ts'); await writeFile(bindings, (await readFile(bindings, 'utf8')).replace('Fire Main Engine', 'Edited Engine'));
    const output = join(root, 'edited.spacemod'); await buildPortableModule(descriptorPath, output, { typecheck: false });
    const first = await inspectRuntimePackage(original.bytes), second = await inspectRuntimePackage(new Uint8Array(await readFile(output)));
    expect(second.digest).not.toBe(first.digest);
    const unapproved = new ModuleRegistryV2(), locked = second.register({ environment: 'offline', allowRuntimeCode: true, approvedDigests: new Set() });
    unapproved.register(locked.module, locked.assets); expect(() => unapproved.prepare(profile([locked.module]), 'offline')).toThrow('approve this exact');
    const registry = new ModuleRegistryV2(), modules: RegisteredModuleV2[] = [];
    for (const checked of [first, second]) {
      const r = checked.register({ environment: 'offline', allowRuntimeCode: true, approvedDigests: new Set([checked.digest]) });
      registry.register(r.module, r.assets); modules.push(r.module);
    }
    const selected = profile(modules), candidate = registry.prepare(selected, 'offline');
    expect(candidate.actionDefinitions.find(a => a.id === 'fixture.actions/engine')?.label).toBe('Edited Engine');
    expect(candidate.actionIds.has('spacelab.input-actions/engine')).toBe(false);
    expect(candidate.providedService(FLIGHT_ACTIONS).definitions[0]!.label).toBe('Edited Engine'); candidate.dispose();
    const omitted = registry.prepare({ ...selected, modules: [], providers: {} }, 'offline'); expect(omitted.actionDefinitions).toEqual([]); omitted.dispose();
  }, 60000);
});
