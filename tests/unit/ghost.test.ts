import { describe, expect, it } from 'vitest';
import { Clock, GHOST_ESCAPE_RADII, GHOST_MAX_K, GHOST_MAX_SAMPLES, IDLE, STEP, advance, elements, ghost, initialState,
  magnitude, planet, predict, propagate, type GhostEnd, type GhostSample, type State } from '../../packages/sim-core/src/index';

function pass(start: State, coarse = false): { samples: GhostSample[]; end: GhostEnd } {
  const samples: GhostSample[] = [];
  const job = ghost(start, coarse);
  for (let result = job.next(); ; result = job.next()) {
    if (result.done) return { samples, end: result.value };
    samples.push(result.value);
  }
}
const orbit = initialState('planet-orbit');
function flying(position: { x: number; y: number }, velocity: { x: number; y: number }): State {
  return { ...initialState(), status: 'flying', position, velocity };
}

describe('Quantized ghost preview', () => {
  it('traces exactly one revolution of a closed orbit with exact, quantized samples', () => {
    const { samples, end } = pass(orbit);
    const period = elements(orbit, planet.mu).period!;
    expect(end).toBe('closed');
    expect(samples.length).toBeGreaterThan(40);
    expect(samples.length).toBeLessThan(130);
    expect(samples.at(-1)!.time - orbit.time).toBeCloseTo(period, 9);
    expect(magnitude({ x: samples.at(-1)!.position.x - orbit.position.x,
      y: samples.at(-1)!.position.y - orbit.position.y })).toBeLessThan(1e-6);
    for (let i = 1; i < samples.length; i++) {
      const s = samples[i]!;
      const exact = propagate(orbit, planet.mu, s.time - orbit.time);
      if (!exact.ok) throw new Error('reference solve failed');
      expect(magnitude({ x: s.position.x - exact.state.position.x, y: s.position.y - exact.state.position.y }))
        .toBeLessThan(1e-9 * 640);
      // Quantized time: every step except the closing one is STEP * 2^k.
      const k = Math.log2((s.time - samples[i - 1]!.time) / STEP);
      if (i < samples.length - 1) {
        expect(Math.abs(k - Math.round(k))).toBeLessThan(1e-6);
        expect(Math.round(k)).toBeLessThanOrEqual(GHOST_MAX_K);
      }
    }
  });
  it('uses coarser steps during burns and keeps each step within its radius budget', () => {
    const fine = pass(orbit), coarse = pass(orbit, true);
    expect(coarse.end).toBe('closed');
    expect(coarse.samples.length).toBeLessThan(fine.samples.length * .7);
    for (const [{ samples }, reach] of [[fine, 1 / 8], [coarse, 1 / 4]] as const) {
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!, b = samples[i]!;
        const moved = magnitude({ x: b.position.x - a.position.x, y: b.position.y - a.position.y });
        expect(moved).toBeLessThanOrEqual(magnitude(a.position) * reach * 1.05);
      }
    }
  });
  it('ends a suborbital hop on the surface where the exact 10-ms stepper lands', () => {
    let hop: State = initialState();
    for (let i = 0; i < 120; i++) hop = advance(hop, { turn: -.35, throttle: .2, engine: true });
    expect(hop.status).toBe('flying');
    const { samples, end } = pass(hop);
    expect(end).toBe('impact');
    const touchdown = samples.at(-1)!;
    expect(magnitude(touchdown.position)).toBeCloseTo(planet.radius, 6);
    const stepped = [...predict(hop, 600)].at(-1)!;
    // Exact two-body ghost versus the live KDK integrator's contact point and time.
    expect(magnitude({ x: touchdown.position.x - stepped.position.x, y: touchdown.position.y - stepped.position.y }))
      .toBeLessThan(.25);
    expect(Math.abs(touchdown.time - stepped.time)).toBeLessThan(STEP * 1.5);
  });
  it('reports immediate contact, escape, the sample cap, grounded and failed passes', () => {
    const atSurface = pass(flying({ x: 0, y: planet.radius }, { x: 0, y: -3 }));
    expect(atSurface.end).toBe('impact');
    expect(atSurface.samples.at(-1)!.time).toBe(0);
    const escape = pass(flying({ x: 0, y: 640 }, { x: 400, y: 0 }));
    expect(escape.end).toBe('escape');
    expect(magnitude(escape.samples.at(-1)!.position)).toBeGreaterThan(planet.radius * GHOST_ESCAPE_RADII);
    expect(escape.samples.length).toBeLessThan(80); // steps grow with radius
    // Eccentric orbits up to e=0.94 still close within budget; the cap is only a bound.
    for (const speed of [200, 210, 215, 218, 220, 221]) {
      const eccentric = pass(flying({ x: 0, y: 520 }, { x: speed, y: 0 }));
      expect(eccentric.end).toBe('closed');
      expect(eccentric.samples.length).toBeLessThan(130);
      expect(eccentric.samples.length).toBeLessThanOrEqual(GHOST_MAX_SAMPLES);
    }
    const plunge = pass(flying({ x: 0, y: 600 }, { x: 1, y: 0 }));
    expect(plunge.end).toBe('impact');
    expect(magnitude(plunge.samples.at(-1)!.position)).toBeCloseTo(planet.radius, 6);
    expect(pass(initialState())).toEqual({ samples: [], end: 'grounded' });
    expect(pass({ ...orbit, status: 'crashed' }).end).toBe('grounded');
    expect(pass(flying({ x: 0, y: 640 }, { x: Infinity, y: 0 })).end).toBe('failed');
  });
  it('never mutates the live state and is unaffected by camera-only or throttle-only changes', () => {
    const start = advance(orbit);
    const frozen = JSON.stringify(start);
    const a = pass(start), b = pass({ ...start, heading: 1, throttle: 0 });
    expect(JSON.stringify(start)).toBe(frozen);
    expect(b).toEqual(a);
  });
});

describe('fixed-step presentation fraction', () => {
  it('reports the unconsumed fraction of the next step, clamped, and resets', () => {
    const clock = new Clock();
    let steps = 0;
    clock.advance(.025, () => steps++);
    expect(steps).toBe(2);
    expect(clock.alpha).toBeCloseTo(.5, 9);
    clock.advance(.004, () => steps++);
    expect(clock.alpha).toBeCloseTo(.9, 9);
    clock.reset();
    expect(clock.alpha).toBe(0);
    clock.advance(.2, () => steps++); // 20 steps: the catch-up cap leaves no remainder here
    expect(clock.alpha).toBeGreaterThanOrEqual(0);
    expect(clock.alpha).toBeLessThanOrEqual(1);
    expect(IDLE.engine).toBe(false);
  });
});
