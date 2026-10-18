import { describe, expect, it } from 'vitest';
import type {
  CameraHook, LayerHook, ModuleManifest, OverlayPrimitive, PanelHook, PresentationSnapshot, PresentationView, RegisteredModule, State, Vec,
} from '../../packages/game-api/src/index';
import {
  ModuleRegistry, ModuleRuntime, PresentationHooks, capturePresentation, frozenSnapshot, validateCameraTarget, validateOverlay, validatePanelRows,
} from '../../packages/game-runtime/src/index';
import { motionCopy } from '../../packages/game-runtime/src/motion';
import {
  BUILTIN_RENDERERS, DEFAULT_PRESENTATION_MODULES, DEFAULT_PRESENTATION_PROFILE, INSTRUMENTS, TOOLSET_MODULES,
  createPresentationRegistry, presentationProfile,
} from '../../packages/modules/src/browser';
import { prepareGame } from '../../packages/modules/src/index';
import { format, readFlightData } from '../../packages/modules/src/base/toolset/flight-data';
import { PRESENTATION_EXAMPLES } from '../../examples/modules/index';
import { elements, propagate, timeToApsis } from '../../packages/sim-core/src/orbit';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/index';
import { project, screenOverlays } from '../../packages/render-2d/src/index';

const BODY = { id: 'planet', name: 'Primus', radius: 512, mu: 13_107_200, position: { x: 1000, y: -2000 } };
const flying = (position: Vec, velocity: Vec, extra: Partial<State> = {}): State =>
  ({ time: 5, position, velocity, heading: 0, throttle: .5, status: 'flying', revision: 0, ...extra });
function snapshot(state: State | undefined, extra: Partial<PresentationSnapshot> = {}): PresentationSnapshot {
  return motionCopy({ time: state?.time ?? 0, tick: 500, paused: false, elapsed: .016, viewport: { width: 800, height: 600, pixelRatio: 2 },
    body: BODY, vehicle: { acceleration: 125, turnRate: 1.2, initialThrottle: .5 },
    analyticOrbits: true, orbit: state ? elements(state, BODY.mu) : null, groundClearance: state ? Math.hypot(state.position.x, state.position.y) - BODY.radius : null,
    prediction: { status: 'closed', samples: 90 }, moduleState: {},
    ...(state ? { ship: { id: 'ship-1', name: 'Vessel 01', bodyId: BODY.id, state, controls: { turn: 0, throttle: 0, engine: false },
      position: { x: BODY.position.x + state.position.x, y: BODY.position.y + state.position.y } } } : {}),
    ...extra });
}
const pointsOf = (primitive: unknown): readonly Vec[] => (primitive as { readonly points: readonly Vec[] }).points;
const viewOf = (s: PresentationSnapshot, scale = .5): PresentationView =>
  Object.freeze({ ...s, camera: Object.freeze({ center: s.ship?.position ?? BODY.position, rotation: 0, scale }) });
function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id, name: id, version: '1.0.0', kind: 'provider',
    authority: 'presentation', environments: ['browser', 'offline'], dependencies: [], slots: [], provides: [], requires: [],
    settings: {}, before: [], after: [], license: 'LicenseRef-Project', ...extra };
}
function hooks(registry: ModuleRegistry, modules: readonly string[]) {
  const candidate = registry.prepare(presentationProfile('builtin.webgl', registry.closure(modules.map(id => ({ id, version: registry.getManifest(id)!.version })))), 'browser', ['renderer']);
  return { candidate, hooks: new PresentationHooks(candidate.layers, candidate.panels, candidate.cameras) };
}

