import { describe, expect, it } from 'vitest';
import { appearanceAt, APPEARANCE_IDS, MATERIAL_DOMAINS, MATERIAL_PALETTES, MATERIAL_SLOTS, materialPalette } from '../../apps/web/src/successor-materials';
import { buildTilePatch, SuccessorTiles, TILE_PALETTE } from '../../apps/web/src/successor-tiles';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame } from '../../packages/modules/src/index';
import { querySurface } from '../../packages/sim-core/src/surface';
import type { Renderer } from '../../packages/game-api/src/index';

describe('successor decorative material identity', () => {
  it('classifies fixed metre addresses across resolutions, negative coordinates and chunk seams', () => {
    for (const domain of Object.values(MATERIAL_DOMAINS)) {
      const found = new Set<string>();
      for (let x = -257; x <= 193; x++) for (let y = -19; y <= 19; y++) {
        const expected = appearanceAt(domain, x + .5, y + .5); found.add(expected);
        for (const size of [.25, .5, 1]) for (let i = 0; i < 1 / size; i++) for (let j = 0; j < 1 / size; j++) {
          expect(appearanceAt(domain, x + (i + .5) * size, y + (j + .5) * size)).toBe(expected);
        }
      }
      expect([...found].sort()).toEqual([...APPEARANCE_IDS].sort());
      // Floor, rather than truncation, is observable immediately left of zero.
      expect(appearanceAt(domain, -.001, -4.001)).toBe(appearanceAt(domain, -.5, -4.5));
    }
  });

  it('preserves semantic colors under arbitrary slot permutation and isolates body palettes', () => {
    const reordered = [APPEARANCE_IDS[2], APPEARANCE_IDS[0], APPEARANCE_IDS[1]];
    for (const domain of Object.values(MATERIAL_DOMAINS)) {
      const palette = materialPalette(domain, reordered);
      for (const id of APPEARANCE_IDS) expect(palette[reordered.indexOf(id) + 1]).toBe(domain.colors[id]);
      expect(palette[0]).toBe('#00000000');
      expect(Object.isFrozen(domain.colors)).toBe(true);
    }
    expect(MATERIAL_DOMAINS.planet.id).not.toBe(MATERIAL_DOMAINS.moon.id);
    expect(MATERIAL_PALETTES.planet).not.toEqual(MATERIAL_PALETTES.moon);
  });

  it.each([2, 4, 8])('derives actual cells from the same domain and retains exact muted geometry at %ix', scale => {
    const game = requestedBuiltinGame('?game=space-sim-successor');
    const { world, candidate } = prepareGame({ environment: 'node', data: game.bundle.modules,
      profile: game.bundle.profile, universeKey: game.bundle.selection.universe,
      systemId: scale === 4 ? 'primus-system' : `primus-system-${scale}x` });
    try {
      for (const body of ['planet', 'moon'] as const) for (const size of [.25, .5, 1] as const) {
        const profile = world.surface(body)!, domain = MATERIAL_DOMAINS[body];
        const query = (a: number) => querySurface(profile, a).groundRadius;
        const colored = buildTilePatch(profile, size, query, domain);
        const muted = buildTilePatch(profile, size, query, domain, 'muted');
        expect(colored.boundary).toEqual(muted.boundary);
        expect(colored.bytes).toBe(muted.bytes);
        colored.chunks.forEach((chunk, index) => {
          expect(chunk.clipPolygon).toEqual(muted.chunks[index]!.clipPolygon);
          expect(chunk.paletteId).toBe(domain.id);
          // Independently address cells by their physical coordinates, not display indices.
          for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
            const id = appearanceAt(domain, chunk.origin.x + (x + .5) * size, chunk.origin.y + (y + .5) * size);
            expect(MATERIAL_SLOTS[chunk.tiles[y * 32 + x]! - 1]).toBe(id);
            const gx = chunk.origin.x / size + x, gy = chunk.origin.y / size + y;
            const hash = Math.imul(gx, 374761393) ^ Math.imul(gy, 668265263);
            expect(muted.chunks[index]!.tiles[y * 32 + x]).toBe(1 + ((hash ^ (hash >>> 13)) >>> 0) % 4);
          }
        });
      }
    } finally { candidate.dispose(); }
  }, 20000);

  it('keeps cells across camera/renderer changes and registers the correct palette on body/style switches', () => {
    const game = requestedBuiltinGame('?game=space-sim-successor');
    const { world, candidate } = prepareGame({ environment: 'node', data: game.bundle.modules,
      profile: game.bundle.profile, universeKey: game.bundle.selection.universe });
    const registrations: { id: string; colors: readonly string[] }[] = [];
    const renderer = (): Renderer => ({ draw() {}, features: { tileChunks: { version: 1, rotation: true, clipPolygon: true },
      tilePalettes: { register(id, colors) { registrations.push({ id, colors }); } } } });
    try {
      const tiles = new SuccessorTiles(), a = renderer(), b = renderer();
      for (const body of ['planet', 'moon'] as const) {
        const profile = world.surface(body)!, query = (angle: number) => querySurface(profile, angle).groundRadius;
        const camera = { center: { x: 0, y: profile.referenceRadius }, rotation: 0, scale: 30 };
        const chunks = tiles.draw(profile, query, a, { x: 0, y: 0 }, 0, camera, 800, 600, body);
        const cells = chunks.map(c => c.tiles);
        const noBuild = () => { throw new Error('Unexpected rebuild'); };
        const replaced = tiles.draw(profile, noBuild, b, { x: 0, y: 0 }, 0, camera, 800, 600, body);
        expect(replaced.map(c => c.tiles)).toEqual(cells);
        replaced.forEach((c, i) => expect(c.tiles).toBe(cells[i]));
        const spin = Math.PI / 2;
        const rotated = tiles.draw(profile, noBuild, b, { x: 0, y: 0 }, spin,
          { center: { x: -profile.referenceRadius, y: 0 }, rotation: -spin, scale: 30 }, 800, 600, body);
        rotated.forEach((c, i) => expect(c.tiles).toBe(cells[i]));
        expect(registrations.at(-1)!.colors).toBe(MATERIAL_PALETTES[body]);
        tiles.style = 'muted'; tiles.draw(profile, query, b, { x: 0, y: 0 }, 0, camera, 800, 600, body);
        expect(registrations.at(-1)!.colors).toBe(TILE_PALETTE);
        tiles.style = 'colored'; tiles.draw(profile, query, b, { x: 0, y: 0 }, 0, camera, 800, 600, body);
        expect(registrations.at(-1)!.colors).toBe(MATERIAL_PALETTES[body]);
      }
    } finally { candidate.dispose(); }
  });
});
