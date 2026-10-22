import { describe, expect, it } from 'vitest';
import type { Camera, Renderer, Vec } from '../../packages/game-api/src/index';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { SuccessorTiles } from '../../apps/web/src/successor-tiles';
import { SuccessorTileStore } from '../../apps/web/src/successor-tile-store';
import { prepareGame } from '../../packages/modules/src/index';
import { createSurfaceProfile, querySurface } from '../../packages/sim-core/src/surface';

const game = requestedBuiltinGame('?game=space-sim-successor');
const renderer: Renderer = { draw() {}, features: { tileChunks: { version: 1, rotation: true, clipPolygon: true }, tilePalettes: { register() {} } } };
const setup = () => prepareGame({ environment: 'node', data: game.bundle.modules,
  profile: game.bundle.profile, universeKey: game.bundle.selection.universe });
function contains(points: readonly Vec[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]!, b = points[j]!;
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

describe('camera-selected successor tile presenter', () => {
  it('covers actual remote visible canonical ground with transformed clipped tiles on both bodies', () => {
    const { world, candidate } = setup();
    try {
      for (const id of ['planet', 'moon'] as const) for (const size of [.25, .5, 1] as const) {
        const p = world.surface(id)!, tiles = new SuccessorTiles(); tiles.size = size;
        tiles.targetAngle = p.pads[0]!.angleRadians; // Navigation remains elsewhere.
        const query = (a: number) => querySurface(p, a).groundRadius;
        for (const angle of [-2.9, .3, 2.8]) {
          const spin = .73, rotation = -.4, r = query(angle), origin = { x: 123, y: -456 };
          const cam: Camera = { center: { x: origin.x + r * Math.cos(angle + spin), y: origin.y + r * Math.sin(angle + spin) }, rotation, scale: 8 / size };
          const chunks = tiles.draw(p, query, renderer, origin, spin, cam, 640, 480, id);
          expect(chunks.length).toBeGreaterThan(0); expect(tiles.stats.pending).toBe(false);
          expect(chunks.length).toBeLessThanOrEqual(200);
          let checked = 0;
          for (let i = -18; i <= 18; i++) for (const depth of [2, 8, 14]) {
            const a = angle + i * .9 / (cam.scale * p.referenceRadius), radius = query(a) - depth;
            const x = origin.x + radius * Math.cos(a + spin), y = origin.y + radius * Math.sin(a + spin);
            const dx = x - cam.center.x, dy = y - cam.center.y;
            const sx = 320 + (dx * Math.cos(rotation) - dy * Math.sin(rotation)) * cam.scale;
            const sy = 240 - (dx * Math.sin(rotation) + dy * Math.cos(rotation)) * cam.scale;
            if (sx < 1 || sx > 639 || sy < 1 || sy > 479) continue;
            checked++;
            expect(chunks.some(chunk => {
              const d = chunk.rotationRadians!, c = Math.cos(d), s = Math.sin(d);
              const wx = x - chunk.origin.x, wy = y - chunk.origin.y;
              return contains(chunk.clipPolygon!, wx * c + wy * s, -wx * s + wy * c);
            }), `${id}/${size}/${angle}/${i}/${depth}`).toBe(true);
          }
          expect(checked).toBeGreaterThan(0);
          expect(tiles.stats.bufferBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
        }
        tiles.clear(); expect(tiles.store.stats.bufferBytes).toBe(0);
      }
    } finally { candidate.dispose(); }
  });

  it('shares immutable content while transforms and overview release stay view-local', () => {
    const { world, candidate } = setup();
    try {
      const p = world.surface('planet')!, store = new SuccessorTileStore(), a = new SuccessorTiles(store), b = new SuccessorTiles(store);
      const query = (angle: number) => querySurface(p, angle).groundRadius;
      const camera = { center: { x: 0, y: query(Math.PI / 2) }, scale: 30, rotation: 0 };
      const first = a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600);
      const x = first[0]!.origin.x, y = first[0]!.origin.y, cells = first[0]!.tiles, builds = store.stats.totalBuilds;
      const second = b.draw(p, () => { throw new Error('Duplicated shared build'); }, renderer, { x: 0, y: 0 }, Math.PI / 2,
        { ...camera, center: { x: -camera.center.y, y: 0 }, rotation: -Math.PI / 2 }, 800, 600);
      expect(second[0]!.tiles).toBe(cells); expect(second[0]).not.toBe(first[0]);
      expect(first[0]!.origin).toEqual({ x, y }); expect(store.stats.totalBuilds).toBe(builds);
      a.draw(p, query, renderer, { x: 0, y: 0 }, 0, { ...camera, scale: .001 }, 800, 600);
      expect(a.stats.bufferBytes).toBe(0); expect(store.stats.bufferBytes).toBeGreaterThan(0);
      expect(second[0]!.tiles).toBe(cells);
      b.clear(); expect(store.stats.bufferBytes).toBe(0); expect(store.stats.leases).toBe(0);
      for (const view of [a, b]) {
        const wrappers = (view as unknown as { wrappers: { tiles: Uint16Array; clipPolygon?: readonly Vec[] }[] }).wrappers;
        expect(wrappers.every(w => w.tiles.length === 0 && !w.clipPolygon)).toBe(true);
      }
    } finally { candidate.dispose(); }
  });

  it('keeps complete coarse backing during FIFO generation, cancels pan demand and survives world retirement', () => {
    const { world, candidate } = setup();
    try {
      const p = world.surface('moon')!, store = new SuccessorTileStore(), view = new SuccessorTiles(store);
      const query = (angle: number) => querySurface(p, angle).groundRadius;
      const camera = { center: { x: 0, y: query(Math.PI / 2) }, scale: 4, rotation: 0 };
      store.beginFrame();
      expect(view.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon')).toHaveLength(0);
      expect(view.stats.fineRequests).toBeGreaterThan(1); expect(store.stats.builds).toBe(1); expect(view.stats.pending).toBe(true);
      store.endFrame();
      // New camera has disjoint sectors; queued jobs from the previous camera disappear.
      camera.center = { x: query(0), y: 0 };
      for (let i = 0; i < 20; i++) {
        store.beginFrame(); view.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon');
        expect(store.stats.builds).toBeLessThanOrEqual(1); store.endFrame();
        if (!view.stats.pending) break;
      }
      expect(view.stats.visibleChunks).toBeGreaterThan(0); expect(store.stats.queuedSectors).toBe(0);
      store.clear();
      expect(view.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon')).toHaveLength(0);
      expect(view.stats.pending).toBe(true); // Retirement cannot bypass this frame's exhausted budget.
      for (let i = 0; i < 20 && view.stats.pending; i++) {
        store.beginFrame(); view.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); store.endFrame();
      }
      expect(view.stats.visibleChunks).toBeGreaterThan(0);
      view.clear(); expect(store.stats.bufferBytes).toBe(0);
    } finally { candidate.dispose(); }
  });
  it('retains complete coarse backing without queries or residency on demand overflow', () => {
    const base = createSurfaceProfile(1e6, new Float64Array(64));
    const profile = { ...base, pads: [{ id: 'landing-area', angleRadians: Math.PI / 2, widthMetres: 16, elevationMetres: 0 }] };
    const view = new SuccessorTiles(), camera = { center: { x: 0, y: 1e6 }, rotation: 0, scale: 4 };
    const query = () => { throw new Error('Generated terrain after demand exceeded its finite work cap'); };
    expect(view.draw(profile, query, renderer, { x: 0, y: 0 }, 0, camera, 1e6, 1e6)).toHaveLength(0);
    expect(view.stats.mode).toContain('candidate work capacity');
    expect(view.stats.fineRequests).toBe(0); expect(view.store.stats.bufferBytes).toBe(0);
    expect(view.draw(profile, query, renderer, { x: 0, y: 0 }, 0, camera, 20000, 1000)).toHaveLength(0);
    expect(view.stats.mode).toContain('visible sector capacity'); expect(view.store.stats.queuedSectors).toBe(0);
  });

});
