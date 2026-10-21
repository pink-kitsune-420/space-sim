import { describe, expect, it } from 'vitest';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { buildTilePatch, SuccessorTiles, TILE_PATCH } from '../../apps/web/src/successor-tiles';
import { prepareGame } from '../../packages/modules/src/index';
import { querySurface } from '../../packages/sim-core/src/surface';
import { surfaceSupport } from '../../packages/sim-core/src/surface-flight';
import { discGroundClearance } from '../../packages/sim-core/src/surface-disc';
import type { Renderer, Vec } from '../../packages/game-api/src/index';

const successor = requestedBuiltinGame('?game=space-sim-successor');
function distance(p: Vec, a: Vec, b: Vec) {
  const x = b.x - a.x, y = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (x * x + y * y)));
  return Math.hypot(p.x - a.x - t * x, p.y - a.y - t * y);
}

describe('bounded successor tile presentation shares physical terrain', () => {
  it.each([2, 4, 8])('clips all sizes to the polar-linear contact field on both bodies at %ix', scale => {
    const { world, candidate } = prepareGame({ environment: 'node', data: successor.bundle.modules,
      profile: successor.bundle.profile, universeKey: successor.bundle.selection.universe,
      systemId: scale === 4 ? 'primus-system' : `primus-system-${scale}x` });
    try {
      for (const id of ['planet', 'moon']) {
        const profile = world.surface(id)!, pad = profile.pads.find(p => p.id === 'landing-area')!;
        const point = (p: Vec) => {
          const a = pad.angleRadians - Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
          return { x: p.x * c - (p.y + profile.referenceRadius) * s, y: p.x * s + (p.y + profile.referenceRadius) * c };
        };
        for (const size of [.25, .5, 1] as const) {
          const patch = buildTilePatch(profile, size, a => querySurface(profile, a).groundRadius);
          for (const site of ['ridge-lookout', 'basin-station']) {
            const ship = world.spawn({ ownerId: 'tile-review', presetId: `${id}-${site}` });
            expect(ship.state.status).toBe('landed');
            expect(Math.abs(discGroundClearance(profile, ship.state.position, 2.5).clearance)).toBeLessThan(1e-6);
          }
          expect(patch.chunks.length).toBeGreaterThan(5); expect(patch.chunks.length).toBeLessThanOrEqual(512);
          expect(patch.bytes).toBeLessThan(2_000_000);
          for (const p of patch.boundary) {
            const q = point(p), a = Math.atan2(q.y, q.x);
            expect(Math.hypot(q.x, q.y)).toBeCloseTo(querySurface(profile, a).groundRadius, 8);
          }
          // Independent radial queries between mesh vertices bound visible/contact error.
          for (let i = 1; i < patch.boundary.length; i++) {
            const a = point(patch.boundary[i - 1]!), b = point(patch.boundary[i]!);
            for (const t of [.25, .5, .75]) {
              const theta = Math.atan2(a.y + (b.y - a.y) * t, a.x + (b.x - a.x) * t);
              const r = querySurface(profile, theta).groundRadius;
              expect(distance({ x: r * Math.cos(theta), y: r * Math.sin(theta) }, a, b)).toBeLessThan(TILE_PATCH.tolerance * 1.001);
            }
          }
          for (const chunk of patch.chunks) {
            expect(chunk.tiles).toHaveLength(1024);
            expect(chunk.tiles.every(id => id >= 1 && id <= 4)).toBe(true);
            for (const v of chunk.clipPolygon!) {
              expect(v.x).toBeGreaterThanOrEqual(-1e-9); expect(v.y).toBeGreaterThanOrEqual(-1e-9);
              expect(v.x).toBeLessThanOrEqual(32 * size + 1e-9); expect(v.y).toBeLessThanOrEqual(32 * size + 1e-9);
              const p = point({ x: v.x + chunk.origin.x, y: v.y + chunk.origin.y });
              expect(Math.hypot(p.x, p.y) - querySurface(profile, Math.atan2(p.y, p.x)).groundRadius).toBeLessThan(TILE_PATCH.tolerance * 1.01);
            }
          }
          // Finite hull support at pad and slope: contact lies on the same clipped mesh.
          for (const arc of [0, 35, 65, -95, -175]) {
            const angle = pad.angleRadians - arc / profile.referenceRadius;
            const support = surfaceSupport(profile, angle, 2.5);
            if (!support) throw new Error('Missing physical hull support');
            const centre = { x: support.centerRadiusMetres! * Math.cos(angle), y: support.centerRadiusMetres! * Math.sin(angle) };
            const contact = discGroundClearance(profile, centre, 2.5);
            expect(Math.abs(contact.clearance)).toBeLessThan(1e-6);
            const r = querySurface(profile, contact.angle).groundRadius;
            const ground = { x: r * Math.cos(contact.angle), y: r * Math.sin(contact.angle) };
            let nearest = Infinity;
            for (let i = 1; i < patch.boundary.length; i++) nearest = Math.min(nearest,
              distance(ground, point(patch.boundary[i - 1]!), point(patch.boundary[i]!)));
            expect(nearest).toBeLessThan(TILE_PATCH.tolerance * 1.01);
            // Whole physical solver remains unchanged by building / selecting the tile size.
            expect(world.context.vehicle.contactRadiusMetres).toBe(2.5);
          }
        }
      }
    } finally { candidate.dispose(); }
  }, 15000);

  it('keeps cached geometry body-fixed, culls draw work and releases previous profile/size', () => {
    const { world, candidate } = prepareGame({ environment: 'node', data: successor.bundle.modules,
      profile: successor.bundle.profile, universeKey: successor.bundle.selection.universe });
    try {
      const profile = world.surface('planet')!, renderer: Renderer = { features: {
        tileChunks: { version: 1, rotation: true, clipPolygon: true }, tilePalettes: { register() {} } }, draw() {} };
      const tiles = new SuccessorTiles(), camera = { center: { x: 0, y: profile.referenceRadius }, rotation: 0, scale: 30 };
      const query = (a: number) => querySurface(profile, a).groundRadius;
      const a = tiles.draw(profile, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600);
      const saved = a.map(p => ({ origin: { ...p.origin }, tiles: p.tiles, clipPolygon: p.clipPolygon }));
      const resident = tiles.stats.residentChunks;
      expect(a.length).toBeGreaterThan(0); expect(a.length).toBeLessThan(24);
      const spin = Math.PI / 4, c = Math.cos(spin), s = Math.sin(spin);
      const rotatedCamera = { ...camera, center: { x: -profile.referenceRadius * s, y: profile.referenceRadius * c }, rotation: -spin };
      const b = tiles.draw(profile, () => { throw new Error('Rebuilt immutable field during draw'); }, renderer, { x: 0, y: 0 }, spin, rotatedCamera, 800, 600);
      expect(b).toHaveLength(saved.length);
      b.forEach((p, i) => {
        expect(p.tiles).toBe(saved[i]!.tiles); expect(p.clipPolygon).toBe(saved[i]!.clipPolygon);
        expect(p.origin.x).toBeCloseTo(saved[i]!.origin.x * c - saved[i]!.origin.y * s, 8);
        expect(p.origin.y).toBeCloseTo(saved[i]!.origin.x * s + saved[i]!.origin.y * c, 8);
      });
      expect(tiles.draw(profile, query, renderer, { x: 0, y: 0 }, 0, { ...camera, scale: .05 }, 800, 600)).toHaveLength(0);
      tiles.size = 1; tiles.draw(profile, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600);
      expect(tiles.stats.residentChunks).toBeLessThan(resident);
      tiles.size = 0; tiles.draw(profile, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600);
      expect(tiles.stats.bufferBytes).toBe(0);
      tiles.size = .5;
      expect(tiles.draw(profile, query, { draw() {} }, { x: 0, y: 0 }, 0, camera, 800, 600)).toHaveLength(0);
      expect(tiles.stats.mode).toContain('unsupported renderer');
    } finally { candidate.dispose(); }
  });
});
