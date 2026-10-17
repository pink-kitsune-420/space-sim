import { describe, expect, it } from 'vitest';
import type { RegisteredModule, WorldRuleExtension, WorldRuleHook } from '../../packages/game-api/src/index';
import { deterministicMath } from '../../packages/game-api/src/index';
import { captureWorldRules } from '../../packages/game-runtime/src/rules';
import { DEFAULT_PROFILE, builtinManifest, prepareGame } from '../../packages/modules/src/index';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { IDLE } from '../../packages/sim-core/src/constants';
import { saveWorld } from '../../packages/sim-core/src/save';
import { HostSession } from '../../packages/net/src/host';
import { loopback } from '../../packages/net/src/connection';
import { scheduledCutoff } from '../../examples/modules/rules';
import { Prediction } from '../../apps/web/src/prediction';

const hook = (extra: Partial<WorldRuleHook> = {}): WorldRuleHook => ({ modelIdentity: 'count/v1',
  initialState: { version: 1, value: 0 }, seed: 7,
  evaluate: ({ state }) => ({ state: { version: 1, value: (state.value as number) + 1 } }), ...extra });
const extension = (h = hook(), moduleId = 'test.rule'): WorldRuleExtension => ({ moduleId, version: '0.1.0', hook: h });
const module = (id: string, h: WorldRuleHook): RegisteredModule => ({ manifest: builtinManifest(id, []), initialize: c => c.contributeWorldRule(h) });

