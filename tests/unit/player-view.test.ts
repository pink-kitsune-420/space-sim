import { expect, it } from 'vitest';
import type { HudBinding, PlayerViewAdapter } from '../../packages/game-api/src/index';
import { createPlayerViews } from '../../modules/player-view/src/index';
import { createPlayerController } from '../../modules/player-controller/src/index';
import { createViewHud } from '../../modules/view-hud/src/index';
import { BoundedSurvey, surveyCameras } from '../../examples/bounded-survey/world';

const binding = (index = 0): HudBinding => ({ seatId: `seat-${index + 10}`, viewportId: `map-${index + 20}`,
  playerId: index ? 'surveyor-b' : 'surveyor-a', targetId: `marker-${index}`, session });
const session = {};
function part(events: string[], name: string, fail = false): PlayerViewAdapter {
  return { resource: {}, rebind(value) { events.push(`${name}:${value.targetId}`); if (fail) throw new Error('Rejected customization'); },
    release() { events.push(`${name}:release`); }, dispose() { events.push(`${name}:dispose`); } };
}
it('composes real per-player controls and cameras without advancing the world or sharing customization', () => {
  const world = new BoundedSurvey(), players = createPlayerViews(), cameras = surveyCameras();
  const a = createPlayerController(world.controls), b = createPlayerController(world.controls);
  const ca = cameras.create('map-20'), cb = cameras.create('map-21'), events: string[] = [];
  const one = players.create({ binding: binding(), adapters: { input: players.controller(a, 'owned'), camera: players.camera(ca), appearance: part(events, 'red') } });
  const two = players.create({ binding: binding(1), adapters: { input: players.controller(b, 'owned'), camera: players.camera(cb), appearance: part(events, 'blue') } });
  a.set('fixture.survey/move', 1); b.set('fixture.survey/move', -1);
  expect(world.tick).toBe(0); world.step(); expect([...world.positions]).toEqual([1, -1, 0, 0]);
  expect(ca.targetId).toBe('marker-0'); expect(cb.targetId).toBe('marker-1');
  one.configure({ ...one.adapters, appearance: part(events, 'green') });
  expect(events.filter(event => event.startsWith('blue:'))).toEqual(['blue:marker-1']);
  expect(two.binding.targetId).toBe('marker-1');
  one.dispose(); expect(() => a.set('fixture.survey/move', 1)).toThrow('disposed');
  b.set('fixture.survey/move', -1); world.step(); expect([...world.positions]).toEqual([1, -2, 0, 0]);
  ca.changeZoom(2); // Local views retain ownership of borrowed cameras.
  expect(ca.frame({ elapsed: 0, width: 800, height: 600, transform: world.transform }).scale).toBe(2);
  players.dispose(); players.dispose(); ca.dispose(); cb.dispose();
});
it('cancels every HUD gesture before any adapter sees a new controlled target', () => {
  const events: string[] = [], players = createPlayerViews();
  const hud = createViewHud({ binding: binding(), adapters: [], instruments: [{ id: 'fixture.dial', requires: [], create() {
    return { cancel() { events.push('hud:cancel'); }, rebind(value) { events.push(`hud:${value.targetId}`); }, resize() {}, update() {}, draw() {}, dispose() { events.push('hud:dispose'); } };
  } }] });
  const view = players.create({ binding: binding(), adapters: { input: part(events, 'input'), hud: players.hud(hud, 'owned') } });
  events.length = 0;
  view.bind({ ...view.binding, targetId: 'another-target' });
  expect(events.indexOf('hud:cancel')).toBeLessThan(events.indexOf('input:another-target'));
  expect(view.binding.targetId).toBe('another-target'); expect(hud.binding).toEqual(view.binding);
  const previous = view.binding; view.bind({ ...previous }); expect(view.binding).toBe(previous);
  expect(() => view.bind({ ...previous, seatId: 'other' })).toThrow('another seat');
  players.dispose(); expect(events.filter(event => event === 'hud:dispose')).toHaveLength(1);
});
it('rejects mutable resources shared between players or roles before running candidate adapters', () => {
  const players = createPlayerViews(), events: string[] = [], input = part(events, 'input');
  const one = players.create({ binding: binding(), adapters: { input } });
  const before = [...events];
  expect(() => players.create({ binding: binding(1), adapters: { input: { ...input } } })).toThrow('already in use');
  expect(() => one.configure({ input, camera: input })).toThrow('distinct resources');
  expect(() => one.configure({ camera: input })).toThrow('another role');
  expect(events).toEqual(before); players.dispose();
});
it('failed customization retains old parts, and a failed target rebind clears every part and resource claim', () => {
  const players = createPlayerViews(), events: string[] = [], input = part(events, 'input'), old = part(events, 'old');
  const view = players.create({ binding: binding(), adapters: { input, appearance: old } });
  expect(() => view.configure({ input, appearance: part(events, 'bad', true) })).toThrow('Rejected');
  expect(view.adapters.appearance).toBe(old); expect(events).toContain('bad:dispose');
  let broken = false;
  const changing = part(events, 'changing'), original = changing.rebind;
  changing.rebind = value => { if (broken) throw new Error('Lost target'); original(value); };
  view.configure({ input, appearance: changing }); broken = true;
  expect(() => view.bind({ ...view.binding, targetId: 'new-target' })).toThrow('Lost target');
  expect(view.adapters).toEqual({}); expect(events).toContain('input:dispose'); expect(events).toContain('changing:dispose');
  const fresh = players.create({ binding: binding(1), adapters: { input: { ...input } } });
  fresh.dispose(); view.dispose(); players.dispose();
});
it('standard adapters retain entity ownership checks and refuse a camera from another view', () => {
  const players = createPlayerViews(), world = new BoundedSurvey(), controller = createPlayerController(world.controls);
  expect(() => players.create({ binding: { ...binding(), playerId: 'stranger' }, adapters: { input: players.controller(controller) } })).toThrow();
  expect(controller.target).toBeUndefined();
  const camera = surveyCameras().create('another-view');
  expect(() => players.create({ binding: binding(), adapters: { camera: players.camera(camera) } })).toThrow('another viewport');
  camera.changeZoom(2); controller.dispose(); camera.dispose(); players.dispose();
});