describe('presentation profiles', () => {
  it('ship the flight toolset in the default profile, resolved for browsers only', () => {
    const registry = createPresentationRegistry(PRESENTATION_EXAMPLES);
    expect(DEFAULT_PRESENTATION_PROFILE.modules.map(m => m.id)).toEqual(['builtin.webgl', 'builtin.canvas',
      'builtin.flight-data', 'builtin.flight-vectors', 'builtin.orbit-markers', 'builtin.telemetry', 'builtin.navball', 'builtin.maneuver-planner']);
    // The default instruments are exactly the closure of the console's switches.
    expect(registry.closure(INSTRUMENTS.map(i => ({ id: i.id, version: '0.1.0' })))).toEqual([...DEFAULT_PRESENTATION_MODULES].sort((a, b) => a.id.localeCompare(b.id)));
    const candidate = registry.prepare(DEFAULT_PRESENTATION_PROFILE, 'offline', ['renderer']);
    expect(candidate.service('renderer')).toBe(BUILTIN_RENDERERS[0]);
    expect(candidate.layers.map(l => l.id)).toEqual(['builtin.flight-vectors/velocity', 'builtin.maneuver-planner/maneuver', 'builtin.navball/navball', 'builtin.orbit-markers/apsides']);
    expect(candidate.panels.map(p => p.id)).toEqual(['builtin.telemetry/telemetry']);
    candidate.dispose();
    // A headless server cannot load presentation code, and selecting Canvas initializes no WebGL module.
    expect(() => registry.prepare(DEFAULT_PRESENTATION_PROFILE, 'node', ['renderer'])).toThrow('unsupported environment node');
    const canvas = registry.prepare(presentationProfile('builtin.canvas', []), 'browser', ['renderer']);
    expect((canvas.service('renderer') as { id: string }).id).toBe('builtin.canvas');
    expect(canvas.lock.profileId).toBe('local.presentation');
    canvas.dispose();
    expect(presentationProfile('builtin.webgl').id).toBe('builtin.presentation');
    for (const provider of BUILTIN_RENDERERS) expect(Object.isFrozen(provider.capabilities)).toBe(true);
    expect(BUILTIN_RENDERERS.map(r => [r.id, r.capabilities.shaders])).toEqual([['builtin.webgl', true], ['builtin.canvas', false]]);
    expect(() => createPresentationRegistry([{ manifest: manifest('test.rule', { authority: 'authoritative' }), initialize() {} }])).toThrow('presentation modules only');
  });
  it('keep presentation hooks out of authoritative modules and game profiles', () => {
    const registry = new ModuleRegistry();
    const layer: LayerHook = { name: 'marker', label: 'Marker', draw: () => [] };
    registry.register({ manifest: manifest('test.authority', { authority: 'authoritative', environments: ['node'] }), initialize: c => c.contributeLayer(layer) });
    registry.register({ manifest: manifest('test.look', { environments: ['node'] }), initialize: c => c.contributeCommand({ name: 'go', label: 'Go', resolve: () => ({ throttle: 1 }) }) });
    const profile = (id: string) => ({ format: 'space-sim-profile/1' as const, id: 'test.profile', modules: [{ id, version: '1.0.0' }], providers: {}, settings: {} });
    expect(() => registry.prepare(profile('test.authority'), 'node')).toThrow('Module test.authority: layer hooks require presentation scope');
    expect(() => registry.prepare(profile('test.look'), 'node')).toThrow('Module test.look: commands require authoritative scope');
    const panel: RegisteredModule = { manifest: manifest('test.panel', { environments: ['browser', 'offline', 'node'] }),
      initialize: c => c.contributePanel({ name: 'p', title: 'P', update: () => [] }) };
    expect(() => prepareGame({ environment: 'node', code: [panel], profile: { format: 'space-sim-profile/1', id: 'test.game', modules: [
      { id: 'builtin.content', version: '0.1.0' }, { id: 'builtin.motion', version: '0.1.0' }, { id: 'test.panel', version: '1.0.0' }],
    providers: {}, settings: {} } })).toThrow('layer, panel and camera hooks belong in the presentation profile');
  });
  it('validate hook declarations, names and per-module limits at registration', () => {
    const ok: LayerHook = { name: 'velocity', label: 'Velocity', draw: () => [] };
    const captured = capturePresentation('layer', 'test.module', '1.0.0', ok);
    expect(captured.id).toBe('test.module/velocity');
    expect(Object.isFrozen(captured.hook)).toBe(true);
    for (const [kind, hook] of [['layer', { ...ok, name: 'Bad Name' }], ['layer', { ...ok, label: '' }], ['layer', { ...ok, extra: 1 }],
      ['panel', { name: 'p', title: 'x'.repeat(33), update: () => [] }], ['camera', { name: 'c', label: 'C', frame: 1 }]] as const) {
      expect(() => capturePresentation(kind, 'test.module', '1.0.0', hook as unknown as CameraHook)).toThrow();
    }
    const registry = new ModuleRegistry();
    registry.register({ manifest: manifest('test.many'), initialize: c => { for (let i = 0; i < 9; i++) c.contributePanel({ name: `p${i}`, title: 'P', update: () => [] }); } });
    registry.register({ manifest: manifest('test.twice'), initialize: c => { c.contributeLayer(ok); c.contributeLayer(ok); } });
    const profile = (id: string) => ({ format: 'space-sim-profile/1' as const, id: 'test.profile', modules: [{ id, version: '1.0.0' }], providers: {}, settings: {} });
    expect(() => registry.prepare(profile('test.many'), 'browser')).toThrow('at most 8 panel hooks');
    expect(() => registry.prepare(profile('test.twice'), 'browser')).toThrow('layer test.twice/velocity: duplicate registration');
  });
});