describe('staged shared-world rules', () => {
  it('runs once per tick with detached candidates, explicit time and the public deterministic math', () => {
    let calls = 0;
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension(hook({ evaluate(input) {
      expect(input.tick).toBe(calls++); expect(input.time).toBeCloseTo(calls * .01, 12);
      expect(input.seconds).toBe(.01); expect(input.ships).toHaveLength(2);
      expect(input.ships[0]!.state.time).toBe(input.time);
      expect(input.math.sin(12345)).toBe(deterministicMath.sin(12345));
      expect(Object.isFrozen(input.ships[0]!.state.position)).toBe(true);
      return { state: { version: 1, value: calls } };
    } }))] });
    w.spawn({ ownerId: 'pilot' }); w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    for (let n = 0; n < 5; n++) w.step();
    expect(w.moduleState['test.rule']!.state.value).toBe(5);
    expect(w.context.capabilities.analyticCoast).toBe(false); expect(w.asleepCount).toBe(0);
    w.dispose();
  });

  it('stages commands in resolved order, applying them at the next motion boundary', () => {
    const calls: string[] = [];
    const code = ['test.z', 'test.a'].map(id => module(id, hook({ evaluate({ ships }) {
      calls.push(id);
      return { state: { version: 1, value: 0 }, commands: [{ shipId: ships[0]!.id, throttle: id === 'test.z' ? .8 : .2 }] };
    } })));
    const p = prepareGame({ environment: 'node', code, profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, ...code.map(m => ({ id: m.manifest.id, version: m.manifest.version }))] } });
    p.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    expect(p.world.step()).toEqual([]); expect(calls).toEqual(['test.a', 'test.z']);
    expect(p.world.ship('ship-1')!.state.throttle).toBe(.8);
    expect(p.world.moduleState['test.a']!.state.value).toBe(0);
    p.candidate.dispose();
  });

  it('matches an independent xorshift32 oracle, interleaves worlds and clones RNG without live mutation', () => {
    const h = hook({ evaluate: ({ random }) => ({ state: { version: 1, value: random() } }) });
    const a = new World(DEFAULT_UNIVERSE, { rules: [extension(h)] });
    const b = new World(DEFAULT_UNIVERSE, { rules: [extension(h)] });
    a.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' }); b.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    let expected = 7;
    for (let n = 0; n < 30; n++) {
      expected ^= expected << 13; expected ^= expected >>> 17; expected ^= expected << 5; expected >>>= 0;
      a.step(); b.step();
      expect(a.moduleState['test.rule']).toEqual({ state: { version: 1, value: expected / 2 ** 32 }, randomState: expected });
      expect(b.moduleState).toEqual(a.moduleState);
    }
    const before = a.moduleState, clone = a.cloneForPrediction();
    clone.step(); expect(a.moduleState).toBe(before);
    a.step(); expect(clone.moduleState).toEqual(a.moduleState); expect(clone.ships()).toEqual(a.ships());
    a.dispose(); b.dispose(); clone.dispose();
  });

  it('rolls back the entire candidate, all namespaces, events, commands and RNG on a shared failure', () => {
    const good = hook({ evaluate: ({ ships, random }) => ({ state: { version: 1, value: random() },
      commands: [{ shipId: ships[0]!.id, throttle: 1 }] }) });
    const bad = hook({ evaluate() { throw new Error('shared proposal failed'); } });
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension(good, 'test.first'), extension(bad, 'test.second')] });
    const s = w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const before = { state: w.moduleState, version: w.version, tick: w.tick, time: w.time };
    w.trackChanges = true; w.takeChanges();
    expect(w.step()).toEqual([{ type: 'world-fault', message: expect.stringContaining('test.second worldRule.evaluate tick 0') }]);
    expect(w.paused).toBe(true); expect(w.ship(s.id)).toBe(s);
    expect(w.moduleState).toBe(before.state); expect(w.version).toBe(before.version);
    expect(w.tick).toBe(before.tick); expect(w.time).toBe(before.time);
    expect(w.previous(s.id)).toBeUndefined(); expect(w.takeChanges()).toEqual({ changed: [], removed: [] });
    expect(w.step()).toEqual([]); expect(w.ship(s.id)).toBe(s);
    w.reset(); expect(w.paused).toBe(false); expect(w.fault).toBeUndefined();
    w.dispose();
  });

  it('retains per-ship fault isolation while committing a successful shared rule', () => {
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension()] });
    const s = w.spawn({ ownerId: 'pilot' }); w.put({ ...s, state: { ...s.state, position: { x: NaN, y: 0 } } });
    w.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    expect(w.step()).toMatchObject([{ type: 'fault', shipId: s.id }]);
    expect(w.tick).toBe(1); expect(w.paused).toBe(false);
    expect(w.ship('ship-2')!.state.time).toBe(.01); expect(w.moduleState['test.rule']!.state.value).toBe(1);
    w.dispose();
  });

  for (const invalid of [
    { state: { version: 1, value: NaN } },
    { state: { version: 2, value: 0 } },
    { state: { version: 1, value: 0 }, commands: [{ shipId: 'missing', throttle: 1 }] },
    { state: { version: 1, value: 0 }, commands: [{ shipId: 'ship-1', throttle: Infinity }] },
    { state: { version: 1, value: 0 }, commands: [{ shipId: 'ship-1', controls: { turn: 2, throttle: 0, engine: false } }] },
    { state: { version: 1, value: 0 }, commands: [{ shipId: 'ship-1', position: { x: 0, y: 0 } }] },
    Promise.resolve({ state: { version: 1, value: 0 } }),
  ]) it('rejects invalid/async shared results atomically', () => {
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension(hook({ evaluate: () => invalid as ReturnType<WorldRuleHook['evaluate']> }))] });
    const s = w.spawn({ ownerId: 'pilot' }); const state = w.moduleState;
    expect(w.step()).toMatchObject([{ type: 'world-fault' }]);
    expect(w.moduleState).toBe(state); expect(w.ship(s.id)).toBe(s); expect(w.tick).toBe(0);
    w.dispose();
  });

  it('rejects input mutation and RNG access outside the evaluation boundary', () => {
    let random: (() => number) | undefined;
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension(hook({ evaluate(input) {
      random = input.random; input.random();
      Object.assign(input.ships[0]!.state.position, { x: 42 });
      return { state: input.state };
    } }))] });
    const s = w.spawn({ ownerId: 'pilot' });
    expect(w.step()).toMatchObject([{ type: 'world-fault' }]); expect(w.ship(s.id)).toBe(s);
    expect(() => random!()).toThrow('outside rule evaluation');
    expect(w.moduleState['test.rule']!.randomState).toBe(7); w.dispose();
  });

  it('predicts the stateful scheduled cutoff through the same isolated world schedule', () => {
    const p = prepareGame({ environment: 'node', code: [scheduledCutoff], profile: { ...DEFAULT_PROFILE,
      modules: [...DEFAULT_PROFILE.modules, { id: scheduledCutoff.manifest.id, version: '0.1.0' }] } });
    const ship = p.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    const stateBeforeForecast = p.world.moduleState;
    const job = p.world.predictShip(ship.id); job.next();
    expect(p.world.moduleState).toBe(stateBeforeForecast);
    for (let n = 0; n < 110; n++) {
      p.world.step();
      expect(job.next().value).toMatchObject({ position: p.world.ship(ship.id)!.state.position, velocity: p.world.ship(ship.id)!.state.velocity });
    }
    // Forecasting does not consume live RNG or alter live state; cancellation disposes it.
    const state = p.world.moduleState;
    const preview = new Prediction(() => {});
    preview.update(p.world.context, p.world.ship(ship.id)!.state, p.world.body(ship.bodyId), undefined, ship.id, 0, false, IDLE, p.world);
    expect(p.world.moduleState).toBe(state); preview.invalidate();
    expect(() => saveWorld(p.world)).toThrow('solo previews');
    const [connection] = loopback(); expect(() => new HostSession(p.world).accept(connection)).toThrow('cannot host multiplayer');
    job.return('open'); p.candidate.dispose();
  });

  it('applies shared commands on the next step and invalidates previews on external controls', () => {
    const w = new World(DEFAULT_UNIVERSE, { rules: [extension(hook({ evaluate: ({ state }) => ({ state,
      commands: [{ shipId: 'ship-1', controls: { turn: 0, throttle: 0, engine: true } }] }) }))] });
    const s = w.spawn({ ownerId: 'pilot' }); w.setThrottle(s.id, 1);
    w.step(); expect(w.ship(s.id)!.state.status).toBe('landed');
    w.step(); expect(w.ship(s.id)!.state.status).toBe('flying');
    const preview = new Prediction(() => {});
    const update = () => preview.update(w.context, w.ship(s.id)!.state, w.body(s.bodyId), undefined, s.id, 0, false, IDLE, w);
    update(); w.step(); update(); expect(preview.passCount).toBe(1);
    w.setThrottle(s.id, .7); update(); expect(preview.passCount).toBe(2);
    preview.invalidate(); w.dispose();
  });

  it('captures immutable schedules, differentiates models and rejects invalid seeds and late registration', () => {
    expect(() => captureWorldRules([extension(hook({ seed: 0 }))])).toThrow('seed');
    expect(() => captureWorldRules([extension(), extension()])).toThrow('duplicate');
    const a = new World(DEFAULT_UNIVERSE, { rules: [extension()] });
    const b = new World(DEFAULT_UNIVERSE, { rules: [extension(hook({ seed: 8 }))] });
    expect(a.context.modelIdentity).not.toBe(b.context.modelIdentity);
    expect(() => Object.assign(a.context, { modelIdentity: 'mid-flight replacement' })).toThrow();
    const p = prepareGame({ environment: 'node' });
    expect(() => p.candidate.contributeWorldRule('test.rule', '0.1.0', hook())).toThrow('late');
    const visual = module('test.visual', hook());
    expect(() => prepareGame({ environment: 'node', code: [{ ...visual, manifest: { ...visual.manifest, authority: 'presentation' } }],
      profile: { ...DEFAULT_PROFILE, modules: [...DEFAULT_PROFILE.modules, { id: 'test.visual', version: '0.1.0' }] } })).toThrow('authoritative');
    a.dispose(); b.dispose(); p.candidate.dispose();
  });
});
