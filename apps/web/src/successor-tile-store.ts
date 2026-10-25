// Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-Project

import type { SurfaceProfile } from '../../../packages/game-api/src/index';
import { MATERIAL_DOMAINS, type MaterialStyle } from './successor-materials';
import { buildTilePatch, type TilePatch, type TileSize } from './successor-tile-patch';
import { tileChartLayout, MAX_DEMAND_SECTORS } from './successor-tile-demand';

export const TILE_VIEW_BYTES = 2 * 1024 * 1024;
export const TILE_VIEW_CHUNKS = 512;
export const TILE_SHARED_BYTES = 8 * 1024 * 1024;
export const TILE_BUILD_BYTES = 256 * 1024;
const MAX_RECORDS = 4 * MAX_DEMAND_SECTORS;
const TILE_BYTES = 2048;

/** One presenter's logical residency. Store publication checks these limits before
 * attaching immutable content, not after an over-budget frame has already drawn. */
export interface TileConsumer {
  bytes: number;
  chunks: number;
  failure: string;
  failureRevision: number;
  readonly maxBytes?: number;
  readonly maxChunks?: number;
}
export interface TileSectorEntry {
  profile?: SurfaceProfile;
  body: 'planet' | 'moon';
  index: number;
  size: TileSize;
  style: MaterialStyle;
  patch?: TilePatch;
  query?: (angle: number) => number;
  map?: Map<number, TileSectorEntry>;
  key: number;
  serial: number;
  readonly leases: TileLease[];
}
/** A detached/invalidated handle stays with its consumer until release acknowledges
 * it. It cannot be recycled into another view while an old view still holds it. */
export interface TileLease { entry?: TileSectorEntry; owner?: TileConsumer }

class SharedCapacity extends Error {}
/** Derived CPU content only. Arrays remain immutable until the last synchronous
 * draw consumer releases its lease. No GPU resource identity or physics state. */
export class SuccessorTileStore {
  private profiles = new WeakMap<SurfaceProfile, Map<number, TileSectorEntry>>();
  private readonly entries = new Set<TileSectorEntry>();
  private readonly queue: TileSectorEntry[] = [];
  private readonly freeEntries: TileSectorEntry[] = [];
  private readonly freeLeases: TileLease[] = [];
  private readonly freeTiles: Uint16Array[] = [];
  private readonly staging: Uint16Array[] = [];
  private readonly failedOwners: TileConsumer[] = [];
  private entryObjects = 0;
  private leaseObjects = 0;
  private tileBytes = 0;
  private geometryBytes = 0;
  private remaining = Infinity;
  private frameOpen = false;
  private clearing = false;
  private building = false;
  private serial = 0;
  epoch = 0;
  revision = 0;
  readonly stats = { residentSectors: 0, residentChunks: 0, bufferBytes: 0, pooledBytes: 0,
    leases: 0, queuedSectors: 0, builds: 0, totalBuilds: 0, generationMs: 0, cacheHits: 0,
    peakSectorBytes: 0, allocatedEntries: 0, allocatedLeases: 0 };
  private readonly maximumBytes: number;

