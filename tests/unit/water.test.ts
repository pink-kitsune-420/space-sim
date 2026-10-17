import { describe, expect, it } from 'vitest';
import {
  advance, coastAt, createSurfaceProfile, generateSurface, ghost, IDLE, initialState, loadSystem,
  magnitude, querySurface, setGodMode, STEP, surfaceIdentity, sweepGroundSurface, sweepSurface,
  step,
  validateSurfaceDefinition, validateUniverse, waterFloatRadius, waterForces,
  type Body, type State, type SurfaceDefinition,
} from '../../packages/sim-core/src/index';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json';

const body: Body = { id: 'ocean', radius: 10, mu: 100 };
const profile = createSurfaceProfile(10, [-2, -2, -2, -2], 0, 10);
const start = (r: number, speed = 0, heading = 0): State => ({ ...initialState(), status: 'flying',
  position: { x: r, y: 0 }, velocity: { x: speed, y: 0 }, heading });
const run = (s: State, controls = IDLE) => advance(s, controls, STEP, body, profile);
const definition: SurfaceDefinition = { kind: 'radial', generatorVersion: 1, seed: 42, sampleCount: 64,
  maxReliefMetres: 2, minFeatureWidthMetres: 4, orientationRadians: 0, mountainRangeCount: 2, craterCount: 1 };

describe('ocean configuration and analytic shorelines', () => {
  it('adds sea identity without changing generated ground or dry identities', () => {
    const dry = generateSurface({ ...body, surface: definition });
    const wet = generateSurface({ ...body, surface: { ...definition, seaRadiusMetres: 10 } });
    expect(wet.copyElevations()).toEqual(dry.copyElevations());
    expect(wet.identity).not.toBe(dry.identity);
    expect(surfaceIdentity({ ...body, surface: { ...definition, seaRadiusMetres: 10.1 } })).not.toBe(wet.identity);
    expect(validateSurfaceDefinition({ ...definition, seaRadiusMetres: 10 }, 10).seaRadiusMetres).toBe(10);
  });

  it.each([NaN, Infinity, -Infinity, 0, -1, 12.1, null, '10'])('rejects invalid sea level %s', seaRadiusMetres => {
    expect(() => validateSurfaceDefinition({ ...definition, seaRadiusMetres }, 10)).toThrow('seaRadiusMetres');
  });

  it('keeps pads strictly dry', () => {
    const settings = { ...definition, seaRadiusMetres: 10, pads: [{ id: 'pad', angleRadians: 0, widthMetres: 4, elevationMetres: 0 }] };
    expect(() => validateSurfaceDefinition(settings, 10)).toThrow('above sea level');
    expect(validateSurfaceDefinition({ ...settings, pads: [{ ...settings.pads[0]!, elevationMetres: 1 }] }, 10).pads).toHaveLength(1);
  });

  it('queries independent land/water crossings and retains ground normals', () => {
    const mixed = createSurfaceProfile(10, [-2, 2, -2, 2], 0, 10);
    expect(mixed.coastAngles).toEqual([Math.PI / 4, 3 * Math.PI / 4, 5 * Math.PI / 4, 7 * Math.PI / 4]);
    expect(querySurface(mixed, 0)).toMatchObject({ groundRadius: 8, firstContactRadius: 10, waterDepth: 2,
      material: 'water', normal: { x: 1, y: 0 } });
    expect(querySurface(mixed, Math.PI / 2)).toMatchObject({ groundRadius: 12, firstContactRadius: 12, material: 'rock' });
    expect(querySurface(mixed, Math.PI / 4).material).toBe('rock'); // equality belongs to land
    expect(querySurface(mixed, 0).groundNormal).not.toEqual(querySurface(mixed, 0).normal);
    expect(mixed.bounds.minRadius).toBe(10);
    expect(mixed.bounds.maxRadius).toBe(12);
    expect(mixed.intervalBounds(0).minRadius).toBe(8); // seabed bounds remain available
  });

  it('finds water fly-throughs, tangencies, seam shores and earlier land hits', () => {
    for (const sign of [-1, 1]) {
      const hit = sweepSurface(profile, { x: -20 * sign, y: 0 }, { x: 20 * sign, y: 0 });
      expect(hit).toMatchObject({ status: 'hit', fraction: .25, surface: { material: 'water', firstContactRadius: 10 } });
    }
    const tangent = sweepSurface(profile, { x: -20, y: 10 }, { x: 20, y: 10 });
    expect(tangent).toMatchObject({ status: 'hit', fraction: .5, kind: 'touching' });
    const land = createSurfaceProfile(10, [2, -2, -2, -2], 0, 10);
    expect(sweepSurface(land, { x: 20, y: 0 }, { x: 0, y: 0 })).toMatchObject({ status: 'hit', fraction: .4, surface: { material: 'rock' } });
    const shore = createSurfaceProfile(10, [0, 2, -2, -2], 0, 10);
    expect(sweepSurface(shore, { x: 20, y: 0 }, { x: 0, y: 0 })).toMatchObject({ status: 'hit', fraction: .5 });
    const seabed = sweepGroundSurface(profile, { x: 9, y: 0 }, { x: 7, y: 0 });
    expect(seabed.status).toBe('hit');
    if (seabed.status === 'hit') expect(seabed.fraction).toBeCloseTo(.5, 12);
    expect(sweepSurface(profile, { x: 20, y: 0 }, { x: -20, y: 0 }, { maxWork: 1 }).status).toBe('failed');
  });
});

