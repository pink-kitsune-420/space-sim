import { describe, expect, it } from 'vitest';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import { TileDemand, tileChartLayout, successorTileBody, MAX_DEMAND_SECTORS, MAX_SECTOR_TESTS } from '../../apps/web/src/successor-tile-demand';
import { buildTilePatch, TILE_PATCH } from '../../apps/web/src/successor-tile-patch';
import { MATERIAL_DOMAINS } from '../../apps/web/src/successor-materials';
import type { SurfaceProfile, Vec } from '../../packages/game-api/src/index';

const TAU = 2 * Math.PI;
function flat(radius: number): SurfaceProfile {
  return { ...createSurfaceProfile(radius, new Float64Array(64)),
    pads: [{ id: 'landing-area', angleRadians: Math.PI / 2, widthMetres: 16, elevationMetres: 0 }] };
}
function inside(point: Vec, polygon: readonly Vec[]): boolean {
  let odd = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j]!, b = polygon[i]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const dot = (point.x - a.x) * dx + (point.y - a.y) * dy;
    if (Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) < 1e-8
      && dot >= -1e-8 && dot <= dx * dx + dy * dy + 1e-8) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + (point.y - a.y) * dx / dy) odd = !odd;
  }
  return odd;
}

describe('camera-selected body-fixed surface demand', () => {
  it('contains every independently projected visible radial sample across seams, spins and rotated views', () => {
    const demand = new TileDemand(), origin = { x: 1e7, y: -2e6 }, spin = .73;
    let probes = 0;
    for (const radius of [256, 512, 2048, 4096]) {
      const profile = flat(radius), layout = tileChartLayout(profile);
      expect(layout.step * radius).toBeLessThanOrEqual(64);
      expect(layout.count % 4).toBe(0);
      for (const angle of [0, Math.PI / 2, Math.PI - 1e-7, -Math.PI + .01, 5.8]) {
        for (const rotation of [-1.1, 0, .7, Math.PI / 2]) for (const scale of [4, 10, 30]) {
          const camera = { center: { x: origin.x + (radius + 2.5) * Math.cos(angle + spin),
            y: origin.y + (radius + 2.5) * Math.sin(angle + spin) }, rotation, scale };
          demand.update(profile, origin, spin, camera, 1100, 800);
          expect(demand.overflow).toBe(false); expect(demand.count).toBeGreaterThan(0);
          expect(demand.count).toBeLessThanOrEqual(MAX_DEMAND_SECTORS); expect(demand.tested).toBeLessThanOrEqual(MAX_SECTOR_TESTS);
          for (let i = 0; i < 2048; i++) {
            const theta = i * TAU / 2048, r = radius - 8;
            const dx = origin.x + r * Math.cos(theta + spin) - camera.center.x;
            const dy = origin.y + r * Math.sin(theta + spin) - camera.center.y;
            const x = 550 + (dx * Math.cos(rotation) - dy * Math.sin(rotation)) * scale;
            const y = 400 - (dx * Math.sin(rotation) + dy * Math.cos(rotation)) * scale;
            if (x < 1 || x > 1099 || y < 1 || y > 799) continue;
            const relative = ((theta - layout.origin) % TAU + TAU) % TAU;
            const sector = Math.floor(relative / layout.step + .5) % layout.count;
            expect(demand.indices.subarray(0, demand.count).includes(sector)).toBe(true); probes++;
          }
        }
      }
    }
    expect(probes).toBeGreaterThan(1000);
  });

  it('keeps whole-body and off-surface views empty and bounds oversized work without allocation', () => {
    const profile = flat(512), demand = new TileDemand(), scratch = demand.indices;
    demand.update(profile, { x: 0, y: 0 }, 0, { center: { x: 0, y: 0 }, rotation: .5, scale: .3 }, 1200, 900);
    expect(demand.wholeBody).toBe(true); expect(demand.count).toBe(0);
    demand.update(profile, { x: 0, y: 0 }, 0, { center: { x: 1e6, y: 1e6 }, rotation: 0, scale: 30 }, 1200, 900);
    expect(demand.count).toBe(0);
    demand.update(profile, { x: 0, y: 0 }, 0, { center: { x: 0, y: 0 }, rotation: 0, scale: 0 }, 1200, 900);
    expect(demand.count).toBe(0); expect(demand.indices).toBe(scratch);
  });

  it('rejects excessive candidate and visible-sector work with the original fixed scratch', () => {
    const profile = flat(1e6), demand = new TileDemand(), indices = demand.indices;
    const camera = { center: { x: 0, y: 1e6 }, rotation: 0, scale: 4 };
    demand.update(profile, { x: 0, y: 0 }, 0, camera, 1e6, 1e6);
    expect(demand.overflow).toBe(true); expect(demand.reason).toBe('candidate work capacity');
    expect(demand.count).toBe(0); expect(demand.tested).toBe(0);
    demand.update(profile, { x: 0, y: 0 }, 0, camera, 20000, 1000);
    expect(demand.overflow).toBe(true); expect(demand.reason).toBe('visible sector capacity');
    expect(demand.count).toBe(0); expect(demand.tested).toBeLessThanOrEqual(MAX_SECTOR_TESTS);
    expect(demand.indices).toBe(indices);
  });

  it('selects the rendered body under the camera even with another preferred body', () => {
    const p = flat(2048), m = flat(512);
    const bodies = [{ id: 'planet', name: 'Primus', radius: 2048, surface: p, position: { x: 0, y: 0 } },
      { id: 'moon', name: 'Parvus', radius: 512, surface: m, position: { x: 100000, y: 20000 } }];
    expect(successorTileBody(bodies, { center: { x: 100000, y: 20514.5 }, rotation: .7, scale: 30 }, 1280, 900, 'planet')?.id).toBe('moon');
    expect(successorTileBody(bodies, { center: { x: 0, y: 2050.5 }, rotation: 0, scale: 30 }, 1280, 900, 'moon')?.id).toBe('planet');
    expect(successorTileBody(bodies, { center: { x: 50000, y: 0 }, rotation: 0, scale: 30 }, 1280, 900)).toBeUndefined();
  });

  it.each([.25, .5, 1] as const)('radial sectors share exact canonical seams and cover the full16m ribbon at %sm', size => {
    const profile = flat(512), layout = tileChartLayout(profile), radius = profile.referenceRadius;
    const patches = [0, 1, layout.count - 1].map(index => {
      const center = layout.origin + index * layout.step, half = radius * layout.step / 2;
      return buildTilePatch(profile, size, () => radius, MATERIAL_DOMAINS.planet, 'colored', center,
        { west: -half, east: half, radialDepth: true, anchorMuted: true });
    });
    for (const patch of patches) {
      expect(patch.bytes).toBeLessThan(2 * 1024 * 1024);
      for (let i = 1; i < 100; i++) for (const depth of [.01, 2, 8, 15.99]) {
        const delta = (i / 100 - .5) * layout.step;
        const point = { x: -(radius - depth) * Math.sin(delta), y: (radius - depth) * Math.cos(delta) - radius };
        expect(patch.chunks.some(chunk => inside({ x: point.x - chunk.origin.x, y: point.y - chunk.origin.y }, chunk.clipPolygon!))).toBe(true);
      }
      for (const chunk of patch.chunks) for (const p of chunk.clipPolygon!) {
        const r = Math.hypot(p.x + chunk.origin.x, p.y + chunk.origin.y + radius);
        expect(r).toBeGreaterThanOrEqual(radius - TILE_PATCH.depth - TILE_PATCH.tolerance * 1.1);
        expect(r).toBeLessThanOrEqual(radius + 1e-8);
      }
    }
    const world = (p: Vec, center: number): Vec => ({
      x: p.x * Math.sin(center) + (p.y + radius) * Math.cos(center),
      y: -p.x * Math.cos(center) + (p.y + radius) * Math.sin(center),
    });
    const a = world(patches[0]!.boundary[0]!, patches[0]!.centerAngle);
    const b = world(patches[1]!.boundary.at(-1)!, patches[1]!.centerAngle);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(1e-10);
  });
});
