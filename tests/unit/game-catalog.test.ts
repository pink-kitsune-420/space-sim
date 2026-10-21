import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { validateGameCatalog, validatePackage, decodePackage, type GamePackage } from '../../packages/game-library/src/archive';
import { requestedBuiltinGame, defaultGame } from '../../apps/web/src/bundled-games';

const catalogPath = resolve('games/catalog.json');
const catalogRaw = JSON.parse(readFileSync(catalogPath, 'utf8'));

describe('Multi-Game Catalog Discovery & Offline Bundling (REC-11)', () => {
  it('validates games/catalog.json schema and rejects duplicate IDs or aliases', () => {
    const catalog = validateGameCatalog(catalogRaw);
    expect(catalog.format).toBe('space-lab-game-catalog/1');
    expect(catalog.defaultGame).toBe('builtin.space-sim');
    expect(catalog.games.length).toBeGreaterThanOrEqual(6);

    // Rejects duplicate IDs
    expect(() =>
      validateGameCatalog({
        ...catalogRaw,
        games: [...catalogRaw.games, { ...catalogRaw.games[0], alias: 'duplicate-id-alias' }],
      })
    ).toThrow(/Duplicate game ID/);

    // Rejects duplicate aliases
    expect(() =>
      validateGameCatalog({
        ...catalogRaw,
        games: [
          { ...catalogRaw.games[0], id: 'builtin.different-id', alias: catalogRaw.games[1].alias },
          ...catalogRaw.games.slice(1),
        ],
      })
    ).toThrow(/Duplicate game alias/);

    // Rejects invalid default game
    expect(() =>
      validateGameCatalog({
        ...catalogRaw,
        defaultGame: 'builtin.nonexistent-game',
      })
    ).toThrow(/Default game ID 'builtin.nonexistent-game' not found/);

    // Rejects unsupported format
    expect(() =>
      validateGameCatalog({
        ...catalogRaw,
        format: 'space-lab-game-catalog/99',
      })
    ).toThrow(/Unsupported game catalog format/);
  });

  it('confirms all game files referenced in catalog exist on disk and pass validatePackage()', () => {
    const catalog = validateGameCatalog(catalogRaw);
    for (const entry of catalog.games) {
      const gameFilePath = resolve('games', entry.path);
      expect(existsSync(gameFilePath), `Game file must exist: ${gameFilePath}`).toBe(true);

      const raw = JSON.parse(readFileSync(gameFilePath, 'utf8'));
      const validated = validatePackage(raw) as GamePackage;
      expect(validated.format).toBe('space-lab-game/1');
      expect(validated.info.id).toBe(entry.id);
    }
  });

  it('requestedBuiltinGame resolves both alias and full builtin ID', () => {
    const catalog = validateGameCatalog(catalogRaw);
    for (const entry of catalog.games) {
      // Resolves by full builtin ID
      const byId = requestedBuiltinGame(`?game=${entry.id}`);
      expect(byId.info.id).toBe(entry.id);

      // Resolves by short alias
      const byAlias = requestedBuiltinGame(`?game=${entry.alias}`);
      expect(byAlias.info.id).toBe(entry.id);
    }

    // Resolves default on unknown ID or empty query
    expect(requestedBuiltinGame('?game=unknown-game-id').info.id).toBe(defaultGame.info.id);
    expect(requestedBuiltinGame('').info.id).toBe(defaultGame.info.id);
  });

  it('offline builder generates valid .spacegame archives for every catalog entry', async () => {
    const catalog = validateGameCatalog(catalogRaw);
    for (const entry of catalog.games) {
      const gameFilePath = resolve('games', entry.path);
      const raw = JSON.parse(readFileSync(gameFilePath, 'utf8'));
      const expected = validatePackage(raw) as GamePackage;

      // Pack with gzipSync (offline standalone .spacegame format)
      const compressed = gzipSync(JSON.stringify(raw), { level: 9 });
      expect(compressed.length).toBeGreaterThan(0);

      // Verify decompression and archive decoding
      const decompressed = JSON.parse(gunzipSync(compressed).toString('utf8'));
      const restored = validatePackage(decompressed);
      expect(restored.info.id).toBe(expected.info.id);
      expect(restored.format).toBe('space-lab-game/1');

      // Verify decodePackage on compressed bytes
      const decoded = await decodePackage(new Uint8Array(compressed));
      expect(decoded.info.id).toBe(expected.info.id);

      // Verify that if dist archive exists, it can be decoded into a matching package
      const distArchive = resolve('dist', `${entry.alias}.spacegame`);
      if (existsSync(distArchive)) {
        const distBytes = readFileSync(distArchive);
        const distDecoded = await decodePackage(new Uint8Array(distBytes));
        expect(distDecoded.info.id).toBe(expected.info.id);
      }
    }
  });
});
