import { describe, expect, it } from 'vitest';
import { DEFAULT_UNIVERSE, spinAngle } from '../../packages/sim-core/src/index';
import { World } from '../../packages/sim-core/src/world';
import { SPIN_HOLD_RADIANS_PER_FRAME, SpinView } from '../../apps/web/src/spin-view';

const FRAME = 1 / 60;

describe('spin view', () => {
  const world = new World(DEFAULT_UNIVERSE), bodies = world.system.getAllBodies(), primus = world.body('planet');

  it('draws the true angle at ordinary speeds', () => {
    const view = new SpinView();
    for (let i = 0; i <= 60; i++) view.update(bodies, i * FRAME * 100, FRAME, false);
    expect(view.holding.size).toBe(0);
    expect(view.angle(primus, 100)).toBeCloseTo(spinAngle(primus, 100), 12);
  });

  it('holds a body still while warp would strobe it, then eases back to the true angle', () => {
    const view = new SpinView();
    let time = 0;
    view.update(bodies, time, FRAME, false);
    // 10,000x: Primus would turn about 60° a frame.
    for (let i = 0; i < 30; i++) { time += FRAME * 10_000; view.update(bodies, time, FRAME, false); }
    expect(view.holding.has('planet')).toBe(true);
    const held = view.angle(primus, time);
    time += FRAME * 10_000; view.update(bodies, time, FRAME, false);
    expect(view.angle(primus, time)).toBeCloseTo(held, 9);
    // Bodies that turn slowly enough are still drawn as they are.
    expect(view.holding.has('moon')).toBe(SPIN_HOLD_RADIANS_PER_FRAME < 2 * Math.PI / 3297.8009 * FRAME * 10_000);

    // Back to real time: a smooth return, settled within half a second.
    time += FRAME; view.update(bodies, time, FRAME, false);
    expect(view.holding.has('planet')).toBe(false);
    const first = view.angle(primus, time);
    expect(Math.abs(first - held)).toBeLessThan(0.5);
    for (let i = 0; i < 40; i++) { time += FRAME; view.update(bodies, time, FRAME, false); }
    expect(view.angle(primus, time)).toBeCloseTo(spinAngle(primus, time), 9);
  });

  it('keeps a resting ship on the drawn ground', () => {
    const view = new SpinView();
    view.update(bodies, 0, FRAME, false);
    view.update(bodies, 5_000, FRAME, false);
    const ship = world.spawn({ ownerId: 'p' });
    const drawn = view.state({ ...world.ship(ship.id)!.state, time: 5_000 }, primus);
    const angle = view.angle(primus, 5_000);
    expect(drawn.position.x).toBeCloseTo(-512 * Math.sin(angle), 9);
    expect(drawn.position.y).toBeCloseTo(512 * Math.cos(angle), 9);
  });
});
