import { describe, expect, it } from 'vitest';
import type { PresentationSnapshot, State, Vec } from '../../packages/game-api/src/index';
import { validateOverlay } from '../../packages/game-runtime/src/index';
import { autoFrame, drawNavball, navballFootprint, navballState, wrapAngle } from '../../modules/navball/src/drawing';
import { screenOverlays } from '../../packages/render-2d/src/index';

const R = 512, SPIN = -2 * Math.PI / 600;
const deg = (radians: number): number => radians * 180 / Math.PI;
function view(position: Vec, velocity: Vec, heading = 0, extra: { spin?: number; status?: State['status']; clearance?: number | null } = {}): PresentationSnapshot {
  const state: State = { time: 0, position, velocity, heading, throttle: 0, status: extra.status ?? 'flying', revision: 0 };
  return { time: 0, tick: 0, paused: false, elapsed: .016, viewport: { width: 800, height: 600, pixelRatio: 1 },
    body: { id: 'planet', name: 'Primus', radius: R, mu: 13_107_200, position: { x: 0, y: 0 }, ...(extra.spin ? { spin: extra.spin } : {}) },
    ship: { id: 's', name: 'S', bodyId: 'planet', state, controls: { turn: 0, throttle: 0, engine: false }, position },
    vehicle: { acceleration: 125, turnRate: 1.2, initialThrottle: .5 }, analyticOrbits: true, orbit: null,
    groundClearance: extra.clearance === undefined ? Math.hypot(position.x, position.y) - R : extra.clearance,
    prediction: { status: 'none', samples: 0 }, moduleState: {} };
}

describe('navball state', () => {
  it('points the zenith away from the body and the nadir toward it at every side', () => {
    for (const [position, zenith] of [[{ x: 0, y: 640 }, 90], [{ x: 0, y: -640 }, -90], [{ x: -640, y: 0 }, 180], [{ x: 640, y: 0 }, 0]] as const) {
      const s = navballState(view(position, { x: 0, y: 0 }), 'orbit')!;
      expect(Math.abs(deg(wrapAngle(s.zenith - zenith * Math.PI / 180)))).toBeLessThan(1e-9);
      expect(Math.abs(deg(wrapAngle(s.nadir - s.zenith)))).toBeCloseTo(180, 9);
    }
  });
  it('measures pitch from the forward horizon: +90 up, 0 ahead, -90 down, 180 behind', () => {
    // Clockwise orbit at the top of the body: ahead is +X.
    const at = { x: 0, y: 640 }, v = { x: 143, y: 0 };
    expect(navballState(view(at, v, Math.PI / 2), 'orbit')!.pitch).toBeCloseTo(90, 9);
    expect(navballState(view(at, v, 0), 'orbit')!.pitch).toBeCloseTo(0, 9);
    expect(navballState(view(at, v, -Math.PI / 2), 'orbit')!.pitch).toBeCloseTo(-90, 9);
    expect(Math.abs(navballState(view(at, v, Math.PI), 'orbit')!.pitch)).toBeCloseTo(180, 9);
    expect(navballState(view(at, v, Math.PI / 4), 'orbit')!.pitch).toBeCloseTo(45, 9);
    // Counter-clockwise motion flips which horizon is ahead.
    const ccw = navballState(view(at, { x: -143, y: 0 }, Math.PI * 3 / 4), 'orbit')!;
    expect(ccw.forward).toBe(1);
    expect(ccw.pitch).toBeCloseTo(45, 9);
    // On the side of the body, "up" is +X.
    expect(navballState(view({ x: 640, y: 0 }, { x: 0, y: -143 }, 0), 'orbit')!.pitch).toBeCloseTo(90, 9);
  });
  it('separates orbital and surface velocity on a rotating body', () => {
    const at = { x: 0, y: R }, ground = { x: -SPIN * at.y, y: SPIN * at.x };
    // Resting on the ground: carried at ω × r, so it moves in ORB and is still in SRF.
    const resting = view(at, ground, Math.PI / 2, { spin: SPIN, status: 'landed', clearance: 0 });
    const orb = navballState(resting, 'orbit')!, srf = navballState(resting, 'surface')!;
    expect(orb.speed).toBeCloseTo(Math.abs(SPIN) * R, 9);
    expect(deg(orb.prograde!)).toBeCloseTo(0, 9); // spin is clockwise: ground at the top moves +X
    expect(srf.speed).toBeCloseTo(0, 9);
    expect(srf.prograde).toBeUndefined();
    expect(srf.steering).toBeUndefined();
    // At rest, ahead is the way the ground turns (east), so straight up is +90 in both.
    expect(srf.forward).toBe(-1);
    expect(srf.pitch).toBeCloseTo(90, 9);
    // Climbing straight up from the pad: surface prograde is vertical, orbital prograde leans east.
    const climb = view(at, { x: ground.x, y: 20 }, Math.PI / 2, { spin: SPIN });
    expect(deg(navballState(climb, 'surface')!.prograde!)).toBeCloseTo(90, 9);
    expect(deg(navballState(climb, 'orbit')!.prograde!)).toBeCloseTo(deg(Math.atan2(20, ground.x)), 9);
    expect(deg(navballState(climb, 'orbit')!.retrograde!)).toBeCloseTo(deg(Math.atan2(-20, -ground.x)), 9);
  });
  it('takes the shortest steering turn across ±π', () => {
    const at = { x: 0, y: 640 };
    // Nose at 170°, prograde at -170°: the short way is +20°, not -340°.
    const v = { x: Math.cos(-170 * Math.PI / 180) * 100, y: Math.sin(-170 * Math.PI / 180) * 100 };
    expect(deg(navballState(view(at, v, 170 * Math.PI / 180), 'orbit')!.steering!)).toBeCloseTo(20, 9);
    expect(deg(navballState(view(at, v, -150 * Math.PI / 180), 'orbit')!.steering!)).toBeCloseTo(-20, 9);
    expect(wrapAngle(3 * Math.PI)).toBeCloseTo(Math.PI, 12);
  });
  it('switches the auto frame with hysteresis, and to surface on the ground', () => {
    const at = (clearance: number) => view({ x: 0, y: R + clearance }, { x: 100, y: 0 }, 0, { clearance });
    expect(autoFrame(at(.1 * R), 'orbit')).toBe('surface');
    expect(autoFrame(at(.15 * R), 'orbit')).toBe('orbit');
    expect(autoFrame(at(.15 * R), 'surface')).toBe('surface');
    expect(autoFrame(at(.2 * R), 'surface')).toBe('orbit');
    expect(autoFrame(view({ x: 0, y: R }, { x: 0, y: 0 }, 0, { status: 'landed', clearance: 0 }), 'orbit')).toBe('surface');
    expect(navballState({ ...at(0), ship: undefined }, 'orbit')).toBeUndefined();
  });
});

