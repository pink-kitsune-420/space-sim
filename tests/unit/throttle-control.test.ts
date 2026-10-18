import { describe, expect, it } from 'vitest';
import { PilotThrottle } from '../../apps/web/src/throttle-control';
import { DEFAULT_CONTROLLER_PROFILE, normalizeProfile, readPad } from '../../apps/web/src/gamepad';

const idle = { turn: 0, throttle: 0, engine: false };

describe('persistent throttle steps', () => {
  it('starts at zero instead of the hidden preset, repeats after a delay and persists on release', () => {
    const t = new PilotThrottle();
    expect(t.update({ ...idle, throttle: 1 }, .016, .5, .5)).toBe(.05);
    expect(t.engine).toBe(true);
    expect(t.update({ ...idle, throttle: 1 }, .2, .05, .5)).toBeUndefined();
    expect(t.update({ ...idle, throttle: 1 }, .16, .05, .5)).toBe(.1);
    expect(t.update(idle, .016, .1, .5)).toBeUndefined();
    expect(t.engine).toBe(true);
    expect(t.update({ ...idle, throttle: -.2 }, .016, .1, .5)).toBe(.09);
    const takeover = new PilotThrottle();
    expect(takeover.update({ ...idle, throttle: 1 }, 0, .4, .5, true, true)).toBe(.45);
  });

  it('clamps steps at both ends and cuts at zero', () => {
    const t = new PilotThrottle(); t.set(.99);
    expect(t.update({ ...idle, throttle: 1 }, 0, .99, .5)).toBe(1);
    expect(t.update({ ...idle, throttle: -1 }, 0, .02, .5)).toBe(0);
    expect(t.engine).toBe(false);
    expect(t.update(idle, 0, 0, .5)).toBeUndefined();
    expect(t.engine).toBe(false);
  });

  it('cut suppresses a held burn and steps until neutral; recall and held activation work afterward', () => {
    const t = new PilotThrottle(); t.set(.3); t.cut();
    expect(t.update({ ...idle, throttle: 1, engine: true }, .1, 0, .23)).toBeUndefined();
    expect(t.engine).toBe(false);
    t.update(idle, 0, 0, .23);
    t.set(.23); t.update(idle, 0, .23, .23);
    expect(t.engine).toBe(true);
    t.cut(); t.update(idle, 0, 0, .23);
    expect(t.update({ ...idle, engine: true }, 0, 0, .23)).toBe(.23);
    expect(t.engine).toBe(true);
    t.update(idle, 0, .23, .23);
    expect(t.engine).toBe(false);
    t.cut(false);
    expect(t.update({ ...idle, throttle: 1 }, 0, 0, .23, true)).toBe(.05);
    expect(t.update({ ...idle, throttle: 1 }, 0, .05, .23, true)).toBe(.1);
  });

  it('releases burns on ship/world binding changes and lifecycle cleanup', () => {
    const t = new PilotThrottle(), world = {};
    t.bind(world, 'one'); t.set(.2); t.bind(world, 'one');
    t.update(idle, 0, .2, .5); expect(t.engine).toBe(true);
    t.bind(world, 'two'); t.update(idle, 0, .2, .5); expect(t.engine).toBe(false);
    t.set(.2); t.bind({}, 'two'); expect(t.burning).toBe(false);
    t.set(.2); t.release(); expect(t.burning).toBe(false);
  });

  it('migrates the old default D-pad collision and A burn without discarding custom mappings', () => {
    const migrated = normalizeProfile({ buttons: { engine: [0, 7], throttleUp: [12], throwShip: [12] } });
    expect(migrated.buttons.throwShip).toEqual([]);
    expect(migrated.buttons.engine).toEqual([7]);
    expect(migrated.buttons.throttleRecall).toEqual([0]);
    const custom = normalizeProfile({ buttons: { engine: [0], camera: [11], warpUp: [6] } });
    expect(custom.buttons.throttleRecall).toEqual([]);
    expect(custom.buttons.throttleCut).toEqual([]);
    expect(custom.buttons.throttleFine).toEqual([]);
    expect(normalizeProfile({ buttons: { throttleRecall: [0], throwShip: [12] } }).buttons.throwShip).toEqual([12]);
    expect(normalizeProfile({ buttons: { throwShip: [2], engine: [3] } }).buttons.throwShip).toEqual([2]);
    const buttons = Array.from({ length: 18 }, (_, i) => ({ pressed: i === 12 || i === 6, value: 0, touched: false }));
    expect(readPad({ axes: [0, 0], buttons }, DEFAULT_CONTROLLER_PROFILE).throttle).toBe(.2);
  });
});
