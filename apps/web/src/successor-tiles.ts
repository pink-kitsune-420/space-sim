/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial evaluation only.
 * See ../../../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

import type { Camera, Renderer, SurfaceProfile, Vec } from '../../../packages/game-api/src/index';
import { MATERIAL_DOMAINS, MATERIAL_PALETTES, type MaterialStyle } from './successor-materials';
import { TILE_PATCH, TILE_PALETTE, TILE_PALETTE_ID, type Chunk, type TileSize } from './successor-tile-patch';
export { buildTilePatch, TILE_PATCH, TILE_PALETTE, TILE_PALETTE_ID } from './successor-tile-patch';
export type { TilePatch, TileSize } from './successor-tile-patch';

import { TileDemand, MAX_DEMAND_SECTORS } from './successor-tile-demand';
import { SuccessorTileStore, type TileConsumer, type TileLease } from './successor-tile-store';

export interface TileStats {
  targetAngle?: number; cameraAngle?: number; pending?: boolean; fineRequests?: number; candidateTests?: number;
  mode: string; tileMetres: number; residentChunks: number; visibleChunks: number;
  tileDraws: number; clipDraws: number; submittedCells: number; bufferBytes: number; buildMs: number;
  coverage: string; boundaryToleranceMetres: number;
  materialDomain: string; materialStyle: MaterialStyle;
}

/** Camera-driven, view-local leases over immutable shared CPU sectors. Coarse ground
 * remains complete until every required sector is ready. Output transforms are borrowed
 * until the next draw/clear, and never mutate another view's shared cells or polygons. */
export class SuccessorTiles {
  size: TileSize | 0 = .5;
  targetAngle?: number;
  /** Review-only deterministic readiness delay, milliseconds; no async world loader. */
  delayMs = 0;
  style: MaterialStyle = 'colored';
  private readyAt = 0;
  private detailed = false;
  private profile?: SurfaceProfile;
  private body?: 'planet' | 'moon';
  private priorSize?: TileSize;
  private priorStyle?: MaterialStyle;
  private priorTarget?: number;
  private epoch = -1;
  private priorCount = 0;
  private readonly priorIndices = new Float64Array(MAX_DEMAND_SECTORS);
  private readonly demand = new TileDemand();
  private readonly leases: TileLease[] = [];
  private readonly consumer: TileConsumer = { bytes: 0, chunks: 0, failure: '', failureRevision: -1 };
  private renderer?: Renderer;
  private palette?: readonly string[];
  private readonly wrappers: Chunk[] = [];
  private readonly output: Chunk[] = [];
  readonly stats: TileStats = { mode: 'vector', tileMetres: .5, residentChunks: 0, visibleChunks: 0,
    tileDraws: 0, clipDraws: 0, submittedCells: 0, bufferBytes: 0, buildMs: 0,
    coverage: 'Camera-visible local surface; complete coarse backing while detail loads.', boundaryToleranceMetres: TILE_PATCH.tolerance,
    materialDomain: '', materialStyle: 'colored' };

  constructor(readonly store = new SuccessorTileStore()) {}

  private release(): void {
    while (this.leases.length) this.store.release(this.leases.pop()!);
    this.resetOutput(0); this.stats.buildMs = 0;
  }
  /** Clear borrowed references as well as leases, so an overview view cannot retain
   * shared tile buffers or clip polygons through an unused transform wrapper. */
  private resetOutput(used: number): void {
    for (let i = used; i < this.output.length; i++) {
      const wrapper = this.output[i]! as { tiles: Uint16Array; clipPolygon?: readonly Vec[] };
      wrapper.tiles = EMPTY_TILES; wrapper.clipPolygon = undefined;
    }
    this.output.length = used;
  }
  clear(): void {
    this.release(); this.profile = undefined; this.body = undefined; this.priorCount = 0;
    this.renderer = undefined; this.palette = undefined; this.readyAt = 0; this.detailed = false;
    this.consumer.failure = ''; this.consumer.failureRevision = -1;
    this.stats.pending = false; this.stats.fineRequests = this.stats.candidateTests = 0; this.stats.materialDomain = '';
    this.stats.residentChunks = this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = 0;
    this.stats.submittedCells = this.stats.bufferBytes = this.stats.buildMs = 0;
  }
  private residency(): void {
    this.stats.residentChunks = this.consumer.chunks; this.stats.bufferBytes = this.consumer.bytes;
  }

