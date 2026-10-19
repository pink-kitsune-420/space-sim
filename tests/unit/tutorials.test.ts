import { expect, it } from 'vitest';
import { createTutorialRunners, conditionMet } from '../../modules/tutorial-runner/src/index';
import { course } from '../../modules/orbital-lessons/src/index';
import { observeFlight, previewOrbit } from '../../modules/academy-ui/src/flight';
import { academyFlightReader, academyPracticeState } from '../../apps/web/src/academy-flight';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { IDLE } from '../../packages/sim-core/src/constants';
import { saveWorld } from '../../packages/sim-core/src/save';
import type { AcademyFlight, SessionRead, TutorialLesson, TutorialObservation } from '../../packages/game-api/src/index';

const identity = {};
const observation = (time: number, safe = true, paused = false): TutorialObservation => ({ identity, time, paused, values: { safe } });
const lesson: TutorialLesson = { id: 'test', version: 1, title: 'Coast', level: 'First flights', introduction: '', deeper: '', steps: [
  { title: 'Coast', instruction: '', hint: '', conditions: [{ field: 'safe', operator: 'eq', value: true }], holdSeconds: 2 },
  { title: 'Check', instruction: '', hint: '', question: { choices: ['wrong', 'right'], correct: 1, explanation: 'Gravity acts.' } },
] };
it('requires a consecutive observed hold, rejects wrong answers and persists versioned completion', () => {
  const saved = new Map<string, string>(), storage = { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => { saved.set(key, value); } };
  const runner = createTutorialRunners().create({ storage, storageKey: 'game/course/v1/pilot' }); runner.start(lesson, observation(0));
  runner.update(observation(1)); runner.update(observation(2, false)); runner.update(observation(3)); runner.update(observation(4)); expect(runner.step).toBe(0);
  runner.update(observation(5)); expect(runner.step).toBe(1); expect(runner.answer(0)).toBe(false); expect(runner.finished).toBe(false);
  expect(runner.answer(1)).toBe(true); expect(runner.completed.has('test@1')).toBe(true);
  const restored = createTutorialRunners().create({ storage, storageKey: 'game/course/v1/pilot' }); expect(restored.completed.has('test@1')).toBe(true); expect(restored.completed.has('test@2')).toBe(false);
  expect(createTutorialRunners().create({ storage, storageKey: 'other-game' }).completed.size).toBe(0);
});
it('does not advance during pause, on duplicate frames or after interruption/stop/disposal', () => {
  const runner = createTutorialRunners().create({ storageKey: 'x' }); runner.start(lesson, observation(0));
  runner.update(observation(1)); runner.update(observation(1)); runner.update(observation(100, true, true)); expect(runner.step).toBe(0);
  runner.update({ ...observation(101), identity: {} }); expect(runner.interrupted).toBe(true);
  runner.update(observation(200)); expect(runner.step).toBe(0);
  runner.start(lesson, observation(10)); runner.update(observation(9)); expect(runner.interrupted).toBe(true);
  runner.stop(); expect(runner.lesson).toBeUndefined(); runner.dispose(); expect(() => runner.start(lesson, observation(0))).toThrow('disposed');
});
it('isolates failed storage and bounds/validates imported lesson logic', () => {
  const runner = createTutorialRunners().create({ storageKey: 'x', storage: { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } } });
  expect(() => runner.start({ ...lesson, steps: [] }, observation(0))).toThrow('Invalid');
  expect(() => runner.start({ ...lesson, steps: [{ ...lesson.steps[0]!, conditions: [], question: undefined }] }, observation(0))).toThrow('Each step');
  runner.start(lesson, observation(0)); runner.update(observation(1)); runner.update(observation(3)); expect(() => runner.answer(1)).not.toThrow(); expect(runner.finished).toBe(true);
});
it('rejects missing/nonfinite diagnostics and invalid relative baselines', () => {
  expect(conditionMet({ field: 'radius', operator: 'ratio-gte', value: 1.2 }, { radius: 200 }, { radius: 100 })).toBe(true);
  for (const value of [0, Number.NaN, -1]) expect(conditionMet({ field: 'radius', operator: 'ratio-gte', value: 1.2 }, { radius: 200 }, { radius: value })).toBe(false);
  for (const value of [Number.NaN, Infinity, undefined]) expect(conditionMet({ field: 'height', operator: 'gte', value: 1 }, value === undefined ? {} : { height: value }, {})).toBe(false);
});
it('checks explicit planning objectives while paused without awarding timed flight holds', () => {
  const runner = createTutorialRunners().create({ storageKey: 'planning' });
  const planning = { ...lesson, steps: [{ ...lesson.steps[0]!, allowPaused: true, holdSeconds: 0 }] };
  runner.start(planning, observation(0, false, true)); runner.update(observation(0, true, true)); expect(runner.finished).toBe(true);
  expect(() => runner.start({ ...planning, steps: [{ ...planning.steps[0]!, holdSeconds: 1 }] }, observation(0))).toThrow('Each step');
});
it('has an independently selectable valid bounded course with both introductory and advanced flight work', () => {
  expect(course.lessons).toHaveLength(24); expect(new Set(course.lessons.map(item => item.id)).size).toBe(24);
  const runner = createTutorialRunners().create({ storageKey: 'x' });
  for (const item of course.lessons) { expect(() => runner.start(item, observation(0))).not.toThrow(); expect(item.deeper.length).toBeGreaterThan(60); }
  expect(course.lessons.some(item => item.level === 'Advanced' && item.steps.some(step => step.conditions?.length))).toBe(true);
});

