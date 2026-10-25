// Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-Project

import type { Camera, RenderBody, SurfaceProfile, Vec } from '../../../packages/game-api/src/index';
import { TILE_PATCH } from './successor-tile-patch';

const TAU = 2 * Math.PI;
export const MAX_DEMAND_SECTORS = 64;
export const MAX_SECTOR_TESTS = 2048;
export interface TileChartLayout { readonly count: number; readonly step: number; readonly origin: number }
const layouts = new WeakMap<SurfaceProfile, TileChartLayout>();
const wrap = (a: number): number => ((a % TAU) + TAU) % TAU;

/** Immutable charts share canonical angular seams. The derivative margin keeps each
 * chart a single-valued tangent height field; no world cells are generated here. */
export function tileChartLayout(profile: SurfaceProfile): TileChartLayout {
  let layout = layouts.get(profile);
  if (!layout) {
    const width = Math.min(64 / profile.referenceRadius, Math.PI / 8,
      Math.atan2((profile.groundBounds ?? profile.bounds).minRadius, profile.bounds.maxAbsDerivative));
    const count = Math.ceil(TAU / width / 4) * 4;
    layout = Object.freeze({ count, step: TAU / count,
      origin: profile.pads.find(p => p.id === 'landing-area')?.angleRadians ?? Math.PI / 2 });
    layouts.set(profile, layout);
  }
  return layout;
}

/** Conservative radial ribbon versus viewport test in CSS/world metres. No actor,
 * prediction, generated patch or mutable physics state participates. */
export function localSurfaceInView(profile: SurfaceProfile, origin: Vec, camera: Camera, width: number, height: number): boolean {
  if (!(camera.scale > 0 && width > 0 && height > 0)
    || !Number.isFinite(camera.scale + camera.rotation + camera.center.x + camera.center.y + origin.x + origin.y + width + height)) return false;
  const distance = Math.hypot(camera.center.x - origin.x, camera.center.y - origin.y);
  const extent = Math.hypot(width, height) / (2 * camera.scale);
  return distance + extent >= (profile.groundBounds ?? profile.bounds).minRadius - TILE_PATCH.depth
    && distance - extent <= (profile.groundBounds ?? profile.bounds).maxRadius;
}

export type SuccessorLocalBody = RenderBody & { readonly id: 'planet' | 'moon'; readonly surface: SurfaceProfile };
/** Choose visible local ground from the rendered frame, never the controlled ship or
 * stale selected target. The ground and tile masks therefore use identical spin/origin. */
export function successorTileBody(bodies: readonly RenderBody[], camera: Camera, width: number, height: number,
  preferred?: 'planet' | 'moon'): SuccessorLocalBody | undefined {
  let selected: SuccessorLocalBody | undefined, best = Infinity;
  for (const body of bodies) {
    if ((body.id !== 'planet' && body.id !== 'moon') || !body.surface
      || !localSurfaceInView(body.surface, body.position, camera, width, height)) continue;
    const score = Math.abs(Math.hypot(camera.center.x - body.position.x, camera.center.y - body.position.y) - body.surface.referenceRadius);
    if (score < best || score === best && body.id === preferred) {
      best = score; selected = body as SuccessorLocalBody;
    }
  }
  return selected;
}

/** Reused view-local demand scratch. Angular projection is conservative for rotated
 * rectangles; candidate bounds retain every polar-linear interval inside the radial
 * envelope. Indices are float64 integers, avoiding signed32 overflow on large bodies. */
export class TileDemand {
  readonly indices = new Float64Array(MAX_DEMAND_SECTORS);
  private readonly angles = new Float64Array(4);
  count = 0;
  tested = 0;
  overflow = false;
  wholeBody = false;
  angle = 0;
  layout?: TileChartLayout;
  reason = 'no visible local ground';