describe('navball dial', () => {
  it('keeps phone readout lines separated at the unscaled font size and inside the shared footprint', () => {
    const state = navballState(view({ x: 0, y: 640 }, { x: 143, y: 0 }), 'orbit')!;
    const center = { x: 200, y: 150 }, scale = .65;
    const primitives = drawNavball(state, center, 0, 'horizon', undefined, 'P2', scale, 'Alt 128 m · Pe 128 m · Ap 128 m');
    const lines = primitives.filter(p => p.kind === 'text' && p.at.y > center.y);
    expect(lines).toHaveLength(4);
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i]!, previous = lines[i - 1]!;
      if (line.kind === 'text' && previous.kind === 'text') expect(line.at.y - previous.at.y).toBeGreaterThanOrEqual(14);
    }
    const footprint = navballFootprint(scale, true);
    for (const line of lines) if (line.kind === 'text') expect(line.at.y).toBeLessThan(center.y + footprint.below);
  });
  it('stays within the overlay limits and draws in screen space', () => {
    const s = navballState(view({ x: 0, y: 640 }, { x: 143, y: 0 }, 1), 'orbit')!;
    const primitives = validateOverlay(drawNavball(s, { x: 400, y: 450 }, Math.PI / 2 - s.zenith, 'horizon'));
    expect(primitives.length).toBeLessThan(128);
    expect(primitives.every(p => p.space === 'screen')).toBe(true);
    // Horizon-up: the sky half lies above the centre on screen.
    const sky = primitives.find(p => p.kind === 'line' && p.fill)!;
    const ys = (sky as { points: readonly Vec[] }).points.map(p => p.y);
    expect(Math.max(...ys)).toBeCloseTo(450, 6);
    expect(Math.min(...ys)).toBeCloseTo(450 - 52, 6);
  });
});

describe('filled overlay outlines', () => {
  it('validate and become clipped convex polygons', () => {
    expect(() => validateOverlay([{ kind: 'line', space: 'screen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }], color: '#ffffff', fill: true }]))
      .toThrow('at least three points');
    expect(() => validateOverlay([{ kind: 'line', space: 'screen', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], color: '#ffffff', fill: 1 }]))
      .toThrow('fill must be boolean');
    const square = validateOverlay([{ kind: 'line', space: 'screen', color: '#ffffff', closed: true, fill: true,
      points: [{ x: -500, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: -500, y: 300 }] }]);
    const [polygon] = screenOverlays(square, { center: { x: 0, y: 0 }, rotation: 0, scale: 1 }, 800, 600);
    expect(polygon!.kind).toBe('polygon');
    const xs = (polygon as { points: readonly Vec[] }).points.map(p => p.x);
    expect(Math.min(...xs)).toBe(-64); // cut at the margin outside the view
    expect(Math.max(...xs)).toBe(300);
    expect(screenOverlays(validateOverlay([{ kind: 'line', space: 'screen', color: '#ffffff', fill: true,
      points: [{ x: -900, y: 0 }, { x: -800, y: 0 }, { x: -800, y: 50 }] }]), { center: { x: 0, y: 0 }, rotation: 0, scale: 1 }, 800, 600)).toEqual([]);
  });
});
