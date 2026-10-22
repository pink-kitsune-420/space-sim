import { describe, expect, it } from 'vitest';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame, loadInstalledWorld } from '../../packages/modules/src/index';
import { createSimulationContext } from '../../packages/sim-core/src/context';
import { createSurfaceProfile, querySurface, generateSurface } from '../../packages/sim-core/src/surface';
import { sweepSurface } from '../../packages/sim-core/src/surface-contact';
import { surfaceSupport } from '../../packages/sim-core/src/surface-flight';
import { discGroundClearance } from '../../packages/sim-core/src/surface-disc';
import { saveWorld } from '../../packages/sim-core/src/save';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { initialState } from '../../packages/sim-core/src/context';
import { CameraController } from '../../modules/camera-follow/src/flight';
import { surveyLanderAppearance, trainerAppearance } from '../../modules/appearance-trainer/src/index';
import { vehicleArtworkScale, captureVehicleDefinition } from '../../packages/game-api/src/index';
import type { State } from '../../packages/game-api/src/index';

const successor = requestedBuiltinGame('?game=space-sim-successor');
const prepare = (scale: number) => prepareGame({ environment: 'node', data: successor.bundle.modules,
  profile: successor.bundle.profile, universeKey: successor.bundle.selection.universe,
  systemId: scale === 4 ? 'primus-system' : `primus-system-${scale}x` });
const polar = (r: number, a: number) => ({ x: r * Math.cos(a), y: r * Math.sin(a) });

