import { describe, expect, it } from 'vitest';
import { IDLE, type State } from '../../packages/sim-core/src/index';
import { soiHorizon, WakeQueue } from '../../packages/sim-core/src/rails';
import { World, type Ship, type WorldEvent } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { FULL_SOLAR_UNIVERSE } from '../../packages/scenarios/builtin';

/** Deterministic xorshift32 in [0, 1). */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/** Same ships and rocks in two worlds; one may sleep idle ships, the other steps everything. */
function twins(universe = DEFAULT_UNIVERSE, systemId = 'solar-system', rocks = 60, seed = 7, every = 1): [World, World] {
  const worlds = [new World(universe, { systemId }), new World(universe, { systemId })] as [World, World];
  worlds[1].rails = false;
  for (const world of worlds) {
    const random = rng(seed);
    const system = world.system;
    for (const preset of system.presets) world.spawn({ ownerId: 'p', presetId: preset.id });
    const bodies = system.getAllBodies().filter(b => b.parentId !== null || system.getMoonsOf(b.id).length);
    for (let i = 0; i < rocks; i++) {
      const body = bodies[Math.floor(random() * bodies.length)]!;
      const soi = Number.isFinite(body.soi.radius) ? body.soi.radius : body.radius * 400;
      const r = body.radius * 1.2 + random() * Math.min(soi * 0.95 - body.radius * 1.2, body.radius * 300);
      const angle = random() * 2 * Math.PI;
      // From well bound to escaping, prograde or retrograde, sometimes nearly radial.
      const speed = Math.sqrt(body.mu / r) * (0.2 + random() * 1.4) * (random() < 0.3 ? -1 : 1);
      const tilt = random() < 0.1 ? 1.4 : random() * 0.6;
      const state: State = { time: world.time, heading: 0, throttle: 0, status: 'flying', revision: 0,
        position: { x: r * Math.cos(angle), y: r * Math.sin(angle) },
        velocity: { x: speed * -Math.sin(angle + tilt), y: speed * Math.cos(angle + tilt) } };
      world.put({ id: `rock-${i}`, name: `Rock ${i}`, ownerId: 'nature', bodyId: body.id, state, controls: IDLE });
    }
    // Ships that must meet an event within seconds: leave a sphere of influence, enter a
    // moon's, crash, land gently.
    const put = (id: string, bodyId: string, x: number, y: number, vx: number, vy: number): void =>
      world.put({ id, name: id, ownerId: 'nature', bodyId, controls: IDLE,
        state: { time: world.time, heading: Math.atan2(y, x), throttle: 0, status: 'flying', revision: 0,
          position: { x, y }, velocity: { x: vx, y: vy } } });
    for (const [index, body] of system.getAllBodies().entries()) {
      if (!body.parentId || !Number.isFinite(body.soi.exitMetres) || index % every) continue;
      const exit = body.soi.exitMetres, speed = Math.sqrt(2 * body.mu / exit) * 1.5 + 500;
      for (const [k, gap] of [1e3, 5e3, 3e4].entries()) put(`exit-${body.id}-${k}`, body.id, 0, exit - gap, 40, speed);
      const parent = world.body(body.parentId);
      const at = system.getBodyPosition(body.id, world.time), base = system.getBodyPosition(parent.id, world.time);
      const v = system.getBodyVelocity(body.id, world.time), vb = system.getBodyVelocity(parent.id, world.time);
      const entry = body.soi.entryMetres;
      for (const [k, gap] of [2e3, 1e4, 4e4].entries()) {
        put(`enter-${body.id}-${k}`, parent.id, at.x - base.x + entry + gap, at.y - base.y,
          v.x - vb.x - 3000, v.y - vb.y);
      }
    }
    for (const body of system.getAllBodies().filter(b => b.surfaceFeatures !== 'star').slice(0, 3)) {
      const g = body.mu / body.radius ** 2;
      put(`crash-${body.id}`, body.id, 0, body.radius + 3000, 0, -150);
      // From 5 m above the surface the fall ends below the 5 m/s landing limit.
      put(`land-${body.id}`, body.id, body.radius + Math.min(5, 1 / g), 0, -1, 0);
    }
  }
  return worlds;
}

const view = (ship: Ship): unknown => ({ id: ship.id, bodyId: ship.bodyId, fault: ship.fault, controls: ship.controls,
  state: { ...ship.state, coast: ship.state.coast && { ...ship.state.coast } } });