describe('presentation hook output', () => {
  it('accepts bounded, finite overlays and returns detached frozen copies', () => {
    const raw = [{ kind: 'line', space: 'world', points: [{ x: 0, y: 0 }, { x: 1e13, y: -1e13 }], color: '#8ddbc1', width: 2, closed: true },
      { kind: 'circle', space: 'screen', center: { x: 10, y: 20 }, radius: 4, color: '#ffffff80', fill: true },
      { kind: 'text', space: 'screen', at: { x: 5, y: 5 }, text: 'Pe 128 m', color: '#F7C775', align: 'center' }];
    const out = validateOverlay(raw);
    expect(out).toEqual(raw);
    expect(out[0]).not.toBe(raw[0]);
    expect(Object.isFrozen(pointsOf(out[0])[1])).toBe(true);
    const bad: unknown[] = [
      [{ kind: 'polygon', space: 'world', points: [], color: '#fff' }], [{ kind: 'line', space: 'world', points: [{ x: 0, y: 0 }], color: '#ffffff' }],
      [{ kind: 'line', space: 'world', points: [{ x: 0, y: 0 }, { x: NaN, y: 0 }], color: '#ffffff' }],
      [{ kind: 'line', space: 'screen', points: [{ x: 0, y: 0 }, { x: 2e6, y: 0 }], color: '#ffffff' }],
      [{ kind: 'line', space: 'world', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: 'red' }],
      [{ kind: 'line', space: 'world', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], color: '#ffffff', width: 9 }],
      [{ kind: 'circle', space: 'world', center: { x: 0, y: 0 }, radius: 0, color: '#ffffff' }],
      [{ kind: 'text', space: 'screen', at: { x: 0, y: 0 }, text: 'x'.repeat(81), color: '#ffffff' }],
      [{ kind: 'text', space: 'screen', at: { x: 0, y: 0 }, text: 'bell\u0007', color: '#ffffff' }],
      [{ kind: 'text', space: 'screen', at: { x: 0, y: 0 }, text: 'ok', color: '#ffffff', script: 'x' }],
      Array.from({ length: 257 }, () => raw[1]),
      Array.from({ length: 3 }, () => ({ kind: 'line', space: 'world', color: '#ffffff', points: Array.from({ length: 1500 }, (_, i) => ({ x: i, y: 0 })) })),
      Promise.resolve([]), 'line',
    ];
    for (const value of bad) expect(() => validateOverlay(value)).toThrow();
  });
  it('accepts bounded panel rows and finite camera targets', () => {
    expect(validatePanelRows([{ label: 'Speed', value: '12.0', unit: 'm/s' }, { label: 'Ship', value: '' }])).toHaveLength(2);
    for (const rows of [Array.from({ length: 17 }, () => ({ label: 'A', value: 'B' })), [{ label: '', value: 'x' }],
      [{ label: 'A', value: 'x'.repeat(65) }], [{ label: 'A', value: 1 }], [{ label: 'A', value: 'b', color: 'red' }]]) {
      expect(() => validatePanelRows(rows)).toThrow();
    }
    expect(validateCameraTarget({ center: { x: 1e13, y: 0 }, rotation: 1 })).toEqual({ center: { x: 1e13, y: 0 }, rotation: 1 });
    for (const target of [{ center: { x: Infinity, y: 0 } }, { center: { x: 0, y: 0 }, rotation: NaN }, { center: { x: 0, y: 0 }, zoom: 2 }, {}]) {
      expect(() => validateCameraTarget(target)).toThrow();
    }
  });
  it('disables only a failing contribution and reports its module and hook', () => {
    const calls = { bad: 0, good: 0 };
    const layer = (moduleId: string, name: string, draw: () => unknown) => capturePresentation('layer', moduleId, '1.0.0',
      { name, label: name, draw: draw as LayerHook['draw'] });
    const bad = layer('test.bad', 'oops', () => { calls.bad++; throw new Error('no data'); });
    const invalid = layer('test.invalid', 'nan', () => [{ kind: 'circle', space: 'world', center: { x: NaN, y: 0 }, radius: 1, color: '#ffffff' }]);
    const good = layer('test.good', 'ring', () => { calls.good++; return [{ kind: 'circle', space: 'screen', center: { x: 1, y: 1 }, radius: 2, color: '#ffffff' }]; });
    const panel = capturePresentation('panel', 'test.async', '1.0.0', { name: 'p', title: 'P', update: (async () => []) as unknown as PanelHook['update'] });
    const camera = capturePresentation('camera', 'test.cam', '1.0.0', { name: 'c', label: 'C', frame: () => ({ center: { x: 0, y: NaN } }) });
    const faults: string[] = [];
    const runner = new PresentationHooks([bad, invalid, good], [panel], [camera], f => faults.push(`${f.kind} ${f.hook}`));
    const view = viewOf(snapshot(flying({ x: 0, y: 640 }, { x: 143, y: 0 })));
    expect(runner.overlays(view)).toHaveLength(1);
    expect(runner.overlays(view)).toHaveLength(1);
    expect(calls).toEqual({ bad: 1, good: 2 });
    expect(runner.panelRows(view)).toEqual([]);
    expect(runner.camera('test.cam/c', { ...view, scale: 1 })).toBeUndefined();
    expect(runner.camera('test.cam/c', { ...view, scale: 1 })).toBeUndefined();
    expect(faults).toEqual(['layer test.bad/oops', 'layer test.invalid/nan', 'panel test.async/p', 'camera test.cam/c']);
    expect(runner.faults[0]).toEqual({ moduleId: 'test.bad', hook: 'test.bad/oops', kind: 'layer', message: 'no data' });
    expect(runner.drawsLayers).toBe(true);
    expect(runner.updatesPanels).toBe(false);
  });
  it('hands hooks frozen snapshots they cannot change', () => {
    const live = flying({ x: 0, y: 640 }, { x: 143, y: 0 }, { coast: { bodyId: 'planet', epochSeconds: 0, position: { x: 0, y: 640 },
      velocity: { x: 143, y: 0 }, mu: BODY.mu, revision: 0, surfaceRadius: 512, surfaceIdentity: 'circle' } });
    const copy = frozenSnapshot({ state: live, list: [{ a: 1 }], missing: null });
    expect(copy).toEqual({ state: live, list: [{ a: 1 }], missing: null });
    expect(copy.state.coast).not.toBe(live.coast);
    expect(Object.isFrozen(copy.state.coast!.velocity) && Object.isFrozen(copy.list[0])).toBe(true);
    expect(Object.isFrozen(live.coast)).toBe(false);
    const view = viewOf(snapshot(flying({ x: 0, y: 640 }, { x: 143, y: 0 })));
    expect(Object.isFrozen(view.ship!.state.position)).toBe(true);
    expect(() => { (view.ship!.state.position as { x: number }).x = 1; }).toThrow(TypeError);
    expect(() => { (view.body as { mu: number }).mu = 1; }).toThrow(TypeError);
  });
});