function practice(id = 'coasting', time = 0) {
  const world = new World(DEFAULT_UNIVERSE), ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
  if (time) world.restoreClock(Math.round(time / .01), time);
  const lesson = course.lessons.find(item => item.id === id)!;
  if (lesson.practice.kind === 'pad') world.respawn(ship.id, 'pad');
  else { const p = academyPracticeState(world, lesson.practice); world.teleport(ship.id, p.bodyId, p.position, p.velocity, p.heading); }
  const read = (): AcademyFlight => {
    const current = world.ship(ship.id)!, state = current.state, body = world.body(current.bodyId), surface = world.surface(body.id);
    return { identity, time: world.time, paused: false, state, engine: current.controls.engine, body: { id: body.id, name: body.name, radius: body.radius, mu: body.mu, surfaceTop: Math.max(body.radius, surface?.bounds.maxRadius ?? 0), soi: body.soi.radius },
      orbit: state.status === 'flying' ? world.context.services.orbits.elements(state, body.mu) : null, clearance: Math.hypot(state.position.x, state.position.y) - body.radius,
      analytic: true, prediction: 'closed', plannedNodes: 0, plannedDeltaV: 0, alarms: 0 };
  };
  return { world, ship, read };
}
it.each(course.lessons.filter(item => item.practice.kind !== 'pad').map(item => item.id))('places %s practice through the real body and surface model', id => {
  const { world, read } = practice(id), flight = read();
  expect(flight.state.status).toBe('flying'); expect(flight.clearance).toBeGreaterThan(0); expect(flight.engine).toBe(false);
  expect([flight.state.position.x, flight.state.velocity.x, flight.state.velocity.y].every(Number.isFinite)).toBe(true);
  if (id === 'capture') expect(flight.orbit!.energy).toBeGreaterThan(0);
  else expect(observeFlight(flight).values.safe).toBe(true);
  world.dispose();
});
it('rejects unbound, terrain-intersecting and SOI-crossing orbits as completed safe orbits', () => {
  const { world, read } = practice(), flight = read(); expect(observeFlight(flight).values.safe).toBe(true);
  const orbit = flight.orbit!;
  for (const changed of [{ ...orbit, kind: 'hyperbolic' as const }, { ...orbit, periapsis: flight.body.surfaceTop }, { ...orbit, apoapsis: flight.body.soi }]) {
    expect(observeFlight({ ...flight, orbit: changed }).values.safe).toBe(false);
  }
  expect(observeFlight({ ...flight, analytic: false }).values.safe).toBe(false); world.dispose();
});
it('builds a bounded target conic through its specified apsides without changing the real world', () => {
  const { world, read } = practice(), before = JSON.stringify(saveWorld(world));
  const preview = previewOrbit(read(), { low: 2, high: 4 }), radii = preview.points.map(p => Math.hypot(p.x, p.y));
  expect(preview.points).toHaveLength(97); expect(Math.min(...radii)).toBeCloseTo(1024, 8); expect(Math.max(...radii)).toBeCloseTo(2048, 8);
  expect(JSON.stringify(saveWorld(world))).toBe(before); world.dispose();
});
it('detaches readouts, scopes continuity to the controlled flight and rejects stale plan credit', () => {
  const { world, ship } = practice(); let epoch = 0, playerId = 'pilot', valid = false;
  const read = academyFlightReader({ session: () => ({ world, playerId, paused: true } as unknown as SessionRead), selected: () => ship.id, epoch: () => epoch,
    plan: () => ({ valid, nodes: [{ valid }, { valid: false }], deltaVelocity: { x: 10, y: 0 } }), alarms: () => 0, prediction: () => 'closed' });
  const first = read()!; expect(first.plannedNodes).toBe(0); expect(first.plannedDeltaV).toBe(0);
  (first.state.position as { x: number }).x = 12345; expect(world.ship(ship.id)!.state.position.x).not.toBe(12345);
  valid = true; expect(read()!.identity).toBe(first.identity); expect(read()!.plannedNodes).toBe(1); expect(read()!.plannedDeltaV).toBe(10);
  epoch++; expect(read()!.identity).not.toBe(first.identity); playerId = 'someone-else'; expect(read()).toBeUndefined(); world.dispose();
});
it('coasts the actual elliptical practice through the speed and equal-area objectives', () => {
  const { world, ship, read } = practice('speed'), runner = createTutorialRunners().create({ storageKey: 'physics' });
  runner.start(course.lessons.find(item => item.id === 'speed')!, observeFlight(read()));
  const h = read().orbit!.angularMomentum;
  for (let i = 0; i < 300 && runner.step === 0; i++) { world.advanceTo(world.tick + 100, 1000); runner.update(observeFlight(read())); }
  expect(runner.step).toBe(1); expect(read().orbit!.angularMomentum).toBeCloseTo(h, 7); expect(world.ship(ship.id)!.controls).toEqual(IDLE); world.dispose();
});
it.each([0, 1000])('encounters the moving moon in actual coast flight at epoch %s', epoch => {
  const { world, ship } = practice('encounter', epoch);
  for (let i = 0; i < 100 && world.ship(ship.id)!.bodyId === 'planet'; i++) world.advanceTo(world.tick + 1000, 2000);
  expect(world.ship(ship.id)!.bodyId).toBe('moon'); expect(world.ship(ship.id)!.state.status).toBe('flying'); world.dispose();
});