  draw(profile: SurfaceProfile, query: (a: number) => number, renderer: Renderer,
    bodyOrigin: Vec, spin: number, camera: Camera, width: number, height: number,
    body: 'planet' | 'moon' = 'planet'): readonly Chunk[] {
    this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = this.stats.submittedCells = 0;
    this.stats.mode = 'vector'; this.stats.pending = false; this.stats.materialStyle = this.style;
    // Drop output references before a lease can be retired or its tile array reused.
    this.resetOutput(0);
    if (!this.size) { this.clear(); return this.output; }
    this.stats.tileMetres = this.size;
    if (renderer.features?.tileChunks?.version !== 1 || !renderer.features.tilePalettes) {
      this.clear(); this.stats.mode = 'unsupported renderer: vector baseline'; return this.output;
    }
    const cellPixels = camera.scale * this.size;
    this.detailed = cellPixels >= (this.detailed ? 1.5 : 2);
    if (!this.detailed) { this.clear(); this.stats.mode = 'overview: zero fine demand'; return this.output; }
    this.demand.update(profile, bodyOrigin, spin, camera, width, height);
    this.stats.cameraAngle = this.demand.angle;
    if (this.demand.overflow || !this.demand.count) {
      const reason = this.demand.reason, tested = this.demand.tested;
      this.clear(); this.stats.candidateTests = tested;
      this.stats.mode = `${reason}: complete coarse backing`; return this.output;
    }
    const demand = this.demand, consumer = this.consumer;
    const identityChanged = this.profile !== profile || this.body !== body || this.priorSize !== this.size
      || this.priorStyle !== this.style || this.epoch !== this.store.epoch;
    let changed = identityChanged || this.priorTarget !== this.targetAngle || this.priorCount !== demand.count;
    if (!changed) for (let i = 0; i < demand.count; i++) if (this.priorIndices[i] !== demand.indices[i]) { changed = true; break; }
    if (identityChanged || changed && this.delayMs > 0) this.release();
    if (changed) {
      this.profile = profile; this.body = body; this.priorSize = this.size; this.priorStyle = this.style;
      this.priorTarget = this.targetAngle; this.epoch = this.store.epoch; this.priorCount = demand.count;
      this.priorIndices.set(demand.indices.subarray(0, demand.count));
      this.readyAt = performance.now() + this.delayMs; consumer.failure = '';
    }
    this.stats.targetAngle = this.targetAngle ?? demand.angle;
    this.stats.fineRequests = demand.count; this.stats.candidateTests = demand.tested;
    this.stats.materialDomain = MATERIAL_DOMAINS[body].id;
    if (performance.now() < this.readyAt) {
      this.residency(); this.stats.pending = true; this.stats.mode = 'waiting: complete coarse backing'; return this.output;
    }
    if (consumer.failure) {
      const retry = consumer.failure === 'shared byte capacity' || consumer.failure === 'shared request capacity';
      if (retry && consumer.failureRevision !== this.store.revision) consumer.failure = '';
      else {
        const reason = consumer.failure; this.release(); consumer.failureRevision = this.store.revision;
        this.residency(); this.stats.mode = `${reason}: complete coarse backing`; return this.output;
      }
    }
    // Keep overlapping sectors; retire stale/cancelled work before adding new demand.
    for (let i = this.leases.length - 1; i >= 0; i--) {
      const lease = this.leases[i]!, index = lease.entry?.index;
      let wanted = false;
      for (let j = 0; j < demand.count; j++) if (index === demand.indices[j]) { wanted = true; break; }
      if (!wanted) { this.store.release(lease); this.leases.splice(i, 1); }
    }
    for (let i = 0; i < demand.count; i++) {
      const index = demand.indices[i]!;
      let held = false;
      for (const lease of this.leases) if (lease.entry?.index === index) { held = true; break; }
      if (!held) {
        const lease = this.store.acquire(consumer, profile, body, index, this.size, this.style, query);
        if (lease) this.leases.push(lease); else break;
      }
    }
    this.store.process();
    if (consumer.failure) {
      const reason = consumer.failure;
      this.release(); consumer.failureRevision = this.store.revision;
      this.residency(); this.stats.mode = `${reason}: complete coarse backing`; return this.output;
    }
    this.residency();
    for (const lease of this.leases) if (!lease.entry?.patch) {
      this.stats.pending = true; this.stats.mode = 'generation budget: complete coarse backing'; return this.output;
    }
    const palette = this.style === 'muted' ? TILE_PALETTE : MATERIAL_PALETTES[body];
    if (this.renderer !== renderer || this.palette !== palette) {
      renderer.features.tilePalettes.register(this.style === 'muted' ? TILE_PALETTE_ID : MATERIAL_DOMAINS[body].id, palette);
      this.renderer = renderer; this.palette = palette;
    }
    const cc = Math.cos(camera.rotation), cs = Math.sin(camera.rotation);
    let used = 0, buildMs = 0;
    for (const lease of this.leases) {
      const patch = lease.entry!.patch!;
      buildMs += patch.buildMs;
      const angle = spin + patch.centerAngle - Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
      const projected = angle + camera.rotation;
      const margin = this.size * 16 * camera.scale * (Math.abs(Math.cos(projected)) + Math.abs(Math.sin(projected)));
      for (const p of patch.chunks) {
        const half = p.tileMetres * 16, x = p.origin.x, y = p.origin.y + profile.referenceRadius;
        const wx = bodyOrigin.x + x * c - y * s, wy = bodyOrigin.y + x * s + y * c;
        const dx = wx + half * (c - s) - camera.center.x, dy = wy + half * (s + c) - camera.center.y;
        const sx = width / 2 + (dx * cc - dy * cs) * camera.scale;
        const sy = height / 2 - (dx * cs + dy * cc) * camera.scale;
        if (sx + margin < 0 || sx - margin > width || sy + margin < 0 || sy - margin > height) continue;
        if (used === 200) {
          this.resetOutput(0); this.stats.mode = 'draw capacity: complete coarse backing'; return this.output;
        }
        let wrapper = this.wrappers[used];
        if (!wrapper) { wrapper = { ...p, origin: { x: 0, y: 0 } }; this.wrappers.push(wrapper); }
        const out = wrapper as { origin: { x: number; y: number }; rotationRadians?: number; tiles: Uint16Array;
          clipPolygon?: readonly Vec[]; tileMetres: number; paletteId?: string };
        out.origin.x = wx; out.origin.y = wy; out.rotationRadians = angle; out.tiles = p.tiles;
        out.clipPolygon = p.clipPolygon; out.tileMetres = p.tileMetres; out.paletteId = p.paletteId;
        this.output[used++] = wrapper;
      }
    }
    this.stats.buildMs = buildMs; this.stats.mode = 'bounded tile prototype';
    this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = used;
    this.stats.submittedCells = used * 1024;
    return this.output;
  }
}
const EMPTY_TILES = new Uint16Array(0);