describe('flight data toolset', () => {
  const tolerance = (a: number, b: number, relative = 1e-7) => expect(Math.abs(a - b)).toBeLessThanOrEqual(relative * Math.max(1, Math.abs(b)));
  it('times the apsides like the orbital kernel, for both senses of motion', () => {
    for (const velocity of [{ x: 160, y: 20 }, { x: -160, y: -20 }, { x: 120, y: -70 }]) {
      const state = flying({ x: 0, y: 700 }, velocity);
      const data = readFlightData(snapshot(state))!;
      const orbit = data.orbit!;
      expect(orbit.kind).toBe('elliptic');
      tolerance(orbit.timeToPeriapsis!, timeToApsis(state, BODY.mu, 'periapsis')!);
      tolerance(orbit.timeToApoapsis!, timeToApsis(state, BODY.mu, 'apoapsis')!);
      // Independent check: propagating to the predicted times reaches each apsis point.
      for (const [time, point, radius] of [[orbit.timeToPeriapsis!, orbit.periapsisPoint!, orbit.periapsis],
        [orbit.timeToApoapsis!, orbit.apoapsisPoint!, orbit.apoapsis!]] as const) {
        const result = propagate(state, BODY.mu, time);
        if (!result.ok) throw new Error('propagation failed');
        tolerance(Math.hypot(result.state.position.x, result.state.position.y), radius, 1e-9);
        tolerance(BODY.position.x + result.state.position.x, point.x, 1e-6);
        tolerance(BODY.position.y + result.state.position.y, point.y, 1e-6);
      }
    }
  });
  it('handles open, circular and unavailable orbits', () => {
    const approaching = flying({ x: 0, y: 3000 }, { x: -40, y: -150 }), receding = flying({ x: 0, y: 3000 }, { x: 40, y: 150 });
    const inbound = readFlightData(snapshot(approaching))!.orbit!;
    expect(inbound.kind).toBe('hyperbolic');
    tolerance(inbound.timeToPeriapsis!, timeToApsis(approaching, BODY.mu, 'periapsis')!);
    expect([inbound.apoapsis, inbound.apoapsisPoint, inbound.timeToApoapsis, inbound.period]).toEqual([null, undefined, null, null]);
    expect(readFlightData(snapshot(receding))!.orbit!.timeToPeriapsis).toBeNull();
    expect(timeToApsis(receding, BODY.mu, 'periapsis')).toBeNull();
    // Exactly parabolic: |v| = sqrt(2 mu / r) = 160 m/s at r = 1024 m.
    const parabola = flying({ x: 0, y: 1024 }, { x: 128, y: -96 });
    const open = readFlightData(snapshot(parabola))!.orbit!;
    expect(open.kind).toBe('parabolic');
    tolerance(open.timeToPeriapsis!, timeToApsis(parabola, BODY.mu, 'periapsis')!, 1e-6);
    const circular = readFlightData(snapshot(flying({ x: 0, y: 640 }, { x: Math.sqrt(BODY.mu / 640), y: 0 })))!;
    expect([circular.orbit!.periapsisPoint, circular.orbit!.timeToPeriapsis, circular.radial]).toEqual([undefined, null, 0]);
    const custom = readFlightData(snapshot(flying({ x: 0, y: 700 }, { x: 160, y: 20 }), { orbit: null }))!;
    expect(custom.orbit).toBeUndefined();
    expect(custom.speed).toBeCloseTo(Math.hypot(160, 20), 12);
    expect(readFlightData(snapshot(undefined))).toBeUndefined();
  });
  it('derives speed components, path angle, energy, gravity and thrust-to-weight', () => {
    const data = readFlightData(snapshot(flying({ x: 0, y: 1000 }, { x: -30, y: 40 }, { throttle: 1 })))!;
    expect(data).toMatchObject({ radius: 1000, speed: 50, radial: 40, tangential: 30 });
    expect(data.pathAngle).toBeCloseTo(Math.atan2(40, 30) * 180 / Math.PI, 12);
    expect(data.gravity).toBeCloseTo(BODY.mu / 1e6, 12);
    expect(data.energy).toBeCloseTo(1250 - BODY.mu / 1000, 9);
    expect(data.thrustToWeight).toBeCloseTo(125 / (BODY.mu / 1e6), 12);
    expect(data.up).toEqual({ x: 0, y: 1 });
    expect(data.prograde!.x).toBeCloseTo(-.6, 12);
    expect([format.duration(12.34), format.duration(125), format.duration(7322), format.duration(200000), format.duration(-1)])
      .toEqual(['12.3 s', '2 min 05 s', '2 h 02 min', '2 d 07 h', '—']);
    expect([format.distance(128), format.distance(25_000), format.distance(3.84e8), format.number(-25600.4)]).toEqual(['128.0 m', '25.00 km', '384,000 km', '-25,600']);
  });
  it('draws the velocity vector, apsis markers and telemetry through the dependency API', () => {
    const registry = createPresentationRegistry();
    const { candidate, hooks: runner } = hooks(registry, INSTRUMENTS.filter(i => i.id !== 'builtin.navball').map(i => i.id));
    const state = flying({ x: 0, y: 700 }, { x: 160, y: 20 });
    const view = viewOf(snapshot(state), .5);
    const overlays = runner.overlays(view);
    const texts = overlays.filter((p): p is Extract<OverlayPrimitive, { kind: 'text' }> => p.kind === 'text').map(t => t.text);
    expect(texts).toEqual([`${Math.hypot(160, 20).toFixed(1)} m/s`, expect.stringMatching(/^Pe \d+\.\d m · \d/), expect.stringMatching(/^Ap \d+\.\d m · /)]);
    // The arrow is 56 CSS pixels long whatever the zoom: 112 m at 0.5 px/m.
    const shaft = overlays[0] as Extract<OverlayPrimitive, { kind: 'line' }>;
    const tip = shaft.points[1]!, ship = view.ship!.position;
    expect(Math.hypot(tip.x - ship.x, tip.y - ship.y)).toBeCloseTo(112, 9);
    const rows = runner.panelRows(view)[0]!.rows;
    expect(rows.map(r => r.label)).toEqual(['Speed', 'Radial speed', 'Horizontal speed', 'Flight path angle', 'Local gravity', 'Thrust / weight',
      'Orbital energy', 'Orbit', 'Period', 'Time to periapsis', 'Time to apoapsis']);
    const impact = runner.panelRows(viewOf(snapshot(state, { prediction: { status: 'impact', samples: 9, last: { time: 17.25, position: { x: 0, y: 512 }, velocity: { x: 0, y: -9 } } } })))[0]!.rows;
    expect(impact.at(-1)).toEqual({ label: 'Time to impact', value: '12.3 s' });
    const landed = runner.panelRows(viewOf(snapshot(flying({ x: 0, y: 512 }, { x: 0, y: 0 }, { status: 'landed' }), { orbit: null })))[0]!.rows;
    expect(landed.find(r => r.label === 'Orbit')!.value).toBe('—');
    expect(rows.find(r => r.label === 'Time to periapsis')!.value).toBe(format.duration(timeToApsis(state, BODY.mu, 'periapsis')!));
    // Circular orbits have no apsides worth marking; landed ships no velocity vector.
    expect(runner.overlays(viewOf(snapshot(flying({ x: 0, y: 640 }, { x: Math.sqrt(BODY.mu / 640), y: 0 }))))
      .filter(p => p.kind === 'text')).toHaveLength(1);
    expect(runner.overlays(viewOf(snapshot(flying({ x: 0, y: 512 }, { x: 0, y: 0 }, { status: 'landed' }))))).toEqual([]);
    const custom = runner.panelRows(viewOf(snapshot(state, { orbit: null, analyticOrbits: false })))[0]!.rows;
    expect(custom.find(r => r.label === 'Orbit')!.value).toBe('Unavailable · custom motion');
    expect(runner.faults).toEqual([]);
    candidate.dispose();
  });
  it('lets an add-on depend on flight data for a camera mode and marker', () => {
    const registry = createPresentationRegistry(PRESENTATION_EXAMPLES);
    const { candidate, hooks: runner } = hooks(registry, ['example.lead-camera']);
    expect(candidate.lock.order).toEqual(['builtin.canvas', 'builtin.flight-data', 'builtin.webgl', 'example.lead-camera']);
    const s = snapshot(flying({ x: 0, y: 700 }, { x: 160, y: 0 }));
    const target = runner.camera('example.lead-camera/lead', Object.freeze({ ...s, scale: .5 }))!;
    // A third of the 600 px side at 0.5 px/m: 400 m ahead along +X.
    expect(target.center.x - s.ship!.position.x).toBeCloseTo(400, 9);
    expect(target.center.y).toBeCloseTo(s.ship!.position.y, 9);
    expect(runner.overlays(viewOf(s))).toHaveLength(2);
    candidate.dispose();
    expect(TOOLSET_MODULES.every(m => m.manifest.authority === 'presentation' && m.manifest.environments.every(e => e !== 'node'))).toBe(true);
  });
});

