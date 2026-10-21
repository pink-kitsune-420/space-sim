import { describe, expect, it } from 'vitest';
import { validateUniverse } from '../../packages/sim-core/src/universe';
import { World } from '../../packages/sim-core/src/world';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';
import { checkWarpSafety, PHYSICAL_WARP_MAX } from '../../packages/sim-core/src/warp';

function createThreeBodyUniverse(physics?: Record<string, unknown>) {
  return validateUniverse({
    schemaVersion: 1,
    id: 'three-body-test',
    name: 'Three Body Test Universe',
    defaultSystemId: 'sys-1',
    systems: [
      {
        id: 'sys-1',
        name: 'System 1',
        bodies: [
          {
            id: 'star',
            name: 'Star',
            radius: 1_000_000,
            mass: 1.0e26,
            color: '#fff6e0',
          },
          {
            id: 'planet',
            name: 'Planet',
            parentId: 'star',
            radius: 500_000,
            mass: 5.0e23,
            color: '#4b9cd3',
            ephemeris: {
              kind: 'circular-kepler',
              radius: 20_000_000,
              phaseRadiansAtEpoch: 0,
            },
          },
          {
            id: 'moon',
            name: 'Moon',
            parentId: 'planet',
            radius: 100_000,
            mass: 5.0e21,
            color: '#cccccc',
            ephemeris: {
              kind: 'circular-kepler',
              radius: 2_000_000,
              phaseRadiansAtEpoch: Math.PI / 2,
            },
          },
        ],
        presets: [
          {
            id: 'planet-orbit',
            name: 'Planet Orbit',
            bodyId: 'planet',
            kind: 'circular-orbit',
            altitude: 250_000,
          },
          {
            id: 'moon-orbit',
            name: 'Moon Orbit',
            bodyId: 'moon',
            kind: 'circular-orbit',
            altitude: 100_000,
          },
        ],
      },
    ],
    ...(physics ? { physics } : {}),
  });
}

function createCollisionUniverse(collisionMode: 'merge' | 'bounce') {
  // Place body-b overlapping/colliding with body-a at t=0 so the very first step resolves a collision
  return validateUniverse({
    schemaVersion: 1,
    id: 'collision-test',
    name: 'Collision Test Universe',
    defaultSystemId: 'sys-col',
    systems: [
      {
        id: 'sys-col',
        name: 'Collision System',
        bodies: [
          {
            id: 'star',
            name: 'Central Star',
            radius: 1_000_000,
            mass: 1.0e25,
            color: '#fff6e0',
          },
          {
            id: 'impactor',
            name: 'Impactor',
            parentId: 'star',
            radius: 500_000,
            mass: 1.0e23,
            color: '#ff6a1f',
            ephemeris: {
              kind: 'circular-kepler',
              // Distance 1,200,000 m < star.radius + impactor.radius (1,500,000 m)
              radius: 1_200_000,
              phaseRadiansAtEpoch: 0,
            },
          },
        ],
        presets: [
          {
            id: 'impactor-orbit',
            name: 'Impactor Orbit',
            bodyId: 'impactor',
            kind: 'circular-orbit',
            altitude: 100_000,
          },
        ],
      },
    ],
    physics: {
      mode: 'full-body',
      substeps: 2,
      collisionMode,
      restitution: 0.6,
    },
  });
}

