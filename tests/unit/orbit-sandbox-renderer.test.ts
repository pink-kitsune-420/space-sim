import { describe, expect, it, vi } from 'vitest';
import { createDefaultSolarSystem } from '../../apps/orbit-sandbox/src/presets';
import { renderScene, type RendererState } from '../../apps/orbit-sandbox/src/renderer';
import type { SlingshotCandidate } from '../../apps/orbit-sandbox/src/types';

vi.mock('../../apps/orbit-sandbox/src/spacelab/render-2d', async importOriginal => ({
  ...await importOriginal<typeof import('../../apps/orbit-sandbox/src/spacelab/render-2d')>(),
  getActiveTheme: () => ({ highQuality: false }),
}));

function scene() {
  const text: string[] = [];
  const ctx = new Proxy({ fillText: (label: string) => text.push(label), measureText: (label: string) => ({ width: label.length * 6 }) }, {
    get(target, key) { return Reflect.get(target, key) ?? (() => {}); },
  }) as unknown as CanvasRenderingContext2D;
  const draw = vi.fn();
  const state = { canvas: { clientWidth: 1000, clientHeight: 700 }, ctx, glRenderer: { draw },
    camera: { center: { x: 0, y: 0 }, scale: .01, rotation: 0 },
    selectedBodyId: null, hoveredBodyId: null, isEditingRings: false,
    showOrbitLines: true, showOrbitApsides: true, showBodyLabels: true } as unknown as RendererState;
  const bodies = createDefaultSolarSystem().slice(0, 3);
  for (const [i, body] of bodies.entries()) {
    body.position = { x: i * 2000, y: i * 3000 }; body.radius = 100; body.trail = [];
    body.isFixed = i === 0;
    if (i > 0) body.orbitCache = { parentBodyId: bodies[0]!.id, epochTime: 0,
      semiMajorAxis: 15000, eccentricity: .3, periapsisRadius: 10000, apoapsisRadius: 20000,
      orbitalPeriod: 1000, isBound: true, relativeOrbitPoints: [{ x: 10000, y: 0 }, { x: -20000, y: 0 }],
      periapsisOffset: { x: 10000, y: 0 }, apoapsisOffset: { x: -20000, y: 0 } };
  }
  return { state, bodies, text, draw };
}

describe('sandbox scene annotations', () => {
  it('draws planet names once, suppresses flight visuals and respects quality', () => {
    const { state, bodies, text, draw } = scene();
    renderScene(state, bodies, null, 0);
    for (const body of bodies) expect(text.filter(value => value === body.name)).toHaveLength(1);
    expect(draw.mock.calls[0]![0]).toMatchObject({ showBodyLabels: false, showShipLabels: false,
      showShip: false, showPad: false, showScale: false, theme: { highQuality: false } });
    state.showBodyLabels = false; text.length = 0;
    renderScene(state, bodies, null, 0);
    for (const body of bodies) expect(text).not.toContain(body.name);
  });

  it('keeps the hovered name readable when bodies project to the same label position', () => {
    const { state, bodies, text } = scene();
    bodies[2]!.position = { ...bodies[1]!.position };
    state.hoveredBodyId = bodies[2]!.id;
    renderScene(state, bodies, null, 0);
    expect(text).toContain(bodies[2]!.name);
    expect(text).not.toContain(bodies[1]!.name);
  });

  it('only annotates the selected orbit, including while another body is hovered', () => {
    const { state, bodies, text } = scene();
    state.hoveredBodyId = bodies[2]!.id;
    renderScene(state, bodies, null, 0);
    expect(text.filter(value => value === 'Pe' || value === 'Ap')).toEqual([]);
    state.selectedBodyId = bodies[1]!.id; text.length = 0;
    renderScene(state, bodies, null, 0);
    expect(text.filter(value => value === 'Pe' || value === 'Ap')).toEqual(['Pe', 'Ap']);
    state.showOrbitApsides = false; text.length = 0;
    renderScene(state, bodies, null, 0);
    expect(text.filter(value => value === 'Pe' || value === 'Ap')).toEqual([]);
  });

  it('limits a multi-orbit launch preview to the first periapsis and apoapsis', () => {
    const { state, bodies, text } = scene();
    const candidate: SlingshotCandidate = { origin: { x: 0, y: 0 }, currentDrag: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 }, currentSpeed: 0, circularSpeed: 0, isSnappingCircular: false,
      presetId: 'oceanic', parentBody: bodies[0]!, apoapsisRadius: 20000, periapsisRadius: 10000, orbitalPeriod: 1000,
      ghostPath: Array.from({ length: 12 }, (_, i) => ({ position: { x: i * 1000, y: 0 }, velocity: { x: 0, y: 0 },
        time: i * 100, isPeriapsis: i % 2 === 0, isApoapsis: i % 2 !== 0 })) };
    renderScene(state, bodies, candidate, 0);
    expect(text.filter(value => value === 'Pe' || value === 'Ap')).toEqual(['Pe', 'Ap']);
  });
});