describe('presentation never reaches the simulation', () => {
  it('leaves stepped worlds and their fingerprints identical with every presentation profile', () => {
    const plain = prepareGame({ environment: 'node', id: 'w-plain' }), watched = prepareGame({ environment: 'node', id: 'w-plain' });
    plain.runtime.activate(plain.candidate); watched.runtime.activate(watched.candidate);
    const registry = createPresentationRegistry(PRESENTATION_EXAMPLES);
    const runtime = new ModuleRuntime(registry, 'browser');
    const profiles = [presentationProfile('builtin.webgl'), presentationProfile('builtin.canvas', []),
      presentationProfile('builtin.canvas', registry.closure([{ id: 'example.lead-camera', version: '0.1.0' }, { id: 'builtin.telemetry', version: '0.1.0' }]))];
    for (const world of [plain.world, watched.world]) {
      world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
      const burn = world.spawn({ ownerId: 'pilot', presetId: 'pad' });
      world.setControls(burn.id, { turn: .4, throttle: 1, engine: true });
    }
    let drawn = 0;
    for (let tick = 0; tick < 900; tick++) {
      plain.world.step();
      watched.world.step();
      if (tick % 150 === 0) runtime.activate(runtime.prepare(profiles[(tick / 150) % profiles.length]!, ['renderer']));
      const active = runtime.active!;
      const runner = new PresentationHooks(active.layers, active.panels, active.cameras);
      for (const ship of watched.world.ships()) {
        const body = watched.world.body(ship.bodyId);
        const s = motionCopy({ time: watched.world.time, tick: watched.world.tick, paused: false, elapsed: .01,
          viewport: { width: 800, height: 600, pixelRatio: 1 }, body: { id: body.id, name: body.name, radius: body.radius, mu: body.mu, position: { x: 0, y: 0 } },
          ship: { id: ship.id, name: ship.name, bodyId: ship.bodyId, state: ship.state, controls: ship.controls, position: ship.state.position },
          vehicle: watched.world.context.vehicle, analyticOrbits: true, orbit: watched.world.context.services.orbits.elements(ship.state, body.mu),
          groundClearance: null, prediction: { status: 'none', samples: 0 }, moduleState: watched.world.moduleState } satisfies PresentationSnapshot);
        const view = viewOf(s, .3);
        drawn += screenOverlays(runner.overlays(view), view.camera, 800, 600).length;
        runner.panelRows(view);
      }
      expect(runner.faults).toEqual([]);
    }
    expect(drawn).toBeGreaterThan(900);
    expect(watched.world.ships()).toEqual(plain.world.ships());
    expect(watched.world.simulationFingerprint).toBe(plain.world.simulationFingerprint);
    const browser = prepareGame({ environment: 'browser', id: 'w-plain' });
    expect(browser.world.simulationFingerprint).toBe(plain.world.simulationFingerprint);
    expect(plain.world.universe).toBe(DEFAULT_UNIVERSE);
    runtime.dispose(); plain.world.dispose(); watched.world.dispose(); browser.world.dispose();
  });
  it('disposes every superseded presentation candidate exactly once', () => {
    let disposed = 0, created = 0;
    const tracked: RegisteredModule = { manifest: manifest('test.tracked'), initialize: c => { created++; c.own({ dispose: () => { disposed++; } }); } };
    const registry = createPresentationRegistry([tracked]);
    const runtime = new ModuleRuntime(registry, 'browser');
    for (let i = 0; i < 50; i++) runtime.activate(runtime.prepare(presentationProfile(i % 2 ? 'builtin.canvas' : 'builtin.webgl', [{ id: 'test.tracked', version: '1.0.0' }]), ['renderer']));
    expect([created, disposed]).toEqual([50, 49]);
    runtime.dispose(); runtime.dispose();
    expect(disposed).toBe(50);
  });
});