  update(profile: SurfaceProfile, origin: Vec, spin: number, camera: Camera, width: number, height: number): void {
    this.count = this.tested = 0; this.overflow = this.wholeBody = false;
    this.reason = 'no visible local ground';
    if (!Number.isFinite(spin) || !localSurfaceInView(profile, origin, camera, width, height)) return;
    const layout = this.layout = tileChartLayout(profile);
    if (!(layout.count > 0 && layout.count < Number.MAX_SAFE_INTEGER / 16)) {
      this.overflow = true; this.reason = 'chart address capacity'; return;
    }
    const dx = camera.center.x - origin.x, dy = camera.center.y - origin.y;
    this.angle = wrap(Math.atan2(dy, dx) - spin);
    const cc = Math.cos(camera.rotation), cs = Math.sin(camera.rotation);
    const cx = width / 2 - (dx * cc - dy * cs) * camera.scale;
    const cy = height / 2 + (dx * cs + dy * cc) * camera.scale;
    const outer = (profile.groundBounds ?? profile.bounds).maxRadius * camera.scale + 1;
    if (cx - outer >= 0 && cx + outer <= width && cy - outer >= 0 && cy + outer <= height) {
      this.wholeBody = true; this.reason = 'whole-body overview'; return;
    }
    const inside = cx >= 0 && cx <= width && cy >= 0 && cy <= height;
    let start = 0, span = TAU;
    if (!inside) {
      const c = Math.cos(spin), s = Math.sin(spin);
      for (let i = 0; i < 4; i++) {
        const x = (i & 1 ? width : -width) / (2 * camera.scale);
        const y = (i & 2 ? height : -height) / (2 * camera.scale);
        const wx = dx + x * cc + y * cs, wy = dy - x * cs + y * cc;
        this.angles[i] = wrap(Math.atan2(-wx * s + wy * c, wx * c + wy * s) - layout.origin);
      }
      // Four-value insertion sort needs no temporary arrays/comparator allocation.
      for (let i = 1; i < 4; i++) {
        const value = this.angles[i]!; let j = i;
        while (j && this.angles[j - 1]! > value) { this.angles[j] = this.angles[j - 1]!; j--; }
        this.angles[j] = value;
      }
      let gap = -1;
      for (let i = 0; i < 4; i++) {
        const next = i === 3 ? this.angles[0]! + TAU : this.angles[i + 1]!;
        const distance = next - this.angles[i]!;
        if (distance > gap) { gap = distance; start = next % TAU; }
      }
      span = TAU - gap;
    }
    const first = inside ? 0 : Math.ceil(start / layout.step - .5 - 1e-10);
    const last = inside ? layout.count - 1 : Math.floor((start + span) / layout.step + .5 + 1e-10);
    if (last - first + 1 > MAX_SECTOR_TESTS) {
      this.overflow = true; this.reason = 'candidate work capacity'; return;
    }
    const q = spin + camera.rotation;
    const inner = Math.max(0, (profile.groundBounds ?? profile.bounds).minRadius - TILE_PATCH.depth - TILE_PATCH.tolerance);
    for (let index = first; index <= last; index++) {
      this.tested++;
      const wrapped = ((index % layout.count) + layout.count) % layout.count;
      const center = layout.origin + wrapped * layout.step + q;
      const a = center - layout.step / 2, b = center + layout.step / 2;
      let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
      // Endpoints plus every contained Cartesian extremum bound the annular sector.
      const k0 = Math.ceil(a / (Math.PI / 2)), k1 = Math.floor(b / (Math.PI / 2));
      for (let point = -2; point <= k1 - k0; point++) {
        const angle = point === -2 ? a : point === -1 ? b : (k0 + point) * Math.PI / 2;
        const c = Math.cos(angle), s = Math.sin(angle);
        for (let edge = 0; edge < 2; edge++) {
          const r = edge ? (profile.groundBounds ?? profile.bounds).maxRadius + TILE_PATCH.tolerance : inner;
          const x = cx + r * c * camera.scale, y = cy - r * s * camera.scale;
          xmin = Math.min(xmin, x); xmax = Math.max(xmax, x); ymin = Math.min(ymin, y); ymax = Math.max(ymax, y);
        }
      }
      if (xmax < -1 || xmin > width + 1 || ymax < -1 || ymin > height + 1) continue;
      if (this.count === MAX_DEMAND_SECTORS) {
        this.count = 0; this.overflow = true; this.reason = 'visible sector capacity'; return;
      }
      this.indices[this.count++] = wrapped;
    }
    this.reason = this.count ? 'camera-visible surface' : 'no visible local ground';
  }
}