describe('Phase 3: World Lifecycle & Prediction Integration', () => {
  describe('1. Rails Universe Regression Safety', () => {
    it('leaves solver and bodyStates undefined in default rails mode and allows ships to sleep on rails', () => {
      const universe = createThreeBodyUniverse();
      const world = new World(universe);

      expect(world.solver).toBeUndefined();
      expect(world.bodyStates).toBeUndefined();
      expect(world.requiresWorldPrediction).toBe(false);

      const ship = world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });
      world.step();

      expect(world.solver).toBeUndefined();
      expect(world.bodyStates).toBeUndefined();
      expect(world.isAsleep(ship.id)).toBe(true);

      const warpDecision = checkWarpSafety(world);
      expect(warpDecision.railsEligible).toBe(true);
      expect(warpDecision.maxGranted).toBe(100_000);
    });
  });

  describe('2. Dynamic Celestial Stepping (nbody & full-body modes)', () => {
    it('initializes PhysicsSolver in nbody mode and advances non-fixed celestial bodies on step()', () => {
      const universe = createThreeBodyUniverse({ mode: 'nbody', substeps: 4 });
      const world = new World(universe);

      expect(world.solver).toBeDefined();
      // Fresh unstepped world without loaded save keeps bodyStates undefined for legacy save compatibility
      expect(world.bodyStates).toBeUndefined();
      expect(world.requiresWorldPrediction).toBe(true);

      const ship = world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });
      const initialPlanetPos = { ...world.system.getBodyPosition('planet', world.time) };
      const initialMoonPos = { ...world.system.getBodyPosition('moon', world.time) };

      for (let i = 0; i < 500; i++) {
        world.step();
      }

      expect(world.tick).toBe(500);
      expect(world.time).toBeCloseTo(5.0, 9);
      expect(world.bodyStates).toBeDefined();
      expect(world.bodyStates!.length).toBe(3);

      // Fixed root body stays at origin
      const starPos = world.system.getBodyPosition('star', world.time);
      expect(starPos.x).toBe(0);
      expect(starPos.y).toBe(0);

      // Non-fixed planet and moon advance dynamically
      const nextPlanetPos = world.system.getBodyPosition('planet', world.time);
      const nextMoonPos = world.system.getBodyPosition('moon', world.time);
      expect(nextPlanetPos.x).not.toBe(initialPlanetPos.x);
      expect(nextPlanetPos.y).not.toBe(initialPlanetPos.y);
      expect(nextMoonPos.x).not.toBe(initialMoonPos.x);
      expect(nextMoonPos.y).not.toBe(initialMoonPos.y);

      // Dynamic bodyStates snapshot matches LoadedSystem coordinates
      const planetSnapshot = world.bodyStates!.find(b => b.id === 'planet')!;
      expect(planetSnapshot.position[0]).toBe(nextPlanetPos.x);
      expect(planetSnapshot.position[1]).toBe(nextPlanetPos.y);

      // Ships never sleep on Kepler rails when numerical solver is active
      expect(world.isAsleep(ship.id)).toBe(false);
      expect(world.settles(ship.id)).toBe(false);
    });

    it('perturbs ship trajectory under multi-body gravity compared to single-body Keplerian rails', () => {
      const railsUniverse = createThreeBodyUniverse({ mode: 'rails' });
      const nbodyUniverse = createThreeBodyUniverse({ mode: 'nbody', substeps: 4 });

      const railsWorld = new World(railsUniverse);
      const nbodyWorld = new World(nbodyUniverse);

      const railsShip = railsWorld.spawn({ ownerId: 'p1', presetId: 'moon-orbit' });
      const nbodyShip = nbodyWorld.spawn({ ownerId: 'p1', presetId: 'moon-orbit' });

      for (let i = 0; i < 100; i++) {
        railsWorld.step();
        nbodyWorld.step();
      }

      const rState = railsWorld.ship(railsShip.id)!.state;
      const nState = nbodyWorld.ship(nbodyShip.id)!.state;

      expect(nState.status).toBe('flying');
      expect(nState.dynamics).toBe('numerical');
      // External tidal pull of star & planet perturbs the moon-orbiting ship relative to pure 2-body rails
      const diff = Math.hypot(nState.position.x - rState.position.x, nState.position.y - rState.position.y);
      expect(diff).toBeGreaterThan(0);
    });

    it('emits body-collision event, updates LoadedSystem, and re-parents ships on merge collision in full-body mode', () => {
      const universe = createCollisionUniverse('merge');
      const world = new World(universe);
      const ship = world.spawn({ ownerId: 'p1', presetId: 'impactor-orbit' });
      expect(ship.bodyId).toBe('impactor');

      const events = world.step();
      const collisionEvent = events.find(e => e.type === 'body-collision');
      expect(collisionEvent).toBeDefined();
      expect(collisionEvent).toMatchObject({
        type: 'body-collision',
        collisionType: 'merge',
        survivorId: 'star',
        absorbedId: 'impactor',
        bodyAId: 'star',
        bodyBId: 'impactor',
      });
      if (collisionEvent?.type === 'body-collision') {
        expect(collisionEvent.newMass).toBeCloseTo(1.01e25, 18);
      }

      // Absorbed body is removed from LoadedSystem active bodies
      const remainingIds = world.system.getAllBodies().map(b => b.id);
      expect(remainingIds).toEqual(['star']);

      // Ship orbiting absorbed body is re-parented to survivor with an SOI transition event
      const soiEvent = events.find(e => e.type === 'soi' && e.shipId === ship.id);
      expect(soiEvent).toBeDefined();
      expect(world.ship(ship.id)!.bodyId).toBe('star');
    });

    it('emits bounce body-collision event with positive impulse in full-body bounce mode', () => {
      const universe = createCollisionUniverse('bounce');
      // Set radial inward velocity on impactor via bodyStates so relative normal velocity < 0
      const world = new World(universe);
      world.bodyStates = [
        { id: 'star', position: [0, 0], velocity: [0, 0] },
        { id: 'impactor', position: [1_200_000, 0], velocity: [-5000, 0] },
      ];

      const events = world.step();
      const collisionEvent = events.find(e => e.type === 'body-collision');
      expect(collisionEvent).toBeDefined();
      expect(collisionEvent!.type).toBe('body-collision');
      if (collisionEvent?.type === 'body-collision') {
        expect(collisionEvent.collisionType).toBe('bounce');
        expect(collisionEvent.impulse).toBeGreaterThan(0);
      }
      // Both bodies survive a bounce
      expect(world.system.getAllBodies().map(b => b.id)).toEqual(['star', 'impactor']);
    });
  });

  describe('3. Save / Load Round-Trip with Dynamic State', () => {
    it('round-trips dynamic body states through saveWorld and loadWorld and continues stepping identically', () => {
      const universe = createThreeBodyUniverse({ mode: 'nbody', substeps: 4 });
      const world = new World(universe);
      const ship = world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });

      for (let i = 0; i < 200; i++) {
        world.step();
      }

      const saved = saveWorld(world);
      expect(saved.bodies).toBeDefined();
      expect(saved.bodies!.length).toBe(3);

      const { world: restored } = loadWorld(saved);
      expect(restored.tick).toBe(world.tick);
      expect(restored.time).toBe(world.time);
      expect(restored.bodyStates).toEqual(world.bodyStates);

      for (const b of ['star', 'planet', 'moon']) {
        expect(restored.system.getBodyPosition(b, restored.time)).toEqual(
          world.system.getBodyPosition(b, world.time),
        );
        expect(restored.system.getBodyVelocity(b, restored.time)).toEqual(
          world.system.getBodyVelocity(b, world.time),
        );
      }

      // Advance both worlds 100 more ticks and verify deterministic bit-for-bit parity
      for (let i = 0; i < 100; i++) {
        world.step();
        restored.step();
      }

      expect(restored.bodyStates).toEqual(world.bodyStates);
      expect(restored.ship(ship.id)!.state).toEqual(world.ship(ship.id)!.state);
    });
  });

  describe('4. Trajectory Prediction Parity (cloneForPrediction & predictShip)', () => {
    it('isolates PhysicsSolver and dynamic body states in cloneForPrediction()', () => {
      const universe = createThreeBodyUniverse({ mode: 'nbody', substeps: 2 });
      const world = new World(universe);
      const ship = world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });

      for (let i = 0; i < 50; i++) {
        world.step();
      }

      const snapshotBeforeClone = structuredClone(world.bodyStates);
      const planetPosBeforeClone = { ...world.system.getBodyPosition('planet', world.time) };

      const clone = world.cloneForPrediction();
      for (let i = 0; i < 100; i++) {
        clone.step();
      }

      // Parent world must remain completely untouched
      expect(world.tick).toBe(50);
      expect(world.bodyStates).toEqual(snapshotBeforeClone);
      expect(world.system.getBodyPosition('planet', world.time)).toEqual(planetPosBeforeClone);

      // Stepping parent world 100 ticks reaches the exact same state as the clone
      for (let i = 0; i < 100; i++) {
        world.step();
      }
      expect(world.bodyStates).toEqual(clone.bodyStates);
      expect(world.ship(ship.id)!.state).toEqual(clone.ship(ship.id)!.state);
      clone.dispose();
    });

    it('predicts ship trajectory numerically in nbody mode without mutating live world state', () => {
      const universe = createThreeBodyUniverse({ mode: 'nbody', substeps: 2 });
      const world = new World(universe);
      const ship = world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });

      for (let i = 0; i < 20; i++) {
        world.step();
      }

      const liveBodyStatesBefore = structuredClone(world.bodyStates);
      const liveShipBefore = structuredClone(world.ship(ship.id)!);

      const gen = world.predictShip(ship.id);
      const samples = [];
      for (let i = 0; i < 25; i++) {
        const next = gen.next();
        if (next.done) break;
        samples.push(next.value);
      }

      expect(samples.length).toBe(25);
      expect(samples[0]!.time).toBeCloseTo(liveShipBefore.state.time, 9);
      expect(samples[24]!.time).toBeGreaterThan(samples[0]!.time);

      // Live world state is completely unmutated after prediction
      expect(world.bodyStates).toEqual(liveBodyStatesBefore);
      expect(world.ship(ship.id)).toEqual(liveShipBefore);
    });
  });

  describe('5. Warp Safety Bounds in Non-Rails Modes', () => {
    it('clamps maxGranted to PHYSICAL_WARP_MAX (4x) and disables railsEligible in nbody and full-body modes', () => {
      for (const mode of ['nbody', 'full-body'] as const) {
        const universe = createThreeBodyUniverse({ mode });
        const world = new World(universe);
        world.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });

        const decision = checkWarpSafety(world);
        expect(decision.railsEligible).toBe(false);
        expect(decision.maxGranted).toBe(PHYSICAL_WARP_MAX);
        expect(decision.reason).toBe('Numerical N-body simulation active (analytic rails warp unavailable)');
        world.dispose();
      }

      // Respects custom configuredMaxWarp when lower than PHYSICAL_WARP_MAX
      const customWorld = new World(createThreeBodyUniverse({ mode: 'full-body', maxWarp: 2 }));
      customWorld.spawn({ ownerId: 'p1', presetId: 'planet-orbit' });
      const customBounded = checkWarpSafety(customWorld);
      expect(customBounded.railsEligible).toBe(false);
      expect(customBounded.maxGranted).toBe(2);
      customWorld.dispose();
    });
  });
});