  /** A smaller ceiling can model a constrained host; never exceeds the shared8MiB cap. */
  constructor(maximumBytes = TILE_SHARED_BYTES) {
    this.maximumBytes = Number.isFinite(maximumBytes) ? Math.max(TILE_BYTES, Math.min(TILE_SHARED_BYTES, maximumBytes)) : TILE_SHARED_BYTES;
  }
  beginFrame(): void {
    this.frameOpen = true; this.remaining = 1;
    this.stats.builds = 0; this.stats.generationMs = 0;
  }
  /** Release pools when every camera is in overview. Within-frame reuse stays bounded. */
  endFrame(): void {
    this.frameOpen = false;
    if (!this.entries.size) this.dropTiles();
    this.refresh();
  }
  private fits(owner: TileConsumer, patch: TilePatch): boolean {
    return owner.bytes + patch.bytes <= Math.min(TILE_VIEW_BYTES, owner.maxBytes ?? TILE_VIEW_BYTES)
      && owner.chunks + patch.chunks.length <= Math.min(TILE_VIEW_CHUNKS, owner.maxChunks ?? TILE_VIEW_CHUNKS);
  }
  private key(index: number, body: 'planet' | 'moon', size: TileSize, style: MaterialStyle): number {
    return index * 12 + (body === 'moon' ? 6 : 0) + (size === .25 ? 0 : size === .5 ? 2 : 4) + (style === 'muted' ? 1 : 0);
  }
  acquire(owner: TileConsumer, profile: SurfaceProfile, body: 'planet' | 'moon', index: number,
    size: TileSize, style: MaterialStyle, query: (angle: number) => number): TileLease | undefined {
    let map = this.profiles.get(profile);
    if (!map) { map = new Map(); this.profiles.set(profile, map); }
    const key = this.key(index, body, size, style);
    let entry = map.get(key);
    if (entry?.patch && !this.fits(owner, entry.patch)) {
      owner.failure = 'view residency capacity'; owner.failureRevision = this.revision; return undefined;
    }
    if (!this.freeLeases.length && this.leaseObjects === MAX_RECORDS
      || !entry && !this.freeEntries.length && this.entryObjects === MAX_RECORDS) {
      owner.failure = 'shared request capacity'; owner.failureRevision = this.revision; return undefined;
    }
    if (!entry) {
      entry = this.freeEntries.pop();
      if (!entry) {
        entry = { body, index, size, style, key, serial: 0, leases: [] }; this.entryObjects++;
      }
      entry.serial = ++this.serial;
      entry.profile = profile; entry.body = body; entry.index = index; entry.size = size;
      entry.style = style; entry.key = key; entry.query = query; entry.map = map;
      map.set(key, entry); this.entries.add(entry); this.queue.push(entry);
    } else this.stats.cacheHits++;
    let lease = this.freeLeases.pop();
    if (!lease) { lease = {}; this.leaseObjects++; }
    lease.entry = entry; lease.owner = owner; entry.leases.push(lease);
    if (entry.patch) { owner.bytes += entry.patch.bytes; owner.chunks += entry.patch.chunks.length; }
    this.refresh(); return lease;
  }
  release(lease: TileLease): void {
    const entry = lease.entry, owner = lease.owner;
    if (entry && owner) {
      if (entry.patch) { owner.bytes -= entry.patch.bytes; owner.chunks -= entry.patch.chunks.length; }
      const index = entry.leases.indexOf(lease);
      if (index >= 0) { entry.leases[index] = entry.leases.at(-1)!; entry.leases.pop(); }
      lease.entry = undefined;
      if (!entry.leases.length) this.retire(entry);
    }
    if (owner) { lease.owner = undefined; this.freeLeases.push(lease); }
    if (!this.entries.size && !this.frameOpen) this.dropTiles();
    this.refresh();
  }
  private invalidate(lease: TileLease, reason: string): void {
    const entry = lease.entry!, owner = lease.owner!;
    if (entry.patch) { owner.bytes -= entry.patch.bytes; owner.chunks -= entry.patch.chunks.length; }
    owner.failure = reason; owner.failureRevision = this.revision;
    entry.leases.splice(entry.leases.indexOf(lease), 1); lease.entry = undefined;
  }
  private retire(entry: TileSectorEntry): void {
    entry.map?.delete(entry.key); this.entries.delete(entry);
    const queued = this.queue.indexOf(entry); if (queued >= 0) this.queue.splice(queued, 1);
    if (entry.patch) {
      this.geometryBytes -= entry.patch.bytes - entry.patch.chunks.length * TILE_BYTES;
      for (const chunk of entry.patch.chunks) this.recycleTile(chunk.tiles);
    }
    entry.patch = undefined; entry.profile = undefined; entry.query = undefined; entry.map = undefined;
    this.freeEntries.push(entry); this.revision++;
  }
  private recycleTile(tiles: Uint16Array): void {
    if (!this.clearing && this.frameOpen && this.freeTiles.length < 64) this.freeTiles.push(tiles);
    else this.tileBytes -= tiles.byteLength;
  }
  private dropTiles(): void { this.tileBytes -= this.freeTiles.length * TILE_BYTES; this.freeTiles.length = 0; }
  private readonly allocate = (): Uint16Array => {
    let tiles = this.freeTiles.pop();
    if (!tiles) {
      if (this.tileBytes + this.geometryBytes + TILE_BYTES > this.maximumBytes) throw new SharedCapacity('shared byte capacity');
      tiles = new Uint16Array(1024); this.tileBytes += TILE_BYTES;
    }
    this.staging.push(tiles); return tiles;
  };
  /** FIFO visible jobs. The host grants one build/frame across all four presenters.
   * Outside a host frame, small deterministic fixtures may complete synchronously. */
  process(): void {
    if (this.building) return;
    while (this.remaining > 0 && this.queue.length) {
      const entry = this.queue.shift()!;
      if (!entry.leases.length || entry.patch) continue;
      this.remaining--; this.stats.builds++; this.stats.totalBuilds++;
      const start = performance.now(), epoch = this.epoch, serial = entry.serial;
      this.staging.length = 0; this.building = true;
      try {
        const profile = entry.profile!, layout = tileChartLayout(profile), half = profile.referenceRadius * layout.step / 2;
        const patch = buildTilePatch(profile, entry.size, entry.query!, MATERIAL_DOMAINS[entry.body], entry.style,
          layout.origin + entry.index * layout.step, { west: -half, east: half, radialDepth: true, anchorMuted: true,
            allocateTiles: this.allocate, maxBytes: TILE_BUILD_BYTES, maxBoundaryPoints: 4096 });
        if (epoch !== this.epoch || serial !== entry.serial || !this.entries.has(entry)) {
          for (const tiles of this.staging) this.recycleTile(tiles);
          continue;
        }
        const geometry = patch.bytes - patch.chunks.length * TILE_BYTES;
        if (this.tileBytes + this.geometryBytes + geometry > this.maximumBytes) throw new SharedCapacity('shared byte capacity');
        this.stats.peakSectorBytes = Math.max(this.stats.peakSectorBytes, patch.bytes);
        // No over-budget consumer receives the newly published patch.
        for (let i = entry.leases.length - 1; i >= 0; i--) {
          const lease = entry.leases[i]!;
          if (!this.fits(lease.owner!, patch)) this.invalidate(lease, 'view residency capacity');
        }
        if (!entry.leases.length) {
          for (const tiles of this.staging) this.recycleTile(tiles);
          this.retire(entry);
        } else {
          entry.patch = patch; this.geometryBytes += geometry;
          for (const lease of entry.leases) {
            lease.owner!.bytes += patch.bytes; lease.owner!.chunks += patch.chunks.length;
          }
        }
      } catch (error) {
        for (const tiles of this.staging) this.recycleTile(tiles);
        if (epoch !== this.epoch || serial !== entry.serial || !this.entries.has(entry)) continue;
        if (!(error instanceof SharedCapacity) && !(error instanceof Error && error.message === 'Tile sector geometry capacity')) {
          while (entry.leases.length) this.invalidate(entry.leases.at(-1)!, 'generation failed');
          this.retire(entry); this.refresh(); throw error;
        }
        this.failedOwners.length = 0;
        while (entry.leases.length) {
          const lease = entry.leases.at(-1)!; this.failedOwners.push(lease.owner!);
          this.invalidate(lease, error instanceof SharedCapacity ? 'shared byte capacity' : 'sector geometry capacity');
        }
        this.retire(entry);
        for (const owner of this.failedOwners) owner.failureRevision = this.revision;
        this.failedOwners.length = 0;
      } finally {
        this.staging.length = 0; this.building = false; this.stats.generationMs += performance.now() - start;
      }
    }
    this.refresh();
  }
  /** Retire the world and invalidate old handles before recycling their entry records. */
  clear(): void {
    this.clearing = true;
    for (const entry of this.entries) {
      while (entry.leases.length) this.invalidate(entry.leases.at(-1)!, 'retired content');
      this.retire(entry);
    }
    this.profiles = new WeakMap(); this.queue.length = 0; this.dropTiles();
    this.epoch++; this.clearing = false; this.refresh();
  }
  private refresh(): void {
    let sectors = 0, chunks = 0, leases = 0;
    for (const entry of this.entries) { if (entry.patch) { sectors++; chunks += entry.patch.chunks.length; } leases += entry.leases.length; }
    this.stats.residentSectors = sectors; this.stats.residentChunks = chunks; this.stats.leases = leases;
    this.stats.bufferBytes = this.tileBytes + this.geometryBytes; this.stats.pooledBytes = this.freeTiles.length * TILE_BYTES;
    this.stats.queuedSectors = this.queue.length; this.stats.allocatedEntries = this.entryObjects; this.stats.allocatedLeases = this.leaseObjects;
  }
}