describe('successor scale trial and human-scale ship', () => {
  it.each([2, 4, 8])('scales celestial lengths and derived periods coherently at %i× without scaling people/terrain/mu', scale => {
    const { world, candidate } = prepare(scale);
    try {
      const classic = DEFAULT_UNIVERSE.systems[0]!;
      for (const original of classic.bodies) {
        const b = world.body(original.id);
        expect(b.radius).toBe((original.radius ?? original.radiusMetres!) * scale);
        expect(b.mu).toBe(original.mu); expect(b.mass).toBe(original.mass);
        if (original.soi) { expect(b.soi.entryMetres).toBe(original.soi.entryMetres! * scale); expect(b.soi.exitMetres).toBe(original.soi.exitMetres! * scale); }
        if (original.ephemeris?.kind === 'circular-kepler') {
          expect(b.ephemeris.kind).toBe('circular-kepler');
          if (b.ephemeris.kind === 'circular-kepler') expect(b.ephemeris.radiusMetres ?? b.ephemeris.radius).toBe((original.ephemeris.radiusMetres ?? original.ephemeris.radius!) * scale);
          const a = Math.hypot(...Object.values(world.system.getBodyPosition(b.id, 0)).map((v, i) => v - Object.values(world.system.getBodyPosition(b.parentId!, 0))[i]!));
          const relativeSpeed = Math.hypot(...Object.values(world.system.getBodyVelocity(b.id, 0)).map((v, i) => v - Object.values(world.system.getBodyVelocity(b.parentId!, 0))[i]!));
          expect(relativeSpeed).toBeCloseTo(Math.sqrt(world.body(b.parentId!).mu / a), 7);
        }
        if (original.rotation) expect(b.rotation!.period).toBeCloseTo(original.rotation.period * scale ** 1.5, 8);
      }
      expect(world.context.vehicle).toEqual({ acceleration: 24, turnRate: .65, initialThrottle: .65, contactRadiusMetres: 2.5 });
      for (const bodyId of ['planet', 'moon']) {
        const b = world.body(bodyId), profile = world.surface(bodyId)!;
        expect(b.surface!.maxReliefMetres).toBe(12);
        const launch = profile.pads.find(p => p.id === 'landing-area')!;
        for (const [id, metres] of [['ridge-lookout', 140], ['basin-station', 220]] as const) {
          const dest = profile.pads.find(p => p.id === id)!;
          expect(Math.abs(dest.angleRadians - launch.angleRadians) * b.radius).toBeCloseTo(metres, 9);
          // Independent route measurement over authoritative terrain, at one metre spacing.
          let length = 0, previous = polar(querySurface(profile, launch.angleRadians).groundRadius, launch.angleRadians);
          for (let i = 1; i <= metres; i++) {
            const angle = launch.angleRadians + (dest.angleRadians - launch.angleRadians) * i / metres;
            const point = polar(querySurface(profile, angle).groundRadius, angle);
            length += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point;
          }
          expect(length / 1.4).toBeGreaterThan(60); expect(length / 1.4).toBeLessThan(180);
        }
      }
    } finally { candidate.dispose(); }
  });

  it.each([2, 4, 8])('rests, takes off, lands and saves its actual hull centre at %i× on both worlds', scale => {
    const { world, candidate } = prepare(scale);
    try {
      for (const [preset, bodyId] of [['pad', 'planet'], ['parvus-pad', 'moon']]) {
        const ship = world.spawn({ ownerId: 'pilot', presetId: preset });
        const body = world.body(bodyId!), profile = world.surface(bodyId!)!;
        expect(Math.hypot(ship.state.position.x, ship.state.position.y)).toBeCloseTo(body.radius + 2.5, 6);
        for (let i = 0; i < 100; i++) world.step();
        expect(world.ship(ship.id)!.state.position).toEqual(ship.state.position);
        world.setControls(ship.id, { ...IDLE, engine: true });
        for (let i = 0; i < 100; i++) world.step();
        expect(world.ship(ship.id)!.state.status).toBe('flying');
        world.setControls(ship.id, IDLE);
        // A low descent, tuned to a 2 m/s terminal approach for contact-only qualification.
        let state: State = { ...ship.state, status: 'flying', position: { x: 0, y: body.radius + 2.51 }, velocity: { x: 0, y: -2 } };
        const prediction = world.context.cloneForPrediction();
        try {
          for (let i = 0; i < 4 && state.status === 'flying'; i++) state = prediction.step(state, IDLE, STEP, body, profile);
          expect(state.status).toBe('landed');
          expect(discGroundClearance(profile, state.position, 2.5).clearance).toBeLessThanOrEqual(1e-7);
          world.context.validateState(state, body, profile);
          world.put({ ...ship, state });
        } finally { prediction.dispose(); }
      }
      const saved = saveWorld(world), restored = loadInstalledWorld(saved, { environment: 'node', data: successor.bundle.modules });
      try { expect(saveWorld(restored.world)).toEqual(saved); restored.world.step(); expect(restored.world.ships().every(s => !s.fault)).toBe(true); }
      finally { restored.world.dispose(); }
    } finally { candidate.dispose(); }
  });

  it.each([2, 4, 8])('reaches an assisted engine-off orbit below 180 simulation seconds at %i×', scale => {
    const { world, candidate } = prepare(scale);
    try {
      const ship = world.spawn({ ownerId: 'pilot', presetId: 'pad' }), body = world.body('planet');
      world.setThrottle(ship.id, scale === 2 ? 1 : (body.mu / body.radius ** 2 + 4) / 24);
      let pitch = false, reached = false;
      for (let tick = 0; tick < 18000; tick++) {
        const current = world.ship(ship.id)!;
        const altitude = Math.hypot(current.state.position.x, current.state.position.y) - body.radius;
        if (altitude >= 80) pitch = true;
        const radial = Math.atan2(current.state.position.y, current.state.position.x);
        const target = radial - (pitch ? Math.PI / 2 : 0);
        const error = Math.atan2(Math.sin(target - current.state.heading), Math.cos(target - current.state.heading));
        const radialSpeed = (current.state.position.x * current.state.velocity.x + current.state.position.y * current.state.velocity.y) / (body.radius + altitude);
        const circularize = pitch && radialSpeed <= 0 && Math.abs(error) < .05;
        if (circularize) world.setThrottle(ship.id, 1);
        world.setControls(ship.id, { turn: Math.max(-1, Math.min(1, error / (.65 * STEP))), throttle: 0, engine: scale === 2 || !pitch || circularize });
        world.step();
        const state = world.ship(ship.id)!.state;
        expect(world.ship(ship.id)!.fault).toBeUndefined();
        if (state.status === 'crashed') break;
        if (state.status !== 'flying') continue;
        const orbit = world.context.services.orbits.elements(state, body.mu);
        if (orbit.periapsis > body.radius + 30 && orbit.apoapsis !== null && orbit.apoapsis < body.soi.entryMetres) {
          world.setControls(ship.id, IDLE);
          console.info(JSON.stringify({ scale, assistedOrbitSeconds: state.time, periapsisAltitude: orbit.periapsis - body.radius, apoapsisAltitude: orbit.apoapsis - body.radius }));
          const energy = orbit.energy;
          world.advanceTo(world.tick + 1000);
          const coast = world.ship(ship.id)!;
          expect(coast.state.status).toBe('flying'); expect(coast.fault).toBeUndefined();
          expect(coast.state.dynamics).toBe('kepler');
          expect(world.context.services.orbits.elements(coast.state, body.mu).energy).toBeCloseTo(energy, 8);
          reached = true; break;
        }
      }
      expect(reached).toBe(true);
    } finally { candidate.dispose(); }
  });

  it('uses physical artwork and correctly frames the whole planet with successor camera tuning', () => {
    expect(surveyLanderAppearance.metresPerUnit).toBe(1);
    for (const p of surveyLanderAppearance.hull) expect(Math.hypot(p.x, p.y)).toBeCloseTo(2.5, 12);
    expect(vehicleArtworkScale(surveyLanderAppearance, 10)).toBe(10);
    expect(vehicleArtworkScale(surveyLanderAppearance, .1)).toBe(0);
    expect(vehicleArtworkScale(trainerAppearance, 10)).toBe(1);
    const camera = new CameraController({ referenceMetres: 750, initialZoom: 30 });
    expect(camera.scale(800, 600) * 1.8).toBeCloseTo(43.2);
    for (const radius of [1024, 2048, 4096]) { camera.planetView(radius); expect(2 * radius * camera.scale(800, 600)).toBeCloseTo(420); }
    camera.changeZoom(1e9); expect(camera.scale(800, 600)).toBe(40); camera.dispose();
  });
});

