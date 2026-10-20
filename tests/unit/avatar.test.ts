import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { World } from '../../packages/sim-core/src/world';
import { loadWorld, saveWorld } from '../../packages/sim-core/src/save';

describe('avatar entity architecture', () => {
  it('spawns avatar and queries state by ID', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const body = world.body('earth');
    const avatar = world.spawnAvatar({
      ownerId: 'pilot-1',
      bodyId: 'earth',
      position: { x: 0, y: body.radius },
    });

    expect(avatar.id).toBeDefined();
    expect(avatar.ownerId).toBe('pilot-1');
    expect(avatar.parentBodyId).toBe('earth');
    expect(avatar.mode).toBe('surface');
    expect(world.avatar(avatar.id)).toEqual(avatar);
    expect(world.avatars()).toHaveLength(1);
    expect(world.avatars()[0]!.id).toBe(avatar.id);
  });

  it('avatar adheres to planetary down-gravity when standing on surface', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const body = world.body('earth');
    const surface = world.surface('earth');
    const groundRadius = surface ? surface.referenceRadius : body.radius;

    const avatar = world.spawnAvatar({
      ownerId: 'pilot-1',
      bodyId: 'earth',
      position: { x: 0, y: groundRadius },
    });
    expect(avatar.mode).toBe('surface');

    // Step world with idle controls
    world.step();
    let current = world.avatar(avatar.id)!;
    expect(current.mode).toBe('surface');
    let dist = Math.hypot(current.position.x, current.position.y);
    expect(dist).toBeCloseTo(groundRadius, 3);

    // Walk forward along tangent
    world.setAvatarControls(avatar.id, { move: 1, jump: 0, turn: 0 });
    for (let i = 0; i < 50; i++) {
      world.step();
    }
    current = world.avatar(avatar.id)!;
    expect(current.mode).toBe('surface');
    dist = Math.hypot(current.position.x, current.position.y);
    expect(dist).toBeCloseTo(groundRadius, 2);
    // Heading should align with counter-clockwise tangent
    expect(current.velocity.x !== 0 || current.velocity.y !== 0).toBe(true);
  });

  it('avatar transitions to EVA when jetpack jump exceeds escape speed or surface clearance', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const body = world.body('earth');
    const avatar = world.spawnAvatar({
      ownerId: 'pilot-1',
      bodyId: 'earth',
      position: { x: 0, y: body.radius },
    });
    expect(avatar.mode).toBe('surface');

    // Jump upward with jetpack
    world.setAvatarControls(avatar.id, { move: 0, jump: 1, turn: 0 });
    world.step();
    const jumping = world.avatar(avatar.id)!;
    expect(jumping.mode).toBe('eva');
    expect(jumping.velocity.y).toBeGreaterThan(0);

    // Let it fly into EVA and then fall back down under down-gravity
    world.setAvatarControls(avatar.id, { move: 0, jump: 0, turn: 0 });
    let contactEventFound = false;
    for (let i = 0; i < 500; i++) {
      const stepEvents = world.step();
      if (stepEvents.some(e => e.type === 'avatar-contact')) {
        contactEventFound = true;
        break;
      }
    }
    expect(contactEventFound).toBe(true);
    const landed = world.avatar(avatar.id)!;
    expect(landed.mode).toBe('surface');
  });

  it('avatar can board and exit ship, matching positions', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const ship = world.spawn({ ownerId: 'pilot-1', presetId: 'pad' });
    const avatar = world.spawnAvatar({
      ownerId: 'pilot-1',
      bodyId: ship.bodyId,
      position: ship.state.position,
    });

    world.boardShip(avatar.id, ship.id);
    let current = world.avatar(avatar.id)!;
    expect(current.mode).toBe('boarded');
    expect(current.mountedShipId).toBe(ship.id);
    expect(current.position).toEqual(ship.state.position);

    // Step the world and verify avatar tracks ship
    world.step();
    const updatedShip = world.ship(ship.id)!;
    current = world.avatar(avatar.id)!;
    expect(current.position).toEqual(updatedShip.state.position);

    // Disembark
    const exited = world.disembarkShip(avatar.id);
    expect(exited.mode).toBe('surface');
    expect(exited.mountedShipId).toBeUndefined();
    expect(exited.position).toEqual(updatedShip.state.position);
    expect(world.avatar(avatar.id)?.mode).toBe('surface');
  });

  it('round-trips avatar through world save and load', () => {
    const world = new World(DEFAULT_UNIVERSE);
    const body = world.body('earth');
    const a1 = world.spawnAvatar({
      id: 'eva-1',
      ownerId: 'pilot-1',
      bodyId: 'earth',
      position: { x: 0, y: body.radius + 100 },
      velocity: { x: 5, y: 0 },
    });
    const a2 = world.spawnAvatar({
      id: 'surf-1',
      ownerId: 'pilot-2',
      bodyId: 'earth',
      position: { x: body.radius, y: 0 },
    });
    expect(a1.id).toBe('eva-1');
    expect(a2.id).toBe('surf-1');

    const saved = saveWorld(world, { players: [{ id: 'pilot-1', name: 'P1' }, { id: 'pilot-2', name: 'P2' }] });
    expect(saved.avatars).toBeDefined();
    expect(saved.avatars).toHaveLength(2);

    const loaded = loadWorld(saved);
    expect(loaded.world.avatars()).toHaveLength(2);
    const loadedA1 = loaded.world.avatar('eva-1')!;
    expect(loadedA1).toBeDefined();
    expect(loadedA1.id).toBe('eva-1');
    expect(loadedA1.ownerId).toBe('pilot-1');
    expect(loadedA1.parentBodyId).toBe('earth');
    expect(loadedA1.position.x).toBe(0);
    expect(loadedA1.position.y).toBe(body.radius + 100);
    expect(loadedA1.velocity.x).toBe(5);
    expect(loadedA1.mode).toBe('eva');

    const loadedA2 = loaded.world.avatar('surf-1')!;
    expect(loadedA2).toBeDefined();
    expect(loadedA2.mode).toBe('surface');
  });
});
