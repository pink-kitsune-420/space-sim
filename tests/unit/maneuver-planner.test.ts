import { describe, expect, it } from 'vitest';
import type { Camera, GhostSample, PresentationView } from '../../packages/game-api/src/index';
import { maneuverDelta, drawManeuver } from '../../packages/modules/src/base/toolset/maneuver-planner';
import { maneuverWarpFactor, pickManeuverTime } from '../../apps/web/src/maneuver-planner';
import { validateOverlay } from '../../packages/game-runtime/src/index';
import { navballState, drawNavball } from '../../packages/modules/src/base/toolset/navball';
import { project } from '../../packages/render-2d/src/frame';

const camera: Camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };
const origin = { x: 0, y: 0 };
const a: GhostSample = { time: 0, position: { x: -100, y: 0 }, velocity: { x: 20, y: 40 } };
const b: GhostSample = { time: 10, position: { x: 100, y: 0 }, velocity: { x: 20, y: -40 } };
const view: PresentationView = {
  time: 0, tick: 0, paused: true, elapsed: 0, viewport: { width: 800, height: 600, pixelRatio: 1 },
  body: { id: 'planet', name: 'Planet', radius: 50, mu: 1e6, position: origin },
  vehicle: { acceleration: 10, turnRate: 1, initialThrottle: 1 }, analyticOrbits: true, orbit: null,
  groundClearance: 50, prediction: { status: 'closed', samples: 2 }, moduleState: {}, camera,
  ship: { id: 's', name: 'Ship', bodyId: 'planet', state: { time: 0, position: a.position, velocity: a.velocity, heading: 0, throttle: 1, status: 'flying', revision: 0 },
    position: a.position, controls: { turn: 0, throttle: 0, engine: false } },
};

describe('maneuver planning', () => {
  it('picks the rendered Hermite arc between samples, with camera rotation and body translation', () => {
    // At t=1/2 the curve is 100 m above the chord: a vertex/chord picker would miss it.
    const shifted = { x: 1e10, y: -2e10 };
    const rotated = { center: shifted, rotation: .7, scale: 1.4 };
    const pointer = project({ x: shifted.x, y: shifted.y + 100 }, rotated, 800, 600);
    const time = pickManeuverTime([a, b], false, 0, pointer, rotated, shifted, 800, 600);
    expect(time).toBeCloseTo(5, 2);
    expect(pickManeuverTime([a, b], false, 0, { x: 400, y: 300 }, camera, origin, 800, 600)).toBeUndefined();
  });
  it('rolls an old closed preview into the next future passage, and never selects past open paths', () => {
    const pointer = { x: 400, y: 200 };
    expect(pickManeuverTime([a, b], true, 32, pointer, camera, origin, 800, 600)).toBeCloseTo(35, 2);
    expect(pickManeuverTime([a, b], false, 32, pointer, camera, origin, 800, 600)).toBeUndefined();
    expect(pickManeuverTime([a, { ...b, linear: true }], false, 0, pointer, camera, origin, 800, 600)).toBeUndefined();
  });
  it('combines velocity-relative prograde and position-relative radial burns on eccentric orbits', () => {
    const sample = { time: 0, position: { x: 5, y: 0 }, velocity: { x: 3, y: 4 } };
    const delta = maneuverDelta(sample, 10, 4);
    expect(delta).toEqual({ x: 10, y: 8 });
    expect(Math.hypot(delta.x, delta.y)).toBeCloseTo(Math.sqrt(164));
    expect(maneuverDelta(sample, -10, -4)).toEqual({ x: -10, y: -8 });
    expect(maneuverDelta({ ...sample, velocity: { x: 0, y: 0 } }, 0, 4)).toEqual({ x: 4, y: 0 });
  });
  it('leaves at least half the approach window unused even after a long frame stall', () => {
    for (const seconds of [.01, .25, .3, 1, 2, 30, 100, 1000, 1e6]) {
      const warp = maneuverWarpFactor(seconds);
      expect(warp).toBeLessThanOrEqual(10_000);
      if (warp > 1) expect(.1 * warp).toBeLessThanOrEqual(seconds / 2);
    }
    expect(maneuverWarpFactor(0)).toBe(1);
    expect(maneuverWarpFactor(-100)).toBe(1);
  });
  it('renders bounded valid overlays and shows the burn direction in the navball', () => {
    const planned: PresentationView = { ...view, maneuver: { time: 5, position: a.position, deltaVelocity: { x: 3, y: 4 },
      burnSeconds: .5, valid: true, path: Array.from({ length: 1000 }, (_, i) => ({ ...a, time: i })) } };
    const primitives = drawManeuver(planned);
    expect(() => validateOverlay(primitives)).not.toThrow();
    expect(primitives.length).toBeLessThan(170);
    const nav = navballState(planned, 'orbit')!;
    expect(nav.maneuver).toBeCloseTo(Math.atan2(4, 3));
    expect(drawNavball(nav, { x: 100, y: 100 }, 0, 'horizon').some(p => p.color === '#f7c775')).toBe(true);
    expect(navballState({ ...planned, maneuver: { ...planned.maneuver!, valid: false } }, 'orbit')?.maneuver).toBeUndefined();
    expect(drawManeuver(view)).toEqual([]);
  });
});
