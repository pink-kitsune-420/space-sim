/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial evaluation only.
 * See ../../../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

import type { OverlayPrimitive, SurfaceProfile, Vec } from '../../../packages/game-api/src/index';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_SLOTS, type MaterialDomain, type MaterialStyle } from './successor-materials';

export type TileSize = .25 | .5 | 1;
export type Chunk = Extract<OverlayPrimitive, { kind: 'tile-chunk' }>;
export const TILE_PALETTE_ID = 'space-sim.successor-surface/1';
export const TILE_PALETTE = ['#00000000', '#323c42', '#354047', '#39444a', '#3d484e'] as const;
/** Fixed review region: -256..192 m along the landing meridian, 16 m of visible crust.
 * Rendering only: the physical polar-linear surface remains authoritative everywhere. */
export const TILE_PATCH = Object.freeze({ west: -256, east: 192, depth: 16, tolerance: 1e-5 });

export interface TilePatch {
  readonly profile: SurfaceProfile;
  readonly centerAngle: number;
  readonly size: TileSize;
  readonly chunks: readonly Chunk[];
  readonly boundary: readonly Vec[];
  readonly bytes: number;
  readonly buildMs: number;
  readonly domain: MaterialDomain;
  readonly style: MaterialStyle;
}

/** Axis-aligned half-plane clipping preserves concave simple polygons. */
function clip(points: readonly Vec[], axis: 'x' | 'y', limit: number, sign: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    const da = (a[axis] - limit) * sign, db = (b[axis] - limit) * sign;
    if (da >= 0) out.push(a);
    if ((da >= 0) !== (db >= 0)) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Cold-builder options for bounded immutable body-fixed sectors. The legacy
 * fixed patch remains the default. Tile buffers must be exclusively owned until published. */
export interface TilePatchOptions {
  readonly west: number;
  readonly east: number;
  readonly radialDepth?: boolean;
  readonly anchorMuted?: boolean;
  readonly allocateTiles?: () => Uint16Array;
  readonly maxBytes?: number;
  readonly maxBoundaryPoints?: number;
}

/** Preserve every authoritative interval knot. Subdivision uses a conservative
 * curvature bound |p''| <= r + 2|dr/dtheta|, not just a midpoint-error heuristic.
 * The body-local tangent frame is rotated from the landing pad's radial direction. */
export function buildTilePatch(profile: SurfaceProfile, size: TileSize, query: (angle: number) => number,
  domain: MaterialDomain = MATERIAL_DOMAINS.planet, style: MaterialStyle = 'colored', centerAngle?: number, options?: TilePatchOptions): TilePatch {
  const started = performance.now();
  const radius = profile.referenceRadius;
  const pad = profile.pads.find(p => p.id === 'landing-area');
  if (!pad) throw new Error('Tile prototype needs an authored landing-area pad.');
  const centre = centerAngle ?? pad.angleRadians;
  const west = options?.west ?? TILE_PATCH.west, east = options?.east ?? TILE_PATCH.east;
  if (!Number.isFinite(west + east) || !(west < east)) throw new Error('Invalid tile sector extent.');
  const start = centre - east / radius, end = centre - west / radius;
  const basis = centre - pad.angleRadians, basisCos = Math.cos(basis), basisSin = Math.sin(basis);
  const delta = 2 * Math.PI / profile.sampleCount;
  const point = (angle: number): Vec => {
    const r = query(angle), a = angle - centre + Math.PI / 2;
    return { x: r * Math.cos(a), y: r * Math.sin(a) - radius };
  };
  const boundary: Vec[] = [point(start)];
  let a = start;
  while (a < end) {
    const nextKnot = profile.orientationRadians + (Math.floor((a - profile.orientationRadians) / delta + 1e-10) + 1) * delta;
    const b = Math.min(end, nextKnot);
    if (!(b > a)) throw new Error('Tile boundary interval did not advance.');
    const ra = query(a), rb = query(b);
    const curvature = Math.max(ra, rb) + 2 * Math.abs((rb - ra) / (b - a));
    const count = Math.max(1, Math.ceil((b - a) * Math.sqrt(curvature / (8 * TILE_PATCH.tolerance))));
    if (boundary.length + count > (options?.maxBoundaryPoints ?? Infinity)) throw new Error('Tile sector geometry capacity');
    for (let i = 1; i <= count; i++) boundary.push(point(a + (b - a) * i / count));
    a = b;
  }
  // The selected landing sector is a single-valued height field in this tangent frame.
  boundary.reverse();
  for (let i = 1; i < boundary.length; i++) {
    if (boundary[i]!.x <= boundary[i - 1]!.x) throw new Error('Tile prototype sector folds in its tangent frame.');
  }
  const chunks: Chunk[] = [], step = size * 32;
  let bytes = boundary.length * 16;
  const firstX = Math.floor(boundary[0]!.x / step), lastX = Math.floor(boundary.at(-1)!.x / step);
  const ribbon = [...boundary, ...[...boundary].reverse().map(p => {
    if (!options?.radialDepth) return { x: p.x, y: p.y - TILE_PATCH.depth };
    const r = Math.hypot(p.x, p.y + radius), ratio = Math.max(0, r - TILE_PATCH.depth) / r;
    return { x: p.x * ratio, y: (p.y + radius) * ratio - radius };
  })];
  for (let cx = firstX; cx <= lastX; cx++) {
    // Bound geometry by this column first, avoiding an O(all points * all chunks) build.
    const column = clip(clip(ribbon, 'x', cx * step, 1), 'x', (cx + 1) * step, -1);
    if (!column.length) continue;
    const low = Math.min(...column.map(p => p.y)), high = Math.max(...column.map(p => p.y));
    for (let cy = Math.floor(low / step); cy <= Math.floor(high / step); cy++) {
      const polygon = clip(clip(column, 'y', cy * step, 1), 'y', (cy + 1) * step, -1);
      if (polygon.length < 3) continue;
      const origin = { x: cx * step, y: cy * step };
      bytes += 2048 + polygon.length * 16;
      if (bytes > (options?.maxBytes ?? Infinity)) throw new Error('Tile sector geometry capacity');
      const tiles = options?.allocateTiles?.() ?? new Uint16Array(1024);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (style === 'muted') {
          // Preserve the accepted prototype exactly as a selectable comparison.
          const lx = origin.x + (x + .5) * size, ly = origin.y + (y + .5) * size;
          const ix = options?.anchorMuted ? Math.floor((lx * basisCos - (ly + radius) * basisSin) / size) : cx * 32 + x;
          const iy = options?.anchorMuted ? Math.floor((lx * basisSin + (ly + radius) * basisCos - radius) / size) : cy * 32 + y;
          const hash = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263);
          tiles[y * 32 + x] = 1 + ((hash ^ (hash >>> 13)) >>> 0) % 4;
        } else {
          const lx = origin.x + (x + .5) * size, ly = origin.y + (y + .5) * size;
          const id = appearanceAt(domain, lx * basisCos - (ly + radius) * basisSin,
            lx * basisSin + (ly + radius) * basisCos - radius);
          tiles[y * 32 + x] = 1 + MATERIAL_SLOTS.indexOf(id);
        }
      }
      chunks.push({ kind: 'tile-chunk', space: 'world', origin, size: 32, tileMetres: size, tiles,
        paletteId: style === 'muted' ? TILE_PALETTE_ID : domain.id,
        clipPolygon: polygon.map(p => ({ x: p.x - origin.x, y: p.y - origin.y })) });
    }
  }
  if (chunks.length > 512) throw new Error('Tile prototype exceeded its 512 resident chunk budget.');
  return { profile, centerAngle: centre, size, chunks, boundary, domain, style,
    bytes,
    buildMs: performance.now() - started };
}
