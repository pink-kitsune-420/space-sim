import { expect, it } from 'vitest';
import { FLIGHT_HUD_STATE, FLIGHT_PLANS, THROTTLE_HUD, type FlightHudAdapter, type ManifestV2, type ModuleProfileV2,
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
