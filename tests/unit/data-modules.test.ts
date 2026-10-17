import { describe, expect, it } from 'vitest';
import gentle from '../../examples/modules/gentle-flight.json';
import type { Controls, GhostEnd, GhostSample } from '../../packages/game-api/src/index';
import { DEFAULT_PROFILE, applyDataModules, createBuiltinRegistry, exportDataModule, parseDataModule, prepareGame, profileWithData, validateDataModule } from '../../packages/modules/src/index';
import { parseModuleImport } from '../../apps/web/src/modules';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { createSimulationContext } from '../../packages/sim-core/src/context';
import { IDLE, STEP } from '../../packages/sim-core/src/constants';
import { saveWorld, loadWorld } from '../../packages/sim-core/src/save';
import { HostSession } from '../../packages/net/src/host';
import { loopback } from '../../packages/net/src/connection';
import { BUILTIN_UNIVERSES } from '../../packages/scenarios/builtin';

const defaultKey = `builtin.content/${DEFAULT_UNIVERSE.id}`;
function collect(job: Generator<GhostSample, GhostEnd>) {
  const samples: GhostSample[] = [];
  for (;;) { const next = job.next(); if (next.done) return { samples, end: next.value }; samples.push(next.value); }
}
function customized(data: unknown, authority: 'authoritative' | 'presentation' = 'authoritative') {
  return validateDataModule({ ...gentle, manifest: { ...gentle.manifest, authority }, data });
}
describe('built-in module composition', () => {
  for (const [name, universe] of Object.entries(BUILTIN_UNIVERSES)) it(`${name}: resolved motion remains exactly equal to legacy composition`, () => {
    const prepared = prepareGame({ environment: 'node', universe });
    const resolved = prepared.world, legacy = new World(universe);
    prepared.runtime.activate(prepared.candidate);
    for (const preset of resolved.system.presets.slice(0, 3)) {
      const options = { ownerId: 'pilot', presetId: preset.id, godMode: true };
      resolved.spawn(options); legacy.spawn(options);
    }
    for (let tick = 0; tick < 240; tick++) {
      const controls: Controls = tick < 90 ? { turn: .3, throttle: .4, engine: true } : IDLE;
      resolved.setControls('ship-1', controls); legacy.setControls('ship-1', controls);
      expect(resolved.step()).toEqual(legacy.step());
      expect(resolved.ships()).toEqual(legacy.ships());
    }
    expect(saveWorld(resolved)).toEqual(saveWorld(legacy));
    const restored = loadWorld(JSON.parse(JSON.stringify(saveWorld(resolved))), {
      createContext: createBuiltinRegistry().prepare(DEFAULT_PROFILE, 'node').service('motion'),
    }).world;
    // Save codecs intentionally omit transient solver diagnostics; compare the saved
    // state and continuation to an independently restored legacy-composed world.
    const restoredLegacy = loadWorld(JSON.parse(JSON.stringify(saveWorld(legacy)))).world;
    expect(saveWorld(restored)).toEqual(saveWorld(resolved));
    for (let tick = 0; tick < 100; tick++) {
      expect(restored.step()).toEqual(restoredLegacy.step());
      expect(restored.ships()).toEqual(restoredLegacy.ships());
    }
    restoredLegacy.dispose(); restored.dispose(); resolved.dispose(); legacy.dispose();
    expect(prepared.candidate.available).toBe(false);
  });
});
describe('player-authored data', () => {
  it('changes new-world motion and prediction together, round trips data/profile and restores compatible saves/networking', () => {
    const module = parseDataModule(JSON.stringify(gentle));
    expect(parseDataModule(exportDataModule(module))).toEqual(module);
    const prepared = prepareGame({ environment: 'offline', data: [module] });
    prepared.runtime.activate(prepared.candidate);
    const world = prepared.world;
    const ship = world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' });
    expect(world.context.vehicle).toEqual({ acceleration: 75, turnRate: .6, initialThrottle: .5 });
    const expected = createSimulationContext(world.context.vehicle), controls = { turn: .5, throttle: .2, engine: true };
    world.setControls(ship.id, controls);
    const next = expected.advance(ship.state, controls, STEP, world.body(ship.bodyId));
    world.step();
    expect(world.ship(ship.id)!.state).toEqual(next);
    const clone = world.context.cloneForPrediction();
    expect(collect(clone.predict(next, false, world.body(ship.bodyId)))).toEqual(collect(expected.predict(next, false, world.body(ship.bodyId))));
    expect(saveWorld(world).lock).toEqual(world.lock);
    expect(world.soloPreview).toBe(false);
    const host = new HostSession(world), [connection] = loopback();
    expect(() => host.accept(connection)).not.toThrow();
    connection.close();
    const bundle = parseModuleImport(JSON.stringify({ format: 'space-sim-module-profile/1', profile: prepared.profile,
      modules: [module], selection: { universe: defaultKey, system: world.systemId } }));
    expect(bundle.format).toBe('space-sim-module-profile/1');
    if (bundle.format !== 'space-sim-module-profile/1') throw new Error('unexpected import');
    const again = prepareGame({ environment: 'node', data: bundle.modules, profile: bundle.profile,
      universeKey: bundle.selection.universe, systemId: bundle.selection.system });
    expect(again.world.context.modelIdentity).toBe(world.context.modelIdentity);
    again.candidate.dispose(); clone.dispose(); expected.dispose(); world.dispose();
  });
  it('does not activate installed data unless the profile enables it', () => {
    const prepared = prepareGame({ environment: 'node', data: [validateDataModule(gentle)], profile: DEFAULT_PROFILE });
    expect(prepared.world.context.vehicle.acceleration).toBe(125);
    expect(prepared.world.soloPreview).toBe(false);
    prepared.world.dispose();
  });
  it('names bad settings and rejects arbitrary patches, conflicting writes, false authority and missing dependencies', () => {
    for (const settings of [{ acceleration: -1 }, { turnRate: Infinity }, { initialThrottle: 2 }, { 'world.gravity': 5 }, { constructor: 1 }]) {
      expect(() => customized({ vehicle: { override: true, settings } })).toThrow(/example.gentle-flight setting/);
    }
    expect(() => customized({ patches: [{ path: 'world.gravity', value: 10 }] })).toThrow('unknown field patches');
    expect(() => customized({ vehicle: { settings: { acceleration: 75 } } })).toThrow('override: true');
    expect(() => customized(gentle.data, 'presentation')).toThrow('authoritative scope');
    const a = validateDataModule(gentle), b = validateDataModule({ ...gentle, manifest: { ...gentle.manifest, id: 'example.conflict' } });
    expect(() => prepareGame({ environment: 'node', data: [a, b] })).toThrow('conflicting override vehicle:acceleration');
    const profile = profileWithData([a]);
    expect(() => prepareGame({ environment: 'node', data: [a], profile: { ...profile,
      modules: profile.modules.filter(m => m.id !== 'builtin.motion') } })).toThrow('missing dependency builtin.motion');
  });
  it('adds namespaced universes and presets, validates replacement targets and keeps appearance physics compatible', () => {
    const source = structuredClone(DEFAULT_UNIVERSE);
    const addition = customized({ universes: [{ definition: source }] });
    const key = `example.gentle-flight/${source.id}`;
    const game = prepareGame({ environment: 'node', data: [addition], universeKey: key });
    expect(game.world.universe.id).toBe(source.id); game.world.dispose();
    const p = DEFAULT_UNIVERSE.systems[0]!.presets[0]!;
    const presets = customized({ presets: [{ universe: defaultKey, system: DEFAULT_UNIVERSE.defaultSystemId,
      preset: { ...p, id: 'gentle-pad', name: 'Gentle pad' } }] });
    const presetGame = prepareGame({ environment: 'node', data: [presets] });
    expect(presetGame.world.spawn({ ownerId: 'pilot', presetId: 'gentle-pad' }).state.status).toBe('landed');
    presetGame.world.dispose();
    expect(() => prepareGame({ environment: 'node', data: [customized({ presets: [{ universe: defaultKey,
      system: DEFAULT_UNIVERSE.defaultSystemId, preset: p }] })] })).toThrow('requires override');
    const appearance = customized({ appearance: [{ universe: defaultKey, system: DEFAULT_UNIVERSE.defaultSystemId,
      body: 'planet', override: true, colors: { color: '#112233' } }] }, 'presentation');
    const visual = prepareGame({ environment: 'node', data: [appearance] });
    expect(visual.world.body('planet').color).toBe('#112233');
    expect(visual.world.soloPreview).toBe(false);
    expect(visual.world.context.modelIdentity).toBe(createSimulationContext().modelIdentity);
    expect(() => saveWorld(visual.world)).not.toThrow(); visual.world.dispose();
    expect(DEFAULT_UNIVERSE.systems[0]!.bodies[0]!.color).not.toBe('#112233');
    expect(() => applyDataModules(new Map([[defaultKey, DEFAULT_UNIVERSE]]), [customized({ universes: [{ definition: source,
      target: 'builtin.content/absent', override: true }] })])).toThrow('unknown universe override');
  });
});