describe('ships on rails', () => {
  it('reproduces per-step results exactly while ships sleep, wake, burn, land and change SOI', () => {
    const [railed, stepped] = twins();
    const log: [WorldEvent[], WorldEvent[]] = [[], []];
    for (let tick = 0; tick < 3000; tick++) {
      // Commands wake sleepers mid-flight: a burn, a turn, a throttle change, God mode.
      for (const world of [railed, stepped]) {
        if (tick === 500) world.setControls('ship-2', { turn: 0, throttle: 0, engine: true });
        if (tick === 650) world.setControls('ship-2', IDLE);
        if (tick === 900) world.setControls('rock-3', { turn: 1, throttle: 0, engine: false });
        if (tick === 950) world.setControls('rock-3', IDLE);
        if (tick === 1200) world.setThrottle('rock-5', 0.25);
        if (tick === 1500) world.setGodMode('rock-7', true);
      }
      log[0].push(...railed.step());
      log[1].push(...stepped.step());
      if (tick % 250 === 0) expect(railed.ships().map(view)).toEqual(stepped.ships().map(view));
    }
    expect(railed.asleepCount).toBeGreaterThan(20);
    expect(railed.ships().map(view)).toEqual(stepped.ships().map(view));
    const sort = (events: WorldEvent[]): string[] => events.map(e => JSON.stringify(e)).sort();
    expect(sort(log[0])).toEqual(sort(log[1]));
    expect(log[0].filter(e => e.type === 'soi').length).toBeGreaterThan(6);
    const statuses = new Set(railed.ships().map(s => s.state.status));
    expect(statuses).toEqual(new Set(['flying', 'landed', 'crashed']));
  }, 60_000);

  it('wakes in time for every SOI change in the full-scale solar system', () => {
    const [railed, stepped] = twins(FULL_SOLAR_UNIVERSE, 'sol', 150, 3, 12);
    const transitions: [WorldEvent[], WorldEvent[]] = [[], []];
    for (let tick = 0; tick < 1500; tick++) {
      transitions[0].push(...railed.step().filter(e => e.type === 'soi'));
      transitions[1].push(...stepped.step().filter(e => e.type === 'soi'));
    }
    expect(railed.asleepCount).toBeGreaterThan(100);
    expect(transitions[0].length).toBeGreaterThan(20);
    expect(transitions[0].map(e => JSON.stringify(e)).sort()).toEqual(transitions[1].map(e => JSON.stringify(e)).sort());
    expect(railed.ships().map(view)).toEqual(stepped.ships().map(view));
  }, 60_000);

  it('keeps sleeping ships exact when read between steps and at arbitrary times', () => {
    const [railed, stepped] = twins(DEFAULT_UNIVERSE, 'solar-system', 20, 11);
    for (let tick = 0; tick < 400; tick++) {
      railed.step(); stepped.step();
      // Reading a sleeper must not disturb it.
      if (tick % 37 === 0) railed.ship('rock-4');
    }
    expect(railed.ships().map(view)).toEqual(stepped.ships().map(view));
    const sleeper = [...railed.records()].find(s => railed.isAsleep(s.id) && s.state.coast)!;
    expect(sleeper).toBeDefined();
    const later = railed.stateAt(sleeper.id, railed.time + 1.5)!;
    for (let i = 0; i < 150; i++) stepped.step();
    const truth = stepped.ship(sleeper.id)!.state;
    expect(later.position.x).toBeCloseTo(truth.position.x, 3);
    expect(later.position.y).toBeCloseTo(truth.position.y, 3);
  }, 30_000);

  it('sleeps fresh coasting records before stepping them and adopts late records on rails', () => {
    const [railed, stepped] = twins(DEFAULT_UNIVERSE, 'solar-system', 40, 5);
    railed.step(); stepped.step();
    // Idle coasts with a horizon fall asleep on their first step without being advanced.
    expect(railed.asleepCount).toBeGreaterThan(30);
    for (let i = 0; i < 300; i++) { railed.step(); stepped.step(); }
    expect(railed.ships().map(view)).toEqual(stepped.ships().map(view));
    // A record 120 ticks old (a network snapshot) with no inputs to replay catches up without
    // any per-tick steps, exactly.
    const top = (s: Ship): number => stepped.surface(s.bodyId)?.bounds.maxRadius ?? stepped.body(s.bodyId).radius;
    const record = stepped.ships().find(s => s.state.dynamics === 'kepler' && !s.controls.engine
      && soiHorizon(stepped.system, stepped.body(s.bodyId), s.state, s.state.coast!, s.state.time, top(s)) > 3)!;
    expect(record).toBeDefined();
    for (let i = 0; i < 120; i++) { railed.step(); stepped.step(); }
    railed.remove(record.id);
    expect(railed.adopt(record, 120)).toEqual([]);
    expect(railed.isAsleep(record.id)).toBe(true);
    expect(view(railed.ship(record.id)!)).toEqual(view(stepped.ship(record.id)!));
    for (let i = 0; i < 200; i++) { railed.step(); stepped.step(); }
    // Re-adding moved it to the end of the fleet's order.
    const byId = (world: World): unknown[] => [...world.ships()].sort((a, b) => a.id.localeCompare(b.id)).map(view);
    expect(byId(railed)).toEqual(byId(stepped));
  }, 30_000);

  it('never sleeps past a moon encounter on a crossing orbit', () => {
    const world = new World(DEFAULT_UNIVERSE, { systemId: 'solar-system' });
    const moon = world.body('moon'), earth = world.body('earth');
    // Aim at where the Moon will be: start inside its orbit on a fast outbound ellipse.
    const a = moon.ephemeris.kind === 'circular-kepler' ? moon.ephemeris.radius! : 0;
    const r = a * 0.5, speed = Math.sqrt(earth.mu * (2 / r - 2 / (r + a * 1.05)));
    const state: State = { time: 0, heading: 0, throttle: 0, status: 'flying', revision: 0,
      position: { x: r, y: 0 }, velocity: { x: 0, y: speed } };
    const horizon = soiHorizon(world.system, earth, state, Object.freeze({ position: Object.freeze({ ...state.position }),
      velocity: Object.freeze({ ...state.velocity }) }), 0);
    expect(horizon).toBeGreaterThan(0);
    // The ship cannot reach the Moon's band sooner than the radial time to it.
    expect(horizon).toBeLessThan(Infinity);
  });
});

describe('wake queue', () => {
  it('pops entries in tick order', () => {
    const queue = new WakeQueue();
    const random = rng(5);
    const ticks: number[] = [];
    for (let i = 0; i < 500; i++) { const t = Math.floor(random() * 1000); ticks.push(t); queue.push(t, `s${i}`, i); }
    const popped: number[] = [];
    while (queue.size) { const tick = queue.peekTick(); queue.pop(); popped.push(tick); }
    expect(popped).toEqual([...ticks].sort((a, b) => a - b));
    expect(queue.pop()).toBeUndefined();
    expect(queue.peekTick()).toBe(Infinity);
  });
});