describe('finite circular contact against authoritative polar terrain', () => {
  it('hits the outside of a smooth body during a fast whole-body crossing with clear endpoints', () => {
    const profile = createSurfaceProfile(10, [0, 0, 0, 0]);
    const hit = sweepSurface(profile, { x: -20, y: 0 }, { x: 20, y: 0 }, { radiusMetres: 2.5 });
    expect(hit.status).toBe('hit');
    if (hit.status === 'hit') { expect(hit.position.x).toBeCloseTo(-12.5, 6); expect(hit.fraction).toBeCloseTo(.1875, 7); }
    expect(sweepSurface(profile, { x: 12.5, y: 0 }, { x: 12.6, y: 0 }, { radiusMetres: 2.5 }).status).toBe('clear');
    expect(sweepSurface(profile, { x: 12, y: 0 }, { x: 12.1, y: 0 }, { radiusMetres: 2.5 }).status).toBe('failed');
    expect(sweepSurface(profile, { x: -20, y: 0 }, { x: 20, y: 0 }, { radiusMetres: 2.5, maxWork: 1 }).status).toBe('failed');
  });

  it('supports a finite hull on slopes/corners without using radial padding as a collision approximation', () => {
    const elevations = Array<number>(128).fill(0); elevations[0] = 4;
    const profile = createSurfaceProfile(100, elevations);
    for (const angle of [0, .012, -.012, Math.PI / 2]) {
      const support = surfaceSupport(profile, angle, 2.5), center = polar(support.centerRadiusMetres!, angle);
      // Dense independent polar samples must lie outside the whole circular hull.
      let nearest = Infinity;
      for (let i = -3000; i <= 3000; i++) {
        const a = angle + i * 1e-5, q = polar(querySurface(profile, a).groundRadius, a);
        nearest = Math.min(nearest, Math.hypot(center.x - q.x, center.y - q.y));
      }
      expect(nearest).toBeGreaterThanOrEqual(2.5 - 1e-7); expect(nearest).toBeLessThan(2.50001);
      expect(sweepSurface(profile, center, center, { radiusMetres: 2.5 }).status).toBe('hit');
    }
  });

  it('keeps stable support on rotating terrain, rejects malformed hulls and supports submerged rock', () => {
    const profile = createSurfaceProfile(100, [0, 0, 0, 0]);
    const context = createSimulationContext({ contactRadiusMetres: 2.5, acceleration: 2 });
    const body = { id: 'test', radius: 100, mu: 100, rotation: { period: 1000, direction: -1 as const, phase: 0 } };
    let state = { ...initialState(), position: { x: 0, y: 102.5 }, heading: Math.PI / 2 };
    for (let i = 0; i < 100; i++) state = context.step(state, IDLE, STEP, body, profile);
    expect(state.position).toEqual({ x: 0, y: 102.5 }); expect(state.status).toBe('landed');
    const flying = context.step(state, { ...IDLE, engine: true }, STEP, body, profile);
    expect(flying.status).toBe('flying'); expect(flying.velocity.x).not.toBe(0);
    context.dispose();
    for (const radius of [NaN, -1, 33]) expect(() => createSimulationContext({ contactRadiusMetres: radius })).toThrow();
    expect(() => captureVehicleDefinition({ id: 'test.ship/lander', name: 'lander', handling: { acceleration: 24, turnRate: .65, initialThrottle: .65, contactRadiusMetres: 33 } })).toThrow();
    const ocean = generateSurface({ radius: 100, surface: { kind: 'radial', generatorVersion: 1, sampleCount: 128, seed: 1, maxReliefMetres: 2, minFeatureWidthMetres: 24, mountainRangeCount: 0, craterCount: 0, orientationRadians: 0, seaRadiusMetres: 101 } });
    const wetSupport = surfaceSupport(ocean, 0, 2.5);
    expect(wetSupport.centerRadiusMetres).toBeGreaterThan(wetSupport.surface.groundRadius);
  });
});