describe('water entry, buoyancy, floating and diving', () => {
  it('converges at second order against independent radial RK4 fluid motion', () => {
    // The whole interval remains in partial immersion. This independent ODE
    // uses the documented 0.1 m draft, rather than the production force helper.
    const force = (r: number, v: number) => -100 / (r * r) * (1 - 20 * (10 - r)) - 160 * (10 - r) * v;
    let r = 9.97, v = -.1;
    const h = .00001;
    for (let i = 0; i < 20000; i++) {
      const a = force(r, v), b = force(r + v * h / 2, v + a * h / 2);
      const c = force(r + (v + a * h / 2) * h / 2, v + b * h / 2);
      const d = force(r + (v + b * h / 2) * h, v + c * h);
      r += h / 6 * (v + 2 * (v + a * h / 2) + 2 * (v + b * h / 2) + v + c * h);
      v += h / 6 * (a + 2 * b + 2 * c + d);
    }
    const errors: number[] = [];
    for (const dt of [.01, .005, .0025]) {
      let state = start(9.97, -.1);
      for (let i = 0; i < Math.round(.2 / dt); i++) state = step(state, IDLE, dt, body, profile);
      errors.push(Math.hypot(state.position.x - r, state.velocity.x - v));
    }
    expect(errors[0]).toBeLessThan(1e-4);
    expect(errors[0]! / errors[1]!).toBeGreaterThan(3.8);
    expect(errors[1]! / errors[2]!).toBeGreaterThan(3.8);
  });

  it('survives a gentle entry, sinks below sea level, then floats at equilibrium', () => {
    let state = start(10.001, -1), deepest = 10;
    let entries = 0;
    for (let i = 0; i < 4000 && state.water !== 'floating'; i++) {
      state = run(state);
      if (state.waterEntry) entries++;
      deepest = Math.min(deepest, magnitude(state.position));
      expect(state.status).not.toBe('crashed');
    }
    expect(entries).toBe(1);
    expect(deepest).toBeLessThan(waterFloatRadius(profile, 0));
    expect(state).toMatchObject({ status: 'landed', water: 'floating', velocity: { x: 0, y: 0 } });
    expect(magnitude(state.position)).toBe(waterFloatRadius(profile, 0));
    for (let i = 0; i < 100; i++) expect(run(state).position).toEqual(state.position);
    const dive = run({ ...state, heading: Math.PI, throttle: 1 }, { ...IDLE, engine: true });
    expect(dive.water).toBe('submerged');
    expect(dive.status).toBe('flying');
    expect(magnitude(dive.position)).toBeLessThan(magnitude(state.position));
    const launch = run({ ...state, heading: 0, throttle: 1 }, { ...IDLE, engine: true });
    expect(magnitude(launch.position)).toBeGreaterThan(magnitude(state.position));
  });

  it('crashes only heavy inward water hits, with a distinct event; God mode survives', () => {
    const hit = run(start(10.001, -6));
    expect(hit).toMatchObject({ status: 'crashed', water: 'floating', contact: { material: 'water' } });
    expect(magnitude(hit.position)).toBe(10);
    expect(run(hit).position).toEqual(hit.position);
    expect(run(setGodMode(hit, true)).status).toBe('flying');
    expect(run({ ...start(10.001, -6), godMode: true }).status).not.toBe('crashed');
    // A high tangential speed with a gentle inward component is a skim, not a heavy splash.
    const skim = run({ ...start(10.001, -1), velocity: { x: -1, y: 20 } });
    expect(skim.status).toBe('flying');
  });

  it('permits submerged states, applies bounded buoyancy and drag, and collides with seabed', () => {
    expect(waterForces(profile, { x: 10, y: 0 })).toEqual({ gravityFactor: 1, drag: 0 });
    expect(waterForces(profile, { x: 9.95, y: 0 }).gravityFactor).toBeCloseTo(0, 12);
    expect(waterForces(profile, { x: 9, y: 0 })).toEqual({ gravityFactor: -1, drag: 16 });
    expect(run(start(9)).velocity.x).toBeGreaterThan(0);
    expect(() => run(start(7.9))).toThrow('inside ground');
    const seabed = run(start(8.001, -10));
    expect(seabed.status).toBe('crashed');
    expect(seabed.contact?.material).toBe('rock');
    expect(magnitude(seabed.position)).toBeCloseTo(8, 7);
    expect(() => run({ ...start(11), water: 'submerged' })).toThrow('Invalid water state');
    expect(() => run({ ...start(9), water: 'floating' })).toThrow('Invalid water state');
  });

  it('keeps shallow shoreline basins above seabed without repeated solid contact at rest', () => {
    const shallow = createSurfaceProfile(10, [-.0001, -.0001], 0, 10);
    for (const mu of [100, 1000, 5000]) {
      let state = start(10.00001, -.01), contacts = 0;
      for (let i = 0; i < 3000; i++) {
        state = advance(state, IDLE, STEP, { ...body, mu }, shallow);
        expect(magnitude(state.position)).toBeGreaterThanOrEqual(9.9999 - 1e-7);
        expect(state.status).not.toBe('crashed');
        if (state.contact) contacts++;
      }
      expect(state.water).toBe('floating');
      expect(contacts).toBeLessThan(3);
    }
  });

  it('agrees with prediction through entry and floating, and at heavy contact', () => {
    for (const speed of [-1, -6]) {
      let live = start(10.001, speed), count = 0, end = '';
      const job = ghost(live, false, body, profile);
      expect(job.next().value).toMatchObject({ position: live.position });
      for (let i = 0; i < 8192; i++) {
        live = run(live);
        if (live.waterEntry) expect(job.next().value).toEqual(live.waterEntry);
        const sample = job.next();
        expect(sample.value).toMatchObject({ position: live.position, time: live.contact?.time ?? live.time });
        count++;
        if (live.status !== 'flying') { end = job.next().value as string; break; }
      }
      expect(count).toBeGreaterThan(0);
      expect(end).toBe(speed === -6 ? 'impact' : 'floating');
    }
  });

  it('includes sea level in coast eligibility and identity invalidation', () => {
    const orbit = start(11); const v = Math.sqrt(body.mu / 11);
    const dry = createSurfaceProfile(10, [-2, -2]);
    const coast = advance({ ...orbit, velocity: { x: 0, y: v } }, IDLE, STEP, body, dry);
    expect(coast.dynamics).toBe('kepler');
    expect(coastAt(coast.coast!, 1, body, profile).ok).toBe(false);
    const under = run({ ...start(9), velocity: { x: 0, y: Math.sqrt(body.mu / 9) } });
    expect(under.dynamics).toBe('numerical');
    expect(under.coast).toBeUndefined();
  });

  it('round-trips oceans, rejects wet landed presets, and accepts underwater starts', () => {
    const raw = { schemaVersion: 1, id: 'wet', name: 'Wet', defaultSystemId: 'wet', systems: [{
      id: 'wet', name: 'Wet', bodies: [{ ...body, name: 'Ocean', surface: { ...definition, seaRadiusMetres: 12 } }],
      presets: [{ id: 'wet', name: 'Wet', bodyId: body.id, kind: 'landed' }],
    }] };
    const universe = validateUniverse(raw);
    expect(validateUniverse(JSON.parse(JSON.stringify(universe)))).toEqual(universe);
    const system = loadSystem(universe), surface = generateSurface(system.rootBody);
    expect(() => system.initialState('wet', surface)).toThrow('dry ground');
    const underwater = loadSystem(validateUniverse({ ...raw, systems: [{ ...raw.systems[0], presets: [
      { id: 'wet', name: 'Wet', bodyId: body.id, kind: 'state', position: [11, 0], velocity: [0, 0] },
    ] }] }));
    expect(underwater.initialState('wet', surface).state.position.x).toBe(11);
  });

  it('ships a playable island launch, ocean survey, gentle splash, heavy splash and underwater example', () => {
    const system = loadSystem(validateUniverse(ocean)), target = system.rootBody, surface = generateSurface(target);
    for (const p of system.presets) expect(() => system.initialState(p.id, surface)).not.toThrow();
    expect(system.initialState('pad', surface).state.position.y).toBe(520);
    let gentle = system.initialState('splash', surface).state;
    for (let i = 0; i < 3 && !gentle.water; i++) gentle = advance(gentle, IDLE, STEP, target, surface);
    expect(gentle.water).toBe('submerged');
    expect(gentle.status).toBe('flying');
    const heavy = advance(system.initialState('heavy', surface).state, IDLE, STEP, target, surface);
    expect(heavy.contact?.material).toBe('water');
    expect(heavy.status).toBe('crashed');
    let ascent = system.initialState('submerged', surface).state;
    for (let i = 0; i < 10000 && ascent.water !== 'floating'; i++) {
      ascent = advance(ascent, IDLE, STEP, target, surface);
      expect(ascent.status).not.toBe('crashed');
    }
    expect(ascent.water).toBe('floating');
  });
});