describe('overlay projection', () => {
  it('projects world overlays with the frame camera and clips them to the view', () => {
    const camera = { center: { x: 1e12, y: -1e12 }, rotation: .7, scale: 2 };
    const line = [{ x: 1e12 + 3, y: -1e12 + 4 }, { x: 1e12 - 5, y: -1e12 + 1 }];
    const [projected] = screenOverlays([{ kind: 'line', space: 'world', points: line, color: '#ffffff' }], camera, 800, 600);
    expect(projected).toMatchObject({ kind: 'line', width: 1.5 });
    const points = pointsOf(projected);
    for (let i = 0; i < 2; i++) {
      expect(points[i]!.x).toBeCloseTo(project(line[i]!, camera, 800, 600).x, 6);
      expect(points[i]!.y).toBeCloseTo(project(line[i]!, camera, 800, 600).y, 6);
    }
    // A segment far outside is dropped; one crossing the view is cut to the margin box.
    const far = screenOverlays([{ kind: 'line', space: 'screen', points: [{ x: -9e5, y: -9e5 }, { x: -8e5, y: 9e5 }], color: '#ffffff' }], camera, 800, 600);
    expect(far).toEqual([]);
    const [cut] = screenOverlays([{ kind: 'line', space: 'screen', points: [{ x: -1e5, y: 300 }, { x: 1e5, y: 300 }], color: '#ffffff' }], camera, 800, 600);
    const ends = pointsOf(cut);
    expect(ends).toHaveLength(2);
    for (const [end, x] of [[ends[0]!, -64], [ends[1]!, 864]] as const) { expect(end.x).toBeCloseTo(x, 6); expect(end.y).toBe(300); }
    // A planet-sized ring becomes its visible arc; a filled one covering the view becomes the view.
    const huge = { kind: 'circle', space: 'world', center: { x: camera.center.x, y: camera.center.y - 1e9 }, color: '#ffffff' } as const;
    const arcs = screenOverlays([{ ...huge, radius: 1e9 + 50 }], { ...camera, rotation: 0 }, 800, 600);
    expect(arcs.every(a => a.kind === 'line' && a.points.every(p => Math.abs(p.y - 200) < .01 && p.x >= -64 && p.x <= 864))).toBe(true);
    const [cover] = screenOverlays([{ ...huge, radius: 2e9, fill: true }], { ...camera, rotation: 0 }, 800, 600);
    expect(cover).toEqual({ kind: 'polygon', color: '#ffffff', points: [{ x: -64, y: -64 }, { x: 864, y: -64 }, { x: 864, y: 664 }, { x: -64, y: 664 }] });
    expect(screenOverlays([{ ...huge, radius: 1e9 + 1e6 }], camera, 800, 600)).toEqual([]);
    expect(screenOverlays([{ kind: 'text', space: 'screen', at: { x: 5000, y: 0 }, text: 'gone', color: '#ffffff' }], camera, 800, 600)).toEqual([]);
  });
});
