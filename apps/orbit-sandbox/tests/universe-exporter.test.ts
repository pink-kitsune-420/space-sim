import { describe, it, expect } from 'vitest';
import {
  compileToUniverse,
  compressUniverse,
  sanitizeId,
  stageUniverseForSpaceSim,
} from '../src/universe-exporter';
import { createDefaultSolarSystem, instantiateBody } from '../src/presets';
import { validateUniverse } from '../src/spacelab/sim-core';

describe('Universe Exporter & Space Sim Bridge', () => {
  it('sanitizes user input into valid schema IDs', () => {
    expect(sanitizeId('My Custom Planet #1!')).toBe('my-custom-planet-1');
    expect(sanitizeId('   ___Planet___   ')).toBe('planet');
    expect(sanitizeId('')).toBe('body');
  });

  it('compiles sandbox bodies into a strictly valid UniverseDefinition', () => {
    const bodies = createDefaultSolarSystem();
    const universe = compileToUniverse(bodies, 'my-test-universe', 'My Test Universe');

    expect(universe.schemaVersion).toBe(1);
    expect(universe.id).toBe('my-test-universe');
    expect(universe.name).toBe('My Test Universe');
    expect(universe.defaultSystemId).toBe('sandbox-system');
    expect(universe.systems.length).toBe(1);

    const system = universe.systems[0]!;
    expect(system.id).toBe('sandbox-system');
    expect(system.centralBodyId).toBeDefined();
    expect(system.bodies.length).toBe(bodies.length);
    expect(system.presets.length).toBeGreaterThan(0);

    // Verify against official Spacelab engine universe validator
    expect(() => validateUniverse(universe)).not.toThrow();
  });

  it('compresses universe to valid gzip binary (.spaceuniverse)', async () => {
    const bodies = [
      instantiateBody('star', { x: 0, y: 0 }, { x: 0, y: 0 }),
      instantiateBody('oceanic', { x: 10000, y: 0 }, { x: 0, y: 50 }),
    ];
    const universe = compileToUniverse(bodies);
    const compressedBytes = await compressUniverse(universe);

    expect(compressedBytes).toBeInstanceOf(Uint8Array);
    expect(compressedBytes.length).toBeGreaterThan(0);

    // Standard gzip magic number check: 0x1f 0x8b
    expect(compressedBytes[0]).toBe(0x1f);
    expect(compressedBytes[1]).toBe(0x8b);

    // Decompress and verify content round-trip
    const decompressedStream = new Blob([compressedBytes as Uint8Array<ArrayBuffer>])
      .stream()
      .pipeThrough(new DecompressionStream('gzip'));
    const response = new Response(decompressedStream);
    const text = await response.text();
    const parsed = JSON.parse(text);

    expect(parsed.id).toBe(universe.id);
    expect(parsed.systems[0].bodies.length).toBe(bodies.length);
  });

  it('stages universe in localStorage with deep link', () => {
    // Mock localStorage for node environment
    const storage: Record<string, string> = {};
    const mockStorage = {
      getItem: (k: string) => storage[k] ?? null,
      setItem: (k: string, v: string) => { storage[k] = v; },
      removeItem: (k: string) => { delete storage[k]; },
      clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
    };
    (globalThis as any).localStorage = mockStorage;

    const bodies = [instantiateBody('oceanic', { x: 0, y: 0 })];
    const universe = compileToUniverse(bodies);
    const { deepLinkUrl, success } = stageUniverseForSpaceSim(universe);

    expect(success).toBe(true);
    expect(deepLinkUrl).toContain('http://localhost:5173/');
    expect(mockStorage.getItem('space-sim:staged-universe')).toContain(universe.id);
  });
});