it('completes lunar capture with a finite retrograde burn and a real safe coast', () => {
  const { world, ship, read } = practice('capture'), runner = createTutorialRunners().create({ storageKey: 'capture' });
  runner.start(course.lessons.find(item => item.id === 'capture')!, observeFlight(read()));
  world.setThrottle(ship.id, .05); let captured = false;
  for (let i = 0; i < 500; i++) {
    world.setControls(ship.id, { ...IDLE, engine: true }); world.step();
    if (observeFlight(read()).values.safe) { captured = true; break; }
  }
  expect(captured).toBe(true); world.setControls(ship.id, IDLE);
  for (let i = 0; i < 250; i++) { world.step(); runner.update(observeFlight(read())); }
  expect(runner.finished).toBe(true); expect(read().orbit!.energy).toBeLessThan(0); world.dispose();
});
it('forms a terrain-clearing first orbit with half power and the taught early turn', () => {
  const { world, ship, read } = practice('first-orbit'); let turning = false, safe = false;
  for (let i = 0; i < 1500; i++) {
    const flight = read(), p = flight.state.position;
    if (flight.clearance! >= 30) turning = true;
    const target = Math.atan2(p.y, p.x) - Math.PI / 2, error = Math.atan2(Math.sin(target - flight.state.heading), Math.cos(target - flight.state.heading));
    world.setControls(ship.id, { turn: turning && Math.abs(error) > .015 ? Math.sign(error) : 0, throttle: 0, engine: true }); world.step();
    if (observeFlight(read()).values.safe && read().orbit!.periapsis > 535) { safe = true; break; }
  }
  expect(safe).toBe(true); world.setControls(ship.id, IDLE);
  world.advanceTo(world.tick + 500, 1000); expect(observeFlight(read()).values.safe).toBe(true); expect(read().state.status).toBe('flying'); world.dispose();
});

it('flies the two-burn transfer through finite thrust, actual coasting and circularization', () => {
  const { world, ship, read } = practice('transfer'), runner = createTutorialRunners().create({ storageKey: 'transfer' });
  runner.start(course.lessons.find(item => item.id === 'transfer')!, observeFlight(read())); world.setThrottle(ship.id, .1);
  let phase: 'depart' | 'coast' | 'arrive' | 'done' = 'depart';
  for (let i = 0; i < 20000 && !runner.finished; i++) {
    const flight = read(), state = flight.state, orbit = flight.orbit!;
    const radius = Math.hypot(state.position.x, state.position.y), radial = (state.position.x * state.velocity.x + state.position.y * state.velocity.y) / radius;
    if (phase === 'depart' && orbit.apoapsis! / flight.body.radius >= 4) phase = 'coast';
    if (phase === 'coast' && radius / flight.body.radius > 3.9 && radial < 1) phase = 'arrive';
    if (phase === 'arrive' && orbit.eccentricity < .04 && orbit.periapsis / flight.body.radius > 3.7) phase = 'done';
    const heading = Math.atan2(state.velocity.y, state.velocity.x), error = Math.atan2(Math.sin(heading - state.heading), Math.cos(heading - state.heading));
    world.setControls(ship.id, { turn: Math.abs(error) > .025 ? Math.sign(error) : 0, throttle: 0, engine: phase === 'depart' || phase === 'arrive' });
    world.step(); runner.update(observeFlight(read()));
  }
  expect(phase).toBe('done'); expect(runner.finished).toBe(true); expect(read().orbit!.periapsis).toBeGreaterThan(3.6 * read().body.radius); world.dispose();
});
