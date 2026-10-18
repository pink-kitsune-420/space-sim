import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { isZip } from '../../packages/game-library/src/zip';
import { encodeUniverse, decodeUniverse } from '../../packages/game-library/src/universe';
import { validateUniverse, DEFAULT_UNIVERSE, loadSystem } from '../../packages/sim-core/src/universe';
import { generateSurface, surfaceIdentity } from '../../packages/sim-core/src/surface';
import { startServer } from '../../apps/server/src/server';
import terrain from '../../games/space-sim/universes/sandbox/terrain/universe.json';
import ocean from '../../games/space-sim/universes/sandbox/ocean/universe.json';
import fullSolar from '../../games/space-sim/universes/astronomy/full-solar-system/universe.json';

describe('lossless universe and planet compression', () => {
  for (const raw of [DEFAULT_UNIVERSE, terrain, ocean, fullSolar]) {
    it(`preserves all model data for ${raw.name}`, async () => {
      const universe = validateUniverse(raw);
      const bytes = await encodeUniverse(universe);
      expect(bytes.length).toBeLessThan(32 * 1024 * 1024);
      expect(isZip(bytes)).toBe(true);
      const restored = await decodeUniverse(bytes);
      expect(restored).toEqual(universe);
      expect(await decodeUniverse(new TextEncoder().encode(JSON.stringify(universe)))).toEqual(universe);
      const before = loadSystem(universe, universe.defaultSystemId), after = loadSystem(restored, restored.defaultSystemId);
      for (const body of before.getAllBodies()) {
        const copy = after.getResolvedBody(body.id);
        expect(copy.mu).toBe(body.mu);
        expect(surfaceIdentity(copy)).toBe(surfaceIdentity(body));
        if (body.surface) expect(generateSurface(copy).copyElevations()).toEqual(generateSurface(body).copyElevations());
      }
    });
  }
  it('accepts compressed single-system legacy files and rejects damaged/invalid universes', async () => {
    const system = DEFAULT_UNIVERSE.systems[0]!;
    expect(await decodeUniverse(new Uint8Array(gzipSync(JSON.stringify(system))))).toEqual(validateUniverse(system));
    await expect(decodeUniverse(new Uint8Array(gzipSync('{broken')))).rejects.toThrow();
    await expect(decodeUniverse(new Uint8Array(gzipSync(JSON.stringify({ ...DEFAULT_UNIVERSE, schemaVersion: 9 }))))).rejects.toThrow('schemaVersion');
  });
  it('starts a dedicated server directly from a compressed universe', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'space-lab-universe-'));
    try {
      const universe = validateUniverse({ ...DEFAULT_UNIVERSE, id: 'compressed-sky', name: 'Compressed sky' });
      await writeFile(resolve(directory, 'sky.spacedata'), await encodeUniverse(universe));
      const server = await startServer({ dataDir: directory, overrides: { port: 0, host: '127.0.0.1', universe: 'sky.spacedata' }, log: () => {} });
      try { expect(server.host.world.universe).toEqual(universe); }
      finally { await server.stop(); }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
});
