import { describe, expect, it } from 'vitest';
import { mountFlightAudio } from '../../apps/web/src/audio';
import { FLIGHT_CAMERAS, SMART_CAMERAS, UNIVERSE_SAVES, VIEW_HUD } from '../../packages/game-api/src/index';
import { prepareBundledPlan } from '../../packages/game-runtime/src/bundled-plan';
import { browserPresentationProviders, browserTargetModules, browserTargetSelection, prepareBrowserTarget } from '../../apps/web/src/target-modules';
import { engineModuleServices } from '../../packages/sim-core/src/module-services';
import { universeSaveFormatService } from '../../packages/game-library/src/universe-save-services';
const services = [universeSaveFormatService, ...engineModuleServices()];

describe('shipped target composition', () => {
  it.each(['browser', 'offline'] as const)('initializes the exact %s selection and retains independent cameras and disposal', environment => {
    const target = prepareBrowserTarget('builtin.space-sim', environment);
    const factory = target.providedService(FLIGHT_CAMERAS), cameras = [factory.create(), factory.create()];
    cameras[0]!.changeZoom(2);
    expect(cameras[0]!.zoom).not.toBe(cameras[1]!.zoom);
    const smart = target.providedService(SMART_CAMERAS).create();
    smart.start({ id: 'beacon', name: 'Beacon' });
    const saves = target.providedService(UNIVERSE_SAVES);
    const huds = target.providedService(VIEW_HUD);
    huds.create({ binding: { seatId: 'seat-1', viewportId: 'view-1', session: {} }, adapters: [] });
    target.dispose(); target.dispose();
    expect(() => factory.create()).toThrow('disposed');
    expect(() => saves.create({} as never)).toThrow('disposed');
    expect(() => smart.start({ id: 'beacon', name: 'Beacon' })).toThrow('disposed');
    expect(() => huds.create({ binding: { seatId: 'seat-2', viewportId: 'view-2', session: {} }, adapters: [] })).toThrow('disposed');
  });
  it('omits smart policy in the starter and supports explicit optional removal without losing base camera control', () => {
    const plan = browserTargetSelection('builtin.space-sim').plans.browser!;
    const stripped = { ...plan, profile: { ...plan.profile,
      modules: plan.profile.modules.filter(ref => ref.id !== 'spacelab.camera-smart'),
      providers: Object.fromEntries(Object.entries(plan.profile.providers).filter(([slot]) => slot !== SMART_CAMERAS.slot)) } };
    for (const target of [prepareBundledPlan(stripped, 'browser', browserTargetModules, services), prepareBrowserTarget('builtin.flight-starter', 'offline')]) {
      const camera = target.providedService(FLIGHT_CAMERAS).create();
      camera.drag({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, 800, 600);
      camera.fling({ x: -1000, y: 0 }, 800, 600, { kind: 'body', id: 'beacon', name: 'Beacon' });
      expect(camera.smartTarget).toBeUndefined();
      camera.update({ body: { x: 0, y: 0 }, ship: { x: 0, y: 0 }, elapsed: .1, width: 800, height: 600, instant: false });
      expect(camera.pan.x).toBeGreaterThan(0);
      target.dispose();
    }
  });
  it.each(['builtin.planet-viewer', 'builtin.survey-fixture'])('selects only compatible non-flight services for %s', id => {
    const target = prepareBrowserTarget(id, 'browser');
    const selected = target.lock.modules.map(ref => ref.id);
    expect(selected).not.toContain('builtin.motion');
    expect(selected).not.toContain('builtin.audio');
    expect(selected.some(id => /session|vehicle-trainer|flight-split/.test(id))).toBe(false);
    expect(target.contributions('vehicle')).toEqual([]);
    expect(browserTargetSelection(id).plans.node).toBeUndefined();
    target.dispose();
  });
  it('omits sound/artwork independently while retaining selected renderers and required host services', () => {
    const plan = browserTargetSelection('builtin.space-sim').plans.browser!;
    const removed = new Set(['builtin.audio', 'spacelab.audio-controls', 'spacelab.trainer-appearance']);
    const target = prepareBundledPlan({ ...plan, profile: { ...plan.profile,
      modules: plan.profile.modules.filter(ref => !removed.has(ref.id)),
      providers: Object.fromEntries(Object.entries(plan.profile.providers).filter(([, id]) => !removed.has(id))) } }, 'browser', browserTargetModules, services);
    const providers = browserPresentationProviders(target);
    expect(providers.audio).toBe(false);
    const root = { hidden: false } as HTMLElement, silent = mountFlightAudio(root);
    expect(root.hidden).toBe(true); silent.play('land'); silent.reset(); silent.update(1, true); silent.dispose(); expect(root.hidden).toBe(false);
    expect(providers.renderers.map(provider => provider.id)).toEqual(['builtin.webgl', 'builtin.canvas']);
    expect(target.contributions('vehicleAppearance')).toEqual([]);
    target.dispose();
    expect(() => providers.renderers[1]!.create({} as HTMLCanvasElement)).toThrow('disposed');
  });
  it('rejects missing required providers, wrong versions and downloaded-package substitutions before initialization', () => {
    const plan = browserTargetSelection('builtin.space-sim').plans.browser!;
    let initialized = 0;
    const registrations = browserTargetModules.map(record => ({ ...record, module: { ...record.module,
      initialize: (context: Parameters<typeof record.module.initialize>[0]) => { initialized++; record.module.initialize(context); } } }));
    for (const slot of plan.requiredSlots) {
      const id = plan.profile.providers[slot];
      const missing = { ...plan, profile: { ...plan.profile, modules: plan.profile.modules.filter(ref => ref.id !== id),
        providers: Object.fromEntries(Object.entries(plan.profile.providers).filter(([, provider]) => provider !== id)) } };
      expect(() => prepareBundledPlan(missing, 'browser', registrations, services)).toThrow();
      expect(initialized).toBe(0);
    }
    const wrong = { ...plan, profile: { ...plan.profile, modules: plan.profile.modules.map(ref => ref.id === 'spacelab.camera-follow' ? { ...ref, version: '99.0.0' } : ref) } };
    expect(() => prepareBundledPlan(wrong, 'browser', registrations, services)).toThrow(/99.0.0/);
    expect(() => prepareBundledPlan({ ...plan, packages: [{ id: 'spacelab.camera-follow', version: '0.3.0', digest: '0'.repeat(64) }] }, 'browser', registrations, services)).toThrow('explicit code approval');
    expect(initialized).toBe(0);
    expect(() => prepareBrowserTarget('builtin.space-sim', 'node')).toThrow('browser adapter');
  });
});
