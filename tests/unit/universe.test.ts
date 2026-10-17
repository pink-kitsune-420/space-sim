import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIVERSE,
  GRAVITATIONAL_CONSTANT,
  calculateLaplaceSOI,
  loadSystem,
  validateUniverse,
  type SystemDefinition,
  type UniverseDefinition,
} from '../../packages/sim-core/src/index';
import { FULL_SOLAR_UNIVERSE, SOLAR_UNIVERSE } from '../../packages/scenarios/builtin';

describe('universe format, validation and system loader', () => {
  it('loads and validates the default universe with primus and outer-reach systems', () => {
    expect(DEFAULT_UNIVERSE.schemaVersion).toBe(1);
    expect(DEFAULT_UNIVERSE.id).toBe('default-universe');
    expect(DEFAULT_UNIVERSE.defaultSystemId).toBe('primus-system');
    expect(DEFAULT_UNIVERSE.systems.length).toBeGreaterThanOrEqual(2);

    const primus = DEFAULT_UNIVERSE.systems.find(s => s.id === 'primus-system');
    expect(primus).toBeDefined();
    expect(primus!.bodies.map(b => b.id)).toEqual(['star', 'ignis', 'velum', 'planet', 'moon', 'magnus', 'nix', 'umbra']);
    expect(primus!.presets.map(p => p.id)).toEqual(['pad', 'planet-orbit', 'moon-orbit', 'velum-pad', 'magnus-orbit', 'umbra-pad']);
  });

  it('loads only one system at a time into LoadedSystem', () => {
    const loadedPrimus = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
    expect(loadedPrimus.system.id).toBe('primus-system');
    expect(loadedPrimus.rootBody.id).toBe('star');
    expect(loadedPrimus.getAllBodies().map(b => b.id)).toEqual(['star', 'ignis', 'velum', 'planet', 'moon', 'magnus', 'nix', 'umbra']);

    const loadedOuter = loadSystem(DEFAULT_UNIVERSE, 'outer-reach-system');
    expect(loadedOuter.system.id).toBe('outer-reach-system');
    expect(loadedOuter.rootBody.id).toBe('kronos');
    expect(loadedOuter.getAllBodies().map(b => b.id)).toEqual(['kronos', 'titan-alpha', 'titan-beta']);
  });

  it('correctly models planets having moons in parentId hierarchy', () => {
    const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
    const planet = loaded.getResolvedBody('planet');
    const moon = loaded.getResolvedBody('moon');

    expect(loaded.getResolvedBody('star').parentId).toBeNull();
    expect(planet.parentId).toBe('star');
    expect(moon.parentId).toBe('planet');
    expect(loaded.getMoonsOf('star').map(b => b.id)).toEqual(['ignis', 'velum', 'planet', 'magnus']);

    const moons = loaded.getMoonsOf('planet');
    expect(moons).toHaveLength(1);
    expect(moons[0]!.id).toBe('moon');
    expect(moons[0]!.name).toBe('Parvus');
    expect(loaded.getMoonsOf('moon')).toHaveLength(0);
  });

  it('computes analytic ephemeris position and velocity for orbiting moons at any epoch', () => {
    const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
    const moon = loaded.getResolvedBody('moon');
    const a = moon.ephemeris.kind === 'circular-kepler' ? moon.ephemeris.radius! : 15360;
    // Primus orbits its star, so measure Parvus from Primus.
    const relative = (get: typeof loaded.getBodyPosition, t: number) => {
      const m = get('moon', t), p = get('planet', t);
      return { x: m.x - p.x, y: m.y - p.y };
    };

    // At t=0
    const p0 = relative(loaded.getBodyPosition, 0);
    const v0 = relative(loaded.getBodyVelocity, 0);
    expect(p0.x).toBeCloseTo(a, 6);
    expect(p0.y).toBeCloseTo(0, 6);
    expect(v0.x).toBeCloseTo(0, 6);
    // direction is -1 (clockwise/retrograde in math coords), so vy = dir * omega * a < 0
    expect(v0.y).toBeLessThan(0);

    // Period T = 2 * pi * sqrt(a^3 / mu_planet)
    const T = 2 * Math.PI * Math.sqrt((a * a * a) / 13107200);
    const pQuarter = relative(loaded.getBodyPosition, T / 4);
    expect(pQuarter.x).toBeCloseTo(0, 4);
    expect(pQuarter.y).toBeCloseTo(-a, 4);

    const pHalf = relative(loaded.getBodyPosition, T / 2);
    expect(pHalf.x).toBeCloseTo(-a, 4);
    expect(pHalf.y).toBeCloseTo(0, 4);

    const pFull = relative(loaded.getBodyPosition, T);
    expect(pFull.x).toBeCloseTo(a, 4);
    expect(pFull.y).toBeCloseTo(0, 4);
  });

  it('derives mass from mu and mu from mass with standard gravitational constant G', () => {
    const custom: UniverseDefinition = {
      schemaVersion: 1,
      id: 'custom-u',
      name: 'Custom Universe',
      defaultSystemId: 'sys1',
      systems: [
        {
          id: 'sys1',
          name: 'Sys 1',
          bodies: [
            { id: 'b1', name: 'Star', radius: 1000, mass: 1e20 },
            { id: 'b2', name: 'Planet', parentId: 'b1', radius: 100, mu: 500000 },
          ],
          presets: [{ id: 'orbit', name: 'Orbit', bodyId: 'b1', kind: 'circular-orbit', radius: 1500 }],
        },
      ],
    };
    const validated = validateUniverse(custom);
    const b1 = validated.systems[0]!.bodies[0]!;
    const b2 = validated.systems[0]!.bodies[1]!;

    expect(b1.mu).toBeCloseTo(1e20 * GRAVITATIONAL_CONSTANT);
    expect(b2.mass).toBeCloseTo(500000 / GRAVITATIONAL_CONSTANT);
  });

  it('calculates Laplace SOI when SOI is omitted for a child body', () => {
    const parentMass = 2e17;
    const moonMass = 3e15;
    const semiMajorAxis = 15000;
    const soi = calculateLaplaceSOI(semiMajorAxis, moonMass, parentMass);

    // r_soi = 15000 * (3e15 / 2e17)^(2/5)
    const ratio = moonMass / parentMass;
    const expected = semiMajorAxis * Math.pow(ratio, 0.4);
    expect(soi).toBeCloseTo(expected);
    expect(soi).toBeGreaterThan(1000);
    expect(soi).toBeLessThan(semiMajorAxis);
  });

  it('handles SOI transitions between planet and moon', () => {
    const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
    const moon = loaded.getResolvedBody('moon');
    expect(moon.id).toBe('moon');
    const moonAbs = loaded.getBodyPosition('moon', 0), planetAbs = loaded.getBodyPosition('planet', 0);
    const moonPos = { x: moonAbs.x - planetAbs.x, y: moonAbs.y - planetAbs.y };

    // Ship in planet frame, 100m away from moon center (well inside moon entryMetres: 2910m)
    const shipNearMoon = {
      time: 0,
      position: { x: moonPos.x + 50, y: moonPos.y + 50 },
      velocity: { x: 0, y: 0 },
      heading: 0,
      throttle: 0,
      status: 'flying' as const,
      revision: 0,
    };

    const enterCheck = loaded.checkSOI(shipNearMoon, 'planet', 0);
    expect(enterCheck.switched).toBe(true);
    expect(enterCheck.newBody.id).toBe('moon');
    expect(enterCheck.newState.position.x).toBeCloseTo(50);
    expect(enterCheck.newState.position.y).toBeCloseTo(50);

    // Ship in moon frame, but flying 3500m away from moon (beyond exitMetres: 3000m)
    const shipEscapingMoon = {
      time: 0,
      position: { x: 3500, y: 0 },
      velocity: { x: 10, y: 0 },
      heading: 0,
      throttle: 0,
      status: 'flying' as const,
      revision: 0,
    };

    const exitCheck = loaded.checkSOI(shipEscapingMoon, 'moon', 0);
    expect(exitCheck.switched).toBe(true);
    expect(exitCheck.newBody.id).toBe('planet');
    expect(exitCheck.newState.position.x).toBeCloseTo(moonPos.x + 3500);
  });

  it('initializes landed and orbit presets on planets and moons', () => {
    const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');

    // Pad preset
    const pad = loaded.initialState('pad');
    expect(pad.body.id).toBe('planet');
    expect(pad.state.status).toBe('landed');
    expect(pad.state.position).toEqual({ x: 0, y: 512 });
    expect(pad.state.velocity).toEqual({ x: 0, y: 0 });

    // Planet orbit preset
    const planetOrbit = loaded.initialState('planet-orbit');
    expect(planetOrbit.body.id).toBe('planet');
    expect(planetOrbit.state.status).toBe('flying');
    expect(planetOrbit.state.position.y).toBeCloseTo(640);
    expect(Math.hypot(planetOrbit.state.velocity.x, planetOrbit.state.velocity.y))
      .toBeCloseTo(Math.sqrt(13107200 / 640));

    // Moon orbit preset
    const moonOrbit = loaded.initialState('moon-orbit');
    expect(moonOrbit.body.id).toBe('moon');
    expect(moonOrbit.state.status).toBe('flying');
    expect(moonOrbit.state.position.y).toBeCloseTo(256);
    expect(Math.hypot(moonOrbit.state.velocity.x, moonOrbit.state.velocity.y))
      .toBeCloseTo(Math.sqrt(204800 / 256));
  });

  it('automatically wraps a single system JSON object into a Universe container', () => {
    const singleSystem: SystemDefinition = {
      id: 'standalone-system',
      name: 'Standalone System',
      bodies: [{ id: 'terra', name: 'Terra', radius: 600, mu: 1000000 }],
      presets: [{ id: 'pad', name: 'Pad', bodyId: 'terra', kind: 'landed' }],
    };
    const wrapped = validateUniverse(singleSystem);
    expect(wrapped.schemaVersion).toBe(1);
    expect(wrapped.id).toBe('standalone-system-universe');
    expect(wrapped.defaultSystemId).toBe('standalone-system');
    expect(wrapped.systems).toHaveLength(1);
    expect(wrapped.systems[0]!.bodies[0]!.id).toBe('terra');
  });

  it('rejects malformed universes with clear error messages', () => {
    expect(() => validateUniverse(null)).toThrow('Universe data must be a JSON object');
    expect(() => validateUniverse({ schemaVersion: 2 })).toThrow('Unsupported universe schemaVersion');
    expect(() => validateUniverse({ schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'sys', systems: [] }))
      .toThrow('Universe must contain at least one system');
    expect(() => validateUniverse({
      schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'missing',
      systems: [{ id: 'sys1', name: 'Sys1', bodies: [{ id: 'b1', radius: 100, mu: 100 }], presets: [{ id: 'p', bodyId: 'b1', kind: 'landed' }] }],
    })).toThrow('defaultSystemId "missing" not found');

    // Duplicate body ID
    expect(() => validateUniverse({
      schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'sys1',
      systems: [{ id: 'sys1', name: 'Sys1', bodies: [
        { id: 'b1', radius: 100, mu: 100 },
        { id: 'b1', radius: 200, mu: 200 },
      ], presets: [{ id: 'p', bodyId: 'b1', kind: 'landed' }] }],
    })).toThrow('Duplicate body id');

    // Circular parent hierarchy
    expect(() => validateUniverse({
      schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'sys1',
      systems: [{ id: 'sys1', name: 'Sys1', bodies: [
        { id: 'b1', parentId: 'b2', radius: 100, mu: 100 },
        { id: 'b2', parentId: 'b1', radius: 200, mu: 200 },
      ], presets: [{ id: 'p', bodyId: 'b1', kind: 'landed' }] }],
    })).toThrow('Circular parent hierarchy');

    // Self-parenting
    expect(() => validateUniverse({
      schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'sys1',
      systems: [{ id: 'sys1', name: 'Sys1', bodies: [
        { id: 'b1', parentId: 'b1', radius: 100, mu: 100 },
      ], presets: [{ id: 'p', bodyId: 'b1', kind: 'landed' }] }],
    })).toThrow('cannot be its own parent');

    // Negative radius
    expect(() => validateUniverse({
      schemaVersion: 1, id: 'test', name: 'Test', defaultSystemId: 'sys1',
      systems: [{ id: 'sys1', name: 'Sys1', bodies: [
        { id: 'b1', radius: -50, mu: 100 },
      ], presets: [{ id: 'p', bodyId: 'b1', kind: 'landed' }] }],
    })).toThrow('radius > 0');
  });

  describe('Primus orbiting its star Lumen', () => {
    it('keeps the whole Parvus sphere inside the Primus sphere', () => {
      const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
      const star = loaded.getResolvedBody('star'), planet = loaded.getResolvedBody('planet');
      const moon = loaded.getResolvedBody('moon');
      expect(star.surfaceFeatures).toBe('star');
      expect(planet.soi.radius).toBeCloseTo(calculateLaplaceSOI(819200, planet.mass, star.mass), -1);
      const moonOrbit = moon.ephemeris.kind === 'circular-kepler' ? moon.ephemeris.radius! : 0;
      expect(moonOrbit + moon.soi.exitMetres).toBeLessThan(planet.soi.entryMetres * 0.5);
    });

    it('spaces the planets so their spheres never touch and every preset loads', () => {
      const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
      const planets = loaded.getMoonsOf('star').map(b => ({
        a: b.ephemeris.kind === 'circular-kepler' ? b.ephemeris.radius! : 0, soi: b.soi.exitMetres }));
      for (let i = 1; i < planets.length; i++) {
        expect(planets[i]!.a - planets[i - 1]!.a).toBeGreaterThan(2 * (planets[i]!.soi + planets[i - 1]!.soi));
      }
      for (const preset of loaded.presets) expect(loaded.initialState(preset.id).body.id).toBe(preset.bodyId);
      // Moons of Magnus clear its surface and each other.
      const [nix, umbra] = loaded.getMoonsOf('magnus');
      const orbit = (b: typeof nix) => b!.ephemeris.kind === 'circular-kepler' ? b!.ephemeris.radius! : 0;
      expect(orbit(nix) - nix!.soi.exitMetres).toBeGreaterThan(loaded.getResolvedBody('magnus').radius * 2);
      expect(orbit(umbra) - orbit(nix)).toBeGreaterThan(2 * (nix!.soi.exitMetres + umbra!.soi.exitMetres));
    });

    it('starts with Lumen overhead at the north pad', () => {
      const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
      const star = loaded.getBodyPosition('star', 0), planet = loaded.getBodyPosition('planet', 0);
      const angle = Math.atan2(star.y - planet.y, star.x - planet.x);
      expect(angle).toBeCloseTo(Math.PI / 2, 9);
      expect(Math.hypot(star.x - planet.x, star.y - planet.y)).toBeCloseTo(819200, 3);
    });

    it('hands a ship escaping Primus to the star frame with heliocentric velocity', () => {
      const loaded = loadSystem(DEFAULT_UNIVERSE, 'primus-system');
      const t = 1234;
      const ship = { time: t, position: { x: 52000, y: 0 }, velocity: { x: 20, y: 0 }, heading: 0,
        throttle: 0, status: 'flying' as const, revision: 0 };
      const exit = loaded.checkSOI(ship, 'planet', t);
      expect(exit.switched).toBe(true);
      expect(exit.newBody.id).toBe('star');
      const p = loaded.getBodyPosition('planet', t), v = loaded.getBodyVelocity('planet', t);
      expect(exit.newState.position).toEqual({ x: 52000 + p.x, y: p.y });
      expect(exit.newState.velocity).toEqual({ x: 20 + v.x, y: v.y });
      expect(loaded.checkSOI(exit.newState, 'star', t).newBody.id).toBe('star');
    });
  });

  describe('Sun and 1/10 scale Solar System (Earth, Moon, Sun)', () => {
    it('includes all eight planets at a tenth of their size with real surface gravity', () => {
      const loaded = loadSystem(SOLAR_UNIVERSE, 'solar-system'), full = loadSystem(FULL_SOLAR_UNIVERSE);
      const planets = loaded.getMoonsOf('sun');
      expect(planets.map(b => b.id)).toEqual(['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune']);
      const g = (b: { mu: number; radius: number }) => b.mu / (b.radius * b.radius);
      for (const planet of planets) {
        const real = full.getResolvedBody(planet.id);
        expect(planet.radius / real.radius).toBeCloseTo(0.1, 3);
        expect(g(planet) / g(real)).toBeCloseTo(1, 3);
        expect(planet.appearance.style).toBe(real.appearance.style);
      }
      const orbit = (b: typeof planets[number]) => b.ephemeris.kind === 'circular-kepler' ? b.ephemeris.radius! : 0;
      for (let i = 1; i < planets.length; i++) {
        expect(orbit(planets[i]!) - orbit(planets[i - 1]!)).toBeGreaterThan(planets[i]!.soi.exitMetres + planets[i - 1]!.soi.exitMetres);
      }
      for (const preset of loaded.presets) expect(loaded.initialState(preset.id).body.id).toBe(preset.bodyId);
    });

    it('loads and validates the 1/10 scale solar system with authentic physical properties', () => {
      const loaded = loadSystem(SOLAR_UNIVERSE, 'solar-system');
      expect(loaded.system.id).toBe('solar-system');
      expect(loaded.rootBody.id).toBe('sun');
      expect(loaded.rootBody.surfaceFeatures).toBe('star');

      const sun = loaded.getResolvedBody('sun');
      const earth = loaded.getResolvedBody('earth');
      const moon = loaded.getResolvedBody('moon');

      // 1. Sun (1/10 scale of real Sun: radius 69,570 km = 69,570,000 m)
      expect(sun.parentId).toBeNull();
      expect(sun.radius).toBe(69570000);
      expect(sun.mu).toBeCloseTo(1.3271244e18);
      // Surface gravity g_sun = mu / R^2 ~ 274.2 m/s^2 (real Sun g = 274 m/s^2)
      const gSun = sun.mu / (sun.radius * sun.radius);
      expect(gSun).toBeCloseTo(274.2, 0);

      // 2. Earth (1/10 scale of real Earth: radius 637.1 km = 637,100 m)
      expect(earth.parentId).toBe('sun');
      expect(earth.radius).toBe(637100);
      expect(earth.mu).toBeCloseTo(3.986004418e12);
      // Surface gravity g_earth = mu / R^2 ~ 9.81 m/s^2 (authentic 1g)
      const gEarth = earth.mu / (earth.radius * earth.radius);
      expect(gEarth).toBeCloseTo(9.82, 1);
      // Earth semi-major axis is 1/10 AU (~14.96 million km)
      expect(earth.ephemeris.kind).toBe('circular-kepler');
      if (earth.ephemeris.kind === 'circular-kepler') {
        expect(earth.ephemeris.radius).toBe(14959787070);
        // Orbital speed around Sun v = sqrt(mu_sun / a) ~ 9,418.7 m/s (~9.42 km/s)
        const vEarth = Math.sqrt(sun.mu / earth.ephemeris.radius!);
        expect(vEarth).toBeCloseTo(9418.75, 0);
      }

      // 3. Moon (1/10 scale of real Moon: radius 173.74 km = 173,740 m)
      expect(moon.parentId).toBe('earth');
      expect(moon.radius).toBe(173740);
      expect(moon.mu).toBeCloseTo(4.9048695e10);
      // Surface gravity g_moon = mu / R^2 ~ 1.62 m/s^2 (authentic lunar gravity)
      const gMoon = moon.mu / (moon.radius * moon.radius);
      expect(gMoon).toBeCloseTo(1.62, 1);
      // Moon semi-major axis is 1/10 real Earth-Moon distance (38,440 km)
      expect(moon.ephemeris.kind).toBe('circular-kepler');
      if (moon.ephemeris.kind === 'circular-kepler') {
        expect(moon.ephemeris.radius).toBe(38440000);
        // Orbital speed around Earth v = sqrt(mu_earth / a) ~ 322 m/s
        const vMoon = Math.sqrt(earth.mu / moon.ephemeris.radius!);
        expect(vMoon).toBeCloseTo(322.02, 0);
      }
    });

    it('correctly models 3-tier hierarchy: Sun -> Earth -> Moon', () => {
      const loaded = loadSystem(SOLAR_UNIVERSE, 'solar-system');
      expect(loaded.getMoonsOf('sun').map(b => b.id)).toContain('earth');
      expect(loaded.getMoonsOf('earth').map(b => b.id)).toEqual(['moon']);
      expect(loaded.getMoonsOf('moon')).toHaveLength(0);

      // Recursive position calculation at t = 0
      const sunPos = loaded.getBodyPosition('sun', 0);
      expect(sunPos).toEqual({ x: 0, y: 0 });

      const earthPos = loaded.getBodyPosition('earth', 0);
      // phaseRadiansAtEpoch for Earth is pi/2, so (0, a_earth)
      expect(earthPos.x).toBeCloseTo(0, 0);
      expect(earthPos.y).toBeCloseTo(14959787070, 0);

      const moonPos = loaded.getBodyPosition('moon', 0);
      // phaseRadiansAtEpoch for Moon is 0, so Moon is at (a_moon, 0) relative to Earth
      expect(moonPos.x).toBeCloseTo(earthPos.x + 38440000, 0);
      expect(moonPos.y).toBeCloseTo(earthPos.y, 0);
    });

    it('handles 3-tier patched-conic SOI transitions (Sun <-> Earth <-> Moon)', () => {
      const loaded = loadSystem(SOLAR_UNIVERSE, 'solar-system');
      const earth = loaded.getResolvedBody('earth');
      const moon = loaded.getResolvedBody('moon');
      expect(earth.id).toBe('earth');
      expect(moon.id).toBe('moon');
      const earthPos = loaded.getBodyPosition('earth', 0);
      const moonPos = loaded.getBodyPosition('moon', 0);

      // 1. Ship in Sun frame approaching Earth within Earth's SOI entry radius (89,000 km)
      const shipNearEarth = {
        time: 0,
        position: { x: earthPos.x + 5000000, y: earthPos.y + 5000000 }, // ~7,071 km from Earth
        velocity: { x: 0, y: 0 },
        heading: 0,
        throttle: 0,
        status: 'flying' as const,
        revision: 0,
      };
      const enterEarth = loaded.checkSOI(shipNearEarth, 'sun', 0);
      expect(enterEarth.switched).toBe(true);
      expect(enterEarth.newBody.id).toBe('earth');
      expect(enterEarth.newState.position.x).toBeCloseTo(5000000, 0);
      expect(enterEarth.newState.position.y).toBeCloseTo(5000000, 0);

      // 2. Ship in Earth frame approaching Moon within Moon's SOI entry radius (6,600 km)
      const moonRelToEarthX = moonPos.x - earthPos.x;
      const moonRelToEarthY = moonPos.y - earthPos.y;
      const shipNearMoon = {
        time: 0,
        position: { x: moonRelToEarthX + 200000, y: moonRelToEarthY }, // 200 km from Moon
        velocity: { x: 0, y: 0 },
        heading: 0,
        throttle: 0,
        status: 'flying' as const,
        revision: 0,
      };
      const enterMoon = loaded.checkSOI(shipNearMoon, 'earth', 0);
      expect(enterMoon.switched).toBe(true);
      expect(enterMoon.newBody.id).toBe('moon');
      expect(enterMoon.newState.position.x).toBeCloseTo(200000, 0);
      expect(enterMoon.newState.position.y).toBeCloseTo(0, 0);

      // 3. Ship in Moon frame escaping beyond Moon SOI exit radius (6,800 km)
      const shipEscapingMoon = {
        time: 0,
        position: { x: 7500000, y: 0 },
        velocity: { x: 500, y: 0 },
        heading: 0,
        throttle: 0,
        status: 'flying' as const,
        revision: 0,
      };
      const exitMoon = loaded.checkSOI(shipEscapingMoon, 'moon', 0);
      expect(exitMoon.switched).toBe(true);
      expect(exitMoon.newBody.id).toBe('earth');
      expect(exitMoon.newState.position.x).toBeCloseTo(moonRelToEarthX + 7500000, 0);

      // 4. Ship in Earth frame escaping beyond Earth SOI exit radius (92,000 km)
      const shipEscapingEarth = {
        time: 0,
        position: { x: 95000000, y: 0 },
        velocity: { x: 2000, y: 0 },
        heading: 0,
        throttle: 0,
        status: 'flying' as const,
        revision: 0,
      };
      const exitEarth = loaded.checkSOI(shipEscapingEarth, 'earth', 0);
      expect(exitEarth.switched).toBe(true);
      expect(exitEarth.newBody.id).toBe('sun');
      expect(exitEarth.newState.position.x).toBeCloseTo(earthPos.x + 95000000, 0);
    });

    it('initializes real solar system presets on Earth, Moon, and Sun', () => {
      const loaded = loadSystem(SOLAR_UNIVERSE, 'solar-system');

      // 1. Earth pad
      const earthPad = loaded.initialState('earth-pad');
      expect(earthPad.body.id).toBe('earth');
      expect(earthPad.state.status).toBe('landed');
      expect(earthPad.state.position).toEqual({ x: 0, y: 637100 });
      expect(earthPad.state.velocity).toEqual({ x: 0, y: 0 });

      // 2. Earth low orbit (100 km altitude)
      const earthOrbit = loaded.initialState('earth-orbit');
      expect(earthOrbit.body.id).toBe('earth');
      expect(earthOrbit.state.status).toBe('flying');
      expect(earthOrbit.state.position.y).toBeCloseTo(737100);
      // v = sqrt(3.986e12 / 737100) ~ 2325.4 m/s
      expect(Math.hypot(earthOrbit.state.velocity.x, earthOrbit.state.velocity.y)).toBeCloseTo(2325.4, 0);

      // 3. Moon low orbit (50 km altitude)
      const moonOrbit = loaded.initialState('moon-orbit');
      expect(moonOrbit.body.id).toBe('moon');
      expect(moonOrbit.state.status).toBe('flying');
      expect(moonOrbit.state.position.y).toBeCloseTo(223740);
      // v = sqrt(4.9048e10 / 223740) ~ 468.2 m/s
      expect(Math.hypot(moonOrbit.state.velocity.x, moonOrbit.state.velocity.y)).toBeCloseTo(468.2, 0);

      // 4. Moon pad (Tranquility Base)
      const moonPad = loaded.initialState('moon-pad');
      expect(moonPad.body.id).toBe('moon');
      expect(moonPad.state.status).toBe('landed');
      expect(moonPad.state.position).toEqual({ x: 0, y: 173740 });
      expect(moonPad.state.velocity).toEqual({ x: 0, y: 0 });

      // 5. Sun orbit (0.5 AU)
      const sunOrbit = loaded.initialState('sun-orbit');
      expect(sunOrbit.body.id).toBe('sun');
      expect(sunOrbit.state.status).toBe('flying');
      expect(sunOrbit.state.position.y).toBeCloseTo(7479893535);
      // v = sqrt(1.327e18 / 7479893535) ~ 13319.9 m/s
      expect(Math.hypot(sunOrbit.state.velocity.x, sunOrbit.state.velocity.y)).toBeCloseTo(13319.9, 0);
    });

    it('supports horizonColor and skyColor properties on celestial bodies', () => {
      const custom: UniverseDefinition = {
        schemaVersion: 1,
        id: 'custom-colors',
        name: 'Colors Universe',
        defaultSystemId: 'sys-colors',
        systems: [
          {
            id: 'sys-colors',
            name: 'Colors System',
            bodies: [
              {
                id: 'terra',
                name: 'Terra',
                radius: 1000,
                mass: 1e20,
                color: '#123456',
                accentColor: '#abcdef',
                atmosphereColor: '#65432180',
                horizonColor: '#00ffcc',
                skyColor: '#336699aa',
              },
              {
                id: 'luna',
                name: 'Luna',
                parentId: 'terra',
                radius: 200,
                mass: 1e18,
                horizonColor: '#ffffff',
              },
            ],
            presets: [{ id: 'pad', name: 'Pad', bodyId: 'terra', kind: 'landed' }],
          },
        ],
      };

      const validated = validateUniverse(custom);
      expect(validated.systems[0]!.bodies[0]!.horizonColor).toBe('#00ffcc');
      expect(validated.systems[0]!.bodies[0]!.skyColor).toBe('#336699aa');
      expect(validated.systems[0]!.bodies[1]!.horizonColor).toBe('#ffffff');

      const loaded = loadSystem(validated, 'sys-colors');
      const terra = loaded.getResolvedBody('terra');
      expect(terra.horizonColor).toBe('#00ffcc');
      expect(terra.skyColor).toBe('#336699aa');
      expect(terra.atmosphereColor).toBe('#65432180');

      const luna = loaded.getResolvedBody('luna');
      expect(luna.horizonColor).toBe('#ffffff');
      expect(luna.skyColor).toBeUndefined();
    });

    it('rejects non-string horizonColor or skyColor in validateUniverse', () => {
      const invalid = {
        schemaVersion: 1,
        id: 'bad-colors',
        name: 'Bad Colors',
        defaultSystemId: 'sys1',
        systems: [
          {
            id: 'sys1',
            name: 'Sys 1',
            bodies: [
              {
                id: 'b1',
                name: 'B1',
                radius: 100,
                mass: 1e15,
                horizonColor: 12345,
              },
            ],
            presets: [{ id: 'p1', name: 'P1', bodyId: 'b1', kind: 'landed' }],
          },
        ],
      };
      expect(() => validateUniverse(invalid)).toThrow('Body b1 horizonColor must be a string');
    });
  });
});
