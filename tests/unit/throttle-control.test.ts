import { describe, expect, it } from 'vitest';
import { PilotThrottle } from '../../apps/web/src/throttle-control';
import { DEFAULT_CONTROLLER_PROFILE, normalizeProfile, readPad } from '../../apps/web/src/gamepad';

const idle = { turn: 0, throttle: 0, engine: false };

describe('persistent throttle ramp', () => {
  it('gives fine taps, ramps without a repeat delay and persists on release', () => {
    const t = new PilotThrottle();
    expect(t.update({ ...idle, throttle: 1 }, 0, .5, .5)).toBe(.01);
    expect(t.engine).toBe(true);
    expect(t.update({ ...idle, throttle: 1 }, .1, .01, .5)).toBeCloseTo(.0305, 12);
    expect(t.update(idle, .016, .03, .5)).toBeUndefined();
    expect(t.engine).toBe(true);
    expect(t.update({ ...idle, throttle: -.2 }, 0, .03, .5)).toBeCloseTo(.028);
    expect(t.update({ ...idle, throttle: -.2 }, .1, .028, .5)).toBeCloseTo(.0239, 12);
    const takeover = new PilotThrottle();
    expect(takeover.update({ ...idle, throttle: 1 }, 0, .4, .5, true, true)).toBeCloseTo(.41);
  });

  it('ramps equally at different frame rates, preserves sub-percent changes and bounds stalls', () => {
    for (const frames of [20, 60, 144]) {
      const t = new PilotThrottle();
      let value = t.update({ ...idle, throttle: 1 }, 0, 0, .5)!;
      for (let i = 0; i < frames; i++) value = t.update({ ...idle, throttle: 1 }, 1 / frames, value, .5)!;
      expect(value).toBeCloseTo(.26, 12);
      value = t.update({ ...idle, throttle: 1 }, 10, value, .5)!;
      expect(value).toBeCloseTo(.335, 12);
      expect(t.update({ ...idle, throttle: 1 }, -1, value, .5)).toBeUndefined();
      const longHold = new PilotThrottle();
      value = longHold.update({ ...idle, throttle: 1 }, 0, 0, .5)!;
      for (let i = 0; i < frames * 3; i++) value = longHold.update({ ...idle, throttle: 1 }, 1 / frames, value, .5)!;
      expect(value).toBeCloseTo(.86, 12);
    }
  });

  it('accelerates both directions gently, caps the speed, and resets on release, reversal and fine mode', () => {
    for (const sign of [-1, 1]) {
      const t = new PilotThrottle(); t.set(.5);
      let value = .5;
      // Stay away from the end stops while checking rates at and beyond the cap.
      t.update({ ...idle, throttle: sign }, 0, value, .5);
      for (let i = 0; i < 4; i++) value = t.update({ ...idle, throttle: sign }, .25, .5, .5)!;
      expect(value - .5).toBeCloseTo(sign * .071875, 12);
      expect(t.update({ ...idle, throttle: sign }, .25, .5, .5)! - .5).toBeCloseTo(sign * .075, 12);
      expect(t.update({ ...idle, throttle: -sign }, 0, .5, .5)).toBeCloseTo(.5 - sign * .01, 12);
      expect(t.update({ ...idle, throttle: -sign }, .1, .5, .5)).toBeCloseTo(.5 - sign * .0205, 12);
      for (let i = 0; i < 8; i++) t.update({ ...idle, throttle: -sign }, .25, .5, .5);
      expect(t.update({ ...idle, throttle: -sign * .2 }, .1, .5, .5)).toBeCloseTo(.5 - sign * .0041, 12);
      t.update(idle, .1, .5, .5);
      expect(t.update({ ...idle, throttle: sign }, 0, .5, .5)).toBeCloseTo(.5 + sign * .01, 12);
      expect(t.update({ ...idle, throttle: sign }, .1, .5, .5)).toBeCloseTo(.5 + sign * .0205, 12);
      t.release();
      expect(t.update({ ...idle, throttle: 1 }, 0, 0, .5)).toBe(.01);
      expect(t.update({ ...idle, throttle: 1 }, .1, .01, .5)).toBeCloseTo(.0305, 12);
    }
  });

  it('does not apply frame time from before a keyboard press', () => {
    const t = new PilotThrottle();
    t.update(idle, .2, 0, .5, false, false, 1);
    let value = t.update({ ...idle, throttle: 1 }, 0, 0, .5, true, false, 1.19)!;
    expect(value).toBe(.01);
    value = t.update({ ...idle, throttle: 1 }, .2, value, .5, false, false, 1.2)!;
    expect(value).toBeCloseTo(.012005, 12);
  });

  it('clamps at both ends, cuts at zero and handles opposing keys returning to neutral', () => {
    const t = new PilotThrottle(); t.set(.999);
    expect(t.update({ ...idle, throttle: 1 }, 0, .999, .5)).toBe(1);
    expect(t.update({ ...idle, throttle: -1 }, 0, .005, .5)).toBe(0);
    expect(t.engine).toBe(false);
    expect(t.update(idle, 0, 0, .5)).toBeUndefined();
    expect(t.engine).toBe(false);
  });

  it('cut suppresses held controls until neutral; recall and short taps work afterward', () => {
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
    expect(t.update({ ...idle, throttle: 1 }, 0, 0, .23, true)).toBe(.01);
    expect(t.update({ ...idle, throttle: 1 }, 0, .01, .23, true)).toBe(.02);
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
