import { describe, expect, it } from 'vitest';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { FLIGHT_CAMERAS, SMART_CAMERAS, type ModuleProfileV2, type SmartCameraTarget } from '../../packages/game-api/src/index';
import { ModuleRegistryV2 } from '../../packages/game-runtime/src/modules-v2';
import { inspectRuntimePackage } from '../../packages/game-library/src/runtime-package';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
import { createSmartCameras, findSmartCameraTarget } from '../../modules/camera-smart/src/index';
import { createFlightCameras } from '../../modules/camera-follow/src/index';

const target = { id: 'survey-beacon', name: 'Survey beacon' };
const frame = { origin: { x: 0, y: 0 }, pan: { x: 0, y: 0 }, velocity: { x: 0, y: 0 },
  targetPosition: { x: 300, y: 0 }, scale: 1, elapsed: .02, instant: false };

describe('optional smart camera policy', () => {
  it('searches arbitrary target groups without a ship, world, renderer or input device', () => {
    const near = { ...target, position: { x: 300, y: 0 } }, far = { id: 'antenna', name: 'Antenna', position: { x: 500, y: 0 } };
    const search = { currentCenter: { x: 0, y: 0 }, screenVelocity: { x: -1000, y: 0 }, cameraRotation: 0, scale: 1 };
    expect(findSmartCameraTarget({ ...search, groups: [[far], [near]] })).toBe(far);
    expect(findSmartCameraTarget({ ...search, groups: [[far, near]] })).toBe(near);
    expect(findSmartCameraTarget({ ...search, groups: [[far, near]], currentFocusId: near.id })).toBe(far);
    expect(findSmartCameraTarget({ ...search, groups: [[near]], screenVelocity: { x: -300, y: 0 } })).toBeUndefined();
  });

  it('keeps four views independent, reuses output, releases missing targets and owns cleanup', () => {
    const factory = createSmartCameras(), controls = Array.from({ length: 4 }, () => factory.create<SmartCameraTarget>());
    controls[0]!.start(target);
    const first = controls[0]!.update(frame)!;
    expect(first.pan.x).toBeGreaterThan(0);
    expect(controls[0]!.update(frame)).toBe(first);
    for (const control of controls.slice(1)) { expect(control.target).toBeUndefined(); expect(control.update(frame)).toBeUndefined(); }
    controls[0]!.update({ ...frame, instant: true });
    expect(controls[0]!.focus).toBe(target);
    expect(controls[0]!.update({ ...frame, targetPosition: { x: 500, y: 9 } })!.pan).toEqual({ x: 500, y: 9 });
    expect(controls[0]!.update({ ...frame, targetPosition: undefined })).toBeUndefined();
    expect(controls[0]!.focus).toBeUndefined();
    controls[1]!.start(target, true);
    expect(controls[1]!.update({ ...frame, instant: true })!.follow).toBe(true);
    expect(controls[1]!.focus).toBeUndefined();
    factory.dispose(); factory.dispose();
    for (const control of controls) expect(() => control.update(frame)).toThrow('disposed');
    expect(() => factory.create()).toThrow('disposed');
  });

  it('keeps basic camera movement useful without the policy and restores smart behavior explicitly', () => {
    const basic = createFlightCameras(), smart = createSmartCameras(), enhanced = createFlightCameras({}, smart);
    const simple = basic.create(), guided = enhanced.create();
    for (const camera of [simple, guided]) {
      camera.drag({ x: 0, y: 0 }, frame.origin, frame.origin, 800, 600);
      camera.fling({ x: -1000, y: 0 }, 800, 600, { kind: 'body', ...target });
    }
    expect(simple.smartTarget).toBeUndefined();
    expect(guided.smartTarget?.id).toBe(target.id);
    simple.update({ body: frame.origin, ship: frame.origin, elapsed: .1, width: 800, height: 600, instant: false });
    expect(simple.pan.x).toBeGreaterThan(0);
    guided.update({ body: frame.origin, ship: frame.origin, elapsed: .1, width: 800, height: 600, instant: true, focusPosition: frame.targetPosition });
    expect(guided.focusTarget?.id).toBe(target.id);
    basic.dispose(); enhanced.dispose(); smart.dispose();
  });

  it('builds editable packages and composes optional/replacement policies on browser, offline and Node targets', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'smart-camera-package-'));
    try {
      const packages = [];
      for (const name of ['camera-follow', 'camera-smart']) {
        const source = join(directory, name), output = join(directory, `${name}.spacemod`);
        await cp(resolve(`modules/${name}`), source, { recursive: true });
        await buildPortableModule(join(source, 'module.json'), output);
        packages.push(await inspectRuntimePackage(new Uint8Array(await readFile(output))));
      }
      for (const environment of ['browser', 'offline', 'node'] as const) {
        const registry = new ModuleRegistryV2();
        const modules = packages.map(checked => checked.register({ environment, allowRuntimeCode: true, approvedDigests: new Set([checked.digest]) }));
        for (const registration of modules) registry.register(registration.module, registration.assets);
        const refs = modules.map(({ module }) => ({ id: module.manifest.id, version: module.manifest.version }));
        const base: ModuleProfileV2 = { format: 'space-sim-profile/2', id: 'fixture.survey-camera', modules: [refs[0]!],
          providers: { 'view.flight-camera': refs[0]!.id }, capabilities: {}, settings: {} };
        const absent = registry.prepare(base, environment);
        expect(absent.providedService(FLIGHT_CAMERAS).create().follow).toBe(true);
        absent.dispose();
        const profile = { ...base, modules: refs, providers: { ...base.providers, 'view.smart-camera': refs[1]!.id } };
        const present = registry.prepare(profile, environment), camera = present.providedService(FLIGHT_CAMERAS).create();
        camera.drag(frame.origin, frame.origin, frame.origin, 800, 600);
        camera.fling({ x: -1000, y: 0 }, 800, 600, { kind: 'body', ...target });
        expect(camera.smartTarget?.id).toBe(target.id);
        const policy = present.providedService(SMART_CAMERAS).create<SmartCameraTarget>();
        policy.start(target); expect(policy.update({ ...frame, instant: true })!.pan).toEqual(frame.targetPosition);
        present.dispose(); expect(() => policy.update(frame)).toThrow('disposed');
        registry.register({ manifest: { ...modules[1]!.module.manifest, id: 'fixture.other-camera-policy' },
          initialize(context) { context.provide(SMART_CAMERAS, context.own(createSmartCameras())); } });
        const replacement = registry.prepare({ ...base, modules: [...base.modules, { id: 'fixture.other-camera-policy', version: refs[1]!.version }],
          providers: { ...base.providers, 'view.smart-camera': 'fixture.other-camera-policy' } }, environment);
        expect(replacement.providedService(SMART_CAMERAS).select({ currentCenter: frame.origin, screenVelocity: { x: -1000, y: 0 },
          cameraRotation: 0, scale: 1, groups: [[{ ...target, position: frame.targetPosition }]] })?.id).toBe(target.id);
        replacement.dispose();
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  }, 60000);
});
