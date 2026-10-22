import { describe, expect, it } from 'vitest';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import { SuccessorTileStore, TILE_SHARED_BYTES, TILE_BUILD_BYTES, type TileConsumer, type TileLease } from '../../apps/web/src/successor-tile-store';
import type { SurfaceProfile } from '../../packages/game-api/src/index';

function flat(radius = 512): SurfaceProfile {
  return { ...createSurfaceProfile(radius, new Float64Array(64)),
    pads: [{ id: 'landing-area', angleRadians: Math.PI / 2, widthMetres: 16, elevationMetres: 0 }] };
}
const consumer = (maxBytes?: number): TileConsumer => ({ bytes: 0, chunks: 0, failure: '', failureRevision: 0, ...(maxBytes === undefined ? {} : { maxBytes }) });

describe('leased bounded successor CPU sectors', () => {
  it('shares ready immutable content until the last view releases it', () => {
    const store = new SuccessorTileStore(), profile = flat(), a = consumer(), b = consumer();
    const first = store.acquire(a, profile, 'planet', 0, .5, 'colored', () => 512)!;
    store.process(); const patch = first.entry!.patch!;
    const before = patch.chunks.map(c => c.tiles.slice());
    const second = store.acquire(b, profile, 'planet', 0, .5, 'colored', () => { throw Error('Rebuilt shared ready content'); })!;
    expect(second.entry!.patch).toBe(patch); expect(a.bytes).toBe(patch.bytes); expect(b.bytes).toBe(patch.bytes);
    expect(store.stats.residentChunks).toBe(patch.chunks.length); expect(store.stats.leases).toBe(2);
    store.release(first);
    expect(store.stats.residentSectors).toBe(1); expect(b.bytes).toBe(patch.bytes);
    patch.chunks.forEach((c, i) => expect(c.tiles).toEqual(before[i]));
    store.release(second);
    expect(store.stats.bufferBytes).toBe(0); expect(store.stats.residentChunks).toBe(0); expect(b.bytes).toBe(0);
  });

  it('services one FIFO visible job per frame and removes cancelled pending work', () => {
    const store = new SuccessorTileStore(), profile = flat(), a = consumer(), b = consumer(); let cancelledQueries = 0;
    store.beginFrame();
    const first = store.acquire(a, profile, 'planet', 0, .5, 'colored', () => 512)!;
    const next = store.acquire(b, profile, 'planet', 1, .5, 'colored', () => 512)!;
    const cancelled = store.acquire(a, profile, 'planet', 2, .5, 'colored', () => { cancelledQueries++; return 512; })!;
    store.process(); expect(first.entry!.patch).toBeDefined(); expect(next.entry!.patch).toBeUndefined();
    expect(store.stats.builds).toBe(1); store.endFrame();
    store.beginFrame(); store.process(); expect(next.entry!.patch).toBeDefined(); expect(store.stats.builds).toBe(1);
    store.release(cancelled); store.endFrame(); store.beginFrame(); store.process(); store.endFrame();
    expect(cancelledQueries).toBe(0); expect(store.stats.totalBuilds).toBe(2); expect(store.stats.queuedSectors).toBe(0);
    store.release(first); store.release(next); expect(store.stats.bufferBytes).toBe(0);
  });

  it('never publishes a retired completion into a recycled entry or lets its old handle release the new view', () => {
    const store = new SuccessorTileStore(), oldProfile = flat(), newProfile = flat(256), old = consumer(), current = consumer();
    let switched = false, replacement: TileLease | undefined;
    const stale = store.acquire(old, oldProfile, 'planet', 0, .5, 'colored', () => {
      if (!switched) {
        switched = true; store.clear();
        replacement = store.acquire(current, newProfile, 'moon', 0, .5, 'colored', () => 256);
        store.process(); // Reentrant processing cannot overwrite the current cold build.
      }
      return 512;
    })!;
    const recycledRecord = stale.entry;
    store.process();
    expect(stale.entry).toBeUndefined(); expect(old.bytes).toBe(0);
    expect(replacement!.entry).toBe(recycledRecord);
    expect(replacement!.entry!.patch!.profile).toBe(newProfile);
    expect(replacement!.entry!.patch!.domain.id).toContain('parvus');
    const bytes = current.bytes;
    store.release(stale); expect(current.bytes).toBe(bytes); expect(store.stats.residentSectors).toBe(1);
    store.release(replacement!); expect(store.stats.bufferBytes).toBe(0);
  });

  it('rejects over-budget consumers before publication and reports/releases shared capacity failures', () => {
    const profile = flat(), store = new SuccessorTileStore(), tiny = consumer(2048), normal = consumer();
    const rejected = store.acquire(tiny, profile, 'planet', 0, .5, 'colored', () => 512)!;
    const accepted = store.acquire(normal, profile, 'planet', 0, .5, 'colored', () => 512)!;
    store.process();
    expect(rejected.entry).toBeUndefined(); expect(tiny.bytes).toBe(0); expect(tiny.failure).toBe('view residency capacity');
    expect(accepted.entry!.patch).toBeDefined(); expect(normal.bytes).toBeGreaterThan(2048);
    store.release(rejected); store.release(accepted);
    const small = new SuccessorTileStore(4096), owner = consumer();
    small.beginFrame(); const failed = small.acquire(owner, profile, 'planet', 0, .25, 'colored', () => 512)!;
    small.process(); small.endFrame();
    expect(failed.entry).toBeUndefined(); expect(owner.failure).toBe('shared byte capacity');
    expect(owner.bytes).toBe(0); expect(small.stats.bufferBytes).toBe(0); expect(small.stats.queuedSectors).toBe(0);
    small.release(failed);
  });

  it('reuses bounded buffers and records during within-frame pan, then drops all typed pools in overview', () => {
    const store = new SuccessorTileStore(), profile = flat(), owner = consumer();
    let lease = store.acquire(owner, profile, 'planet', 0, .5, 'colored', () => 512)!;
    store.process(); const oldArrays = lease.entry!.patch!.chunks.map(c => c.tiles);
    for (let index = 1; index < 8; index++) {
      store.beginFrame(); store.release(lease);
      expect(store.stats.pooledBytes).toBeLessThanOrEqual(128 * 1024);
      lease = store.acquire(owner, profile, 'planet', index, .5, 'colored', () => 512)!;
      store.process(); store.endFrame();
      expect(lease.entry!.patch!.chunks.some(c => oldArrays.includes(c.tiles))).toBe(true);
      expect(store.stats.allocatedEntries).toBe(1); expect(store.stats.allocatedLeases).toBe(1);
      expect(store.stats.bufferBytes).toBeLessThanOrEqual(TILE_SHARED_BYTES);
      expect(store.stats.peakSectorBytes).toBeLessThanOrEqual(TILE_BUILD_BYTES);
    }
    store.beginFrame(); store.release(lease); store.endFrame();
    expect(store.stats.pooledBytes).toBe(0); expect(store.stats.bufferBytes).toBe(0);
  });

  it('separates size, style and material body even for the same immutable profile', () => {
    const store = new SuccessorTileStore(), profile = flat(), owner = consumer();
    const a = store.acquire(owner, profile, 'planet', 0, .5, 'colored', () => 512)!;
    const b = store.acquire(owner, profile, 'moon', 0, .5, 'colored', () => 512)!;
    const c = store.acquire(owner, profile, 'planet', 0, 1, 'muted', () => 512)!;
    store.process();
    expect(a.entry).not.toBe(b.entry); expect(a.entry).not.toBe(c.entry);
    expect(a.entry!.patch!.chunks[0]!.tiles).not.toEqual(b.entry!.patch!.chunks[0]!.tiles);
    expect(c.entry!.patch!.size).toBe(1); expect(c.entry!.patch!.style).toBe('muted');
    for (const lease of [a, b, c]) store.release(lease);
    expect(store.stats.bufferBytes).toBe(0);
  });
});
