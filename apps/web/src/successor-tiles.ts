import type { Camera, OverlayPrimitive, Renderer, SurfaceProfile, Vec } from '../../../packages/game-api/src/index';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_PALETTES, MATERIAL_SLOTS, type MaterialDomain, type MaterialStyle } from './successor-materials';

export type TileSize = .25 | .5 | 1;
type Chunk = Extract<OverlayPrimitive, { kind: 'tile-chunk' }>;
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

/** Preserve every authoritative interval knot. Subdivision uses a conservative
 * curvature bound |p''| <= r + 2|dr/dtheta|, not just a midpoint-error heuristic.
 * The body-local tangent frame is rotated from the landing pad's radial direction. */
export function buildTilePatch(profile: SurfaceProfile, size: TileSize, query: (angle: number) => number,
  domain: MaterialDomain = MATERIAL_DOMAINS.planet, style: MaterialStyle = 'colored', centerAngle?: number): TilePatch {
  const started = performance.now();
  const radius = profile.referenceRadius;
  const pad = profile.pads.find(p => p.id === 'landing-area');
  if (!pad) throw new Error('Tile prototype needs an authored landing-area pad.');
  const centre = centerAngle ?? pad.angleRadians;
  const start = centre - TILE_PATCH.east / radius, end = centre - TILE_PATCH.west / radius;
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
    for (let i = 1; i <= count; i++) boundary.push(point(a + (b - a) * i / count));
    a = b;
  }
  // The selected landing sector is a single-valued height field in this tangent frame.
  boundary.reverse();
  for (let i = 1; i < boundary.length; i++) {
    if (boundary[i]!.x <= boundary[i - 1]!.x) throw new Error('Tile prototype sector folds in its tangent frame.');
  }
  const chunks: Chunk[] = [], step = size * 32;
  const firstX = Math.floor(boundary[0]!.x / step), lastX = Math.floor(boundary.at(-1)!.x / step);
  const ribbon = [...boundary, ...[...boundary].reverse().map(p => ({ x: p.x, y: p.y - TILE_PATCH.depth }))];
  for (let cx = firstX; cx <= lastX; cx++) {
    // Bound geometry by this column first, avoiding an O(all points * all chunks) build.
    const column = clip(clip(ribbon, 'x', cx * step, 1), 'x', (cx + 1) * step, -1);
    if (!column.length) continue;
    const low = Math.min(...column.map(p => p.y)), high = Math.max(...column.map(p => p.y));
    for (let cy = Math.floor(low / step); cy <= Math.floor(high / step); cy++) {
      const polygon = clip(clip(column, 'y', cy * step, 1), 'y', (cy + 1) * step, -1);
      if (polygon.length < 3) continue;
      const origin = { x: cx * step, y: cy * step };
      const tiles = new Uint16Array(1024);
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        if (style === 'muted') {
          // Preserve the accepted prototype exactly as a selectable comparison.
          const hash = Math.imul(cx * 32 + x, 374761393) ^ Math.imul(cy * 32 + y, 668265263);
          tiles[y * 32 + x] = 1 + ((hash ^ (hash >>> 13)) >>> 0) % 4;
        } else {
          const lx = origin.x + (x + .5) * size, ly = origin.y + (y + .5) * size;
          const d = centre - pad.angleRadians, c = Math.cos(d), s = Math.sin(d);
          const id = appearanceAt(domain, lx * c - (ly + radius) * s,
            lx * s + (ly + radius) * c - radius);
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
    bytes: chunks.reduce((n, p) => n + p.tiles.byteLength + (p.clipPolygon?.length ?? 0) * 16, boundary.length * 16),
    buildMs: performance.now() - started };
}

export interface TileStats {
  targetAngle?: number; pending?: boolean; fineRequests?: number;
  mode: string; tileMetres: number; residentChunks: number; visibleChunks: number;
  tileDraws: number; clipDraws: number; submittedCells: number; bufferBytes: number; buildMs: number;
  coverage: string; boundaryToleranceMetres: number;
  materialDomain: string; materialStyle: MaterialStyle;
}

/** Single active patch, no full-world cache or loader. Retired worlds/sizes are released.
 * Only per-visible-chunk transforms are touched each frame; cells/polygons stay immutable. */
export class SuccessorTiles {
  private static remainingBuilds = Infinity;
  /** Host frame gate shared by at most four independent bounded proof presenters. */
  static beginFrame(): void { SuccessorTiles.remainingBuilds = 1; }
  size: TileSize | 0 = .5;
  targetAngle?: number;
  /** Review-only deterministic readiness delay, milliseconds; no async world loader. */
  delayMs = 0;
  private readyAt = 0;
  private pendingKey = '';
  private detailed = false;
  style: MaterialStyle = 'colored';
  private patch?: TilePatch;
  private renderer?: Renderer;
  private palette?: readonly string[];
  private visible: Chunk[] = [];
  private readonly output: Chunk[] = [];
  readonly stats: TileStats = { mode: 'vector', tileMetres: .5, residentChunks: 0, visibleChunks: 0,
    tileDraws: 0, clipDraws: 0, submittedCells: 0, bufferBytes: 0, buildMs: 0,
    coverage: 'Bounded landing sector only; macro terrain continues outside the patch.', boundaryToleranceMetres: TILE_PATCH.tolerance,
    materialDomain: '', materialStyle: 'colored' };

  clear(): void { this.patch = undefined; this.visible.length = this.output.length = 0; this.renderer = undefined;
    this.palette = undefined; this.pendingKey = ''; this.readyAt = 0; this.detailed = false;
    this.stats.pending = false; this.stats.fineRequests = 0; this.stats.materialDomain = '';
    this.stats.residentChunks = this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = 0;
    this.stats.submittedCells = this.stats.bufferBytes = this.stats.buildMs = 0;
  }

  draw(profile: SurfaceProfile, query: (a: number) => number, renderer: Renderer,
    bodyOrigin: Vec, spin: number, camera: Camera, width: number, height: number,
    body: 'planet' | 'moon' = 'planet'): readonly Chunk[] {
    this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = this.stats.submittedCells = 0;
    this.stats.mode = 'vector';
    this.stats.materialStyle = this.style;
    this.output.length = 0;
    if (!this.size) { this.clear(); return this.output; }
    this.stats.tileMetres = this.size;
    if (renderer.features?.tileChunks?.version !== 1 || !renderer.features.tilePalettes) {
      this.clear(); this.stats.mode = 'unsupported renderer: vector baseline'; return this.output;
    }
    // Do not generate close-up terrain when starting directly in an orbital view.
    const distance = Math.hypot(camera.center.x - bodyOrigin.x, camera.center.y - bodyOrigin.y);
    const viewRadius = Math.hypot(width, height) / (2 * camera.scale);
    if (distance + viewRadius < profile.bounds.minRadius - TILE_PATCH.depth || distance - viewRadius > profile.bounds.maxRadius) {
      this.clear(); this.stats.mode = 'coarse backing: no local surface in view'; return this.output;
    }
    const cellPixels = camera.scale * this.size;
    this.detailed = cellPixels >= (this.detailed ? 1.5 : 2);
    if (!this.detailed) {
      this.clear(); this.stats.mode = 'overview: zero fine demand'; return this.output;
    }
    this.stats.fineRequests = 1;
    const center = this.targetAngle ?? profile.pads.find(p => p.id === 'landing-area')!.angleRadians;
    this.stats.targetAngle = center;
    const key = `${profile.identity}:${center}:${this.size}:${this.style}:${body}`;
    if (key !== this.pendingKey) { this.pendingKey = key; this.readyAt = performance.now() + this.delayMs; }
    if (performance.now() < this.readyAt) {
      // Drop previous target immediately. Old completion cannot populate this target.
      this.patch = undefined; this.visible.length = 0;
      this.stats.residentChunks = this.stats.bufferBytes = 0;
      this.stats.pending = true; this.stats.mode = 'waiting: complete coarse backing'; return this.output;
    }
    this.stats.pending = false;
    const domain = MATERIAL_DOMAINS[body];
    if (this.patch?.profile !== profile || this.patch.size !== this.size || this.patch.domain !== domain || this.patch.style !== this.style || this.patch.centerAngle !== center) {
      if (SuccessorTiles.remainingBuilds <= 0) {
        this.patch = undefined; this.visible.length = 0; this.stats.pending = true;
        this.stats.residentChunks = this.stats.bufferBytes = 0;
        this.stats.mode = 'generation budget: complete coarse backing'; return this.output;
      }
      SuccessorTiles.remainingBuilds--;
      this.patch = buildTilePatch(profile, this.size, query, domain, this.style, center);
      this.visible = this.patch.chunks.map(p => ({ ...p, origin: { x: 0, y: 0 } }));
    }
    const palette = this.style === 'muted' ? TILE_PALETTE : MATERIAL_PALETTES[body];
    if (this.renderer !== renderer || this.palette !== palette) {
      renderer.features.tilePalettes.register(this.style === 'muted' ? TILE_PALETTE_ID : domain.id, palette);
      this.renderer = renderer; this.palette = palette;
    }
    this.stats.materialDomain = domain.id;
    const patch = this.patch;
    this.stats.residentChunks = patch.chunks.length; this.stats.bufferBytes = patch.bytes; this.stats.buildMs = patch.buildMs;
    const angle = spin + patch.centerAngle - Math.PI / 2, c = Math.cos(angle), s = Math.sin(angle);
    const cc = Math.cos(camera.rotation), cs = Math.sin(camera.rotation), result = this.output;
    const projected = angle + camera.rotation;
    const margin = this.size * 16 * camera.scale * (Math.abs(Math.cos(projected)) + Math.abs(Math.sin(projected)));
    for (let i = 0; i < patch.chunks.length; i++) {
      const p = patch.chunks[i]!, half = p.tileMetres * 16;
      const x = p.origin.x, y = p.origin.y + profile.referenceRadius;
      const wx = bodyOrigin.x + x * c - y * s, wy = bodyOrigin.y + x * s + y * c;
      const dx = wx + half * (c - s) - camera.center.x, dy = wy + half * (s + c) - camera.center.y;
      const sx = width / 2 + (dx * cc - dy * cs) * camera.scale;
      const sy = height / 2 - (dx * cs + dy * cc) * camera.scale;
      if (sx + margin < 0 || sx - margin > width || sy + margin < 0 || sy - margin > height) continue;
      const transformed = this.visible[i]! as { origin: Vec; rotationRadians?: number };
      (transformed.origin as { x: number; y: number }).x = wx;
      (transformed.origin as { x: number; y: number }).y = wy;
      transformed.rotationRadians = angle;
      result.push(this.visible[i]!);
    }
    if (result.length > 200) { result.length = 0; this.stats.mode = 'capacity: complete coarse backing'; }
    else this.stats.mode = 'bounded tile prototype';
    this.stats.visibleChunks = this.stats.tileDraws = this.stats.clipDraws = result.length;
    this.stats.submittedCells = result.length * 1024;
    return result;
  }
}
