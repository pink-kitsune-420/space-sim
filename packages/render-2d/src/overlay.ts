import type { Camera, OverlayPrimitive, Vec } from '../../game-api/src/index';
import { createProjector } from './frame';

/** Module overlays in CSS pixels, culled and clipped once so every renderer draws the same
 * geometry. Clipping keeps world-space shapes far outside the view from reaching the
 * rasterizer with million-pixel coordinates. */
export type ScreenOverlay =
  | { readonly kind: 'line'; readonly points: readonly Vec[]; readonly color: string; readonly width: number }
  | { readonly kind: 'polygon'; readonly points: readonly Vec[]; readonly color: string }
  | { readonly kind: 'circle'; readonly center: Vec; readonly radius: number; readonly color: string; readonly width: number; readonly fill: boolean }
  | { readonly kind: 'text'; readonly at: Vec; readonly text: string; readonly color: string; readonly align: 'left' | 'center' | 'right' };

const MARGIN = 64;
const DEFAULT_WIDTH = 1.5;
const ARC_SAMPLES = 96;
interface Box { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }

/** Liang–Barsky: the part of a→b inside the box, and whether either end was cut. */
function clip(a: Vec, b: Vec, box: Box): { readonly a: Vec; readonly b: Vec; readonly cutStart: boolean; readonly cutEnd: boolean } | undefined {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - box.x0], [dx, box.x1 - a.x], [-dy, a.y - box.y0], [dy, box.y1 - a.y]] as const) {
    if (p === 0) { if (q < 0) return undefined; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return undefined; if (r > t0) t0 = r; }
    else { if (r < t0) return undefined; if (r < t1) t1 = r; }
  }
  return { a: t0 > 0 ? { x: a.x + t0 * dx, y: a.y + t0 * dy } : a, b: t1 < 1 ? { x: a.x + t1 * dx, y: a.y + t1 * dy } : b,
    cutStart: t0 > 0, cutEnd: t1 < 1 };
}
/** Visible runs of a polyline. */
function clipPolyline(points: readonly Vec[], box: Box): Vec[][] {
  const runs: Vec[][] = [];
  let run: Vec[] | undefined;
  for (let i = 1; i < points.length; i++) {
    const part = clip(points[i - 1]!, points[i]!, box);
    if (!part) { run = undefined; continue; }
    if (!run || part.cutStart) { run = [part.a]; runs.push(run); }
    run.push(part.b);
    if (part.cutEnd) run = undefined;
  }
  return runs;
}

/** Points along the part of a huge circle that can reach the view, plus the direction from
 * the view toward the circle's centre. */
function visibleArc(center: Vec, radius: number, width: number, height: number): { readonly arc: Vec[]; readonly inward: Vec } {
  const cx = width / 2, cy = height / 2;
  const theta = Math.atan2(cy - center.y, cx - center.x);
  let lo = 0, hi = 0;
  for (const [x, y] of [[-MARGIN, -MARGIN], [width + MARGIN, -MARGIN], [width + MARGIN, height + MARGIN], [-MARGIN, height + MARGIN]] as const) {
    let d = Math.atan2(y - center.y, x - center.x) - theta;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    lo = Math.min(lo, d); hi = Math.max(hi, d);
  }
  // Pad by a fraction of the visible span: a fixed angle would leave chords hundreds of
  // pixels off a planet-sized circle.
  const pad = (hi - lo) * .05 + 2 / radius;
  const start = theta + lo - pad, span = Math.min(2 * Math.PI, hi - lo + 2 * pad);
  const arc: Vec[] = [];
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const a = start + span * i / ARC_SAMPLES;
    arc.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  const d = Math.hypot(center.x - cx, center.y - cy) || 1;
  return { arc, inward: { x: (center.x - cx) / d, y: (center.y - cy) / d } };
}

export function screenOverlays(primitives: readonly OverlayPrimitive[], camera: Camera, width: number, height: number): ScreenOverlay[] {
  const project = createProjector(camera, width, height);
  const box: Box = { x0: -MARGIN, y0: -MARGIN, x1: width + MARGIN, y1: height + MARGIN };
  const corner = Math.hypot(width / 2, height / 2);
  const out: ScreenOverlay[] = [];
  for (const p of primitives) {
    const at = (v: Vec): Vec => p.space === 'world' ? project(v) : v;
    if (p.kind === 'text') {
      const anchor = at(p.at);
      if (anchor.x >= -200 && anchor.x <= width + 200 && anchor.y >= -40 && anchor.y <= height + 40) {
        out.push({ kind: 'text', at: anchor, text: p.text, color: p.color, align: p.align ?? 'left' });
      }
      continue;
    }
    const lineWidth = p.width ?? DEFAULT_WIDTH;
    if (p.kind === 'line') {
      const points = p.points.map(at);
      if (p.closed) points.push(points[0]!);
      for (const run of clipPolyline(points, box)) out.push({ kind: 'line', points: run, color: p.color, width: lineWidth });
      continue;
    }
    const center = at(p.center);
    const radius = p.space === 'world' ? p.radius * camera.scale : p.radius;
    const distance = Math.hypot(center.x - width / 2, center.y - height / 2);
    // Entirely outside the view, or (for an outline) a ring that encloses the whole view.
    if (distance - radius > corner + MARGIN || (!p.fill && radius - distance > corner + MARGIN + lineWidth)) continue;
    if (radius <= 2 * Math.max(width, height)) {
      out.push({ kind: 'circle', center, radius, color: p.color, width: lineWidth, fill: !!p.fill });
      continue;
    }
    if (p.fill && radius - distance > corner + MARGIN) {
      out.push({ kind: 'polygon', color: p.color, points: [{ x: box.x0, y: box.y0 }, { x: box.x1, y: box.y0 }, { x: box.x1, y: box.y1 }, { x: box.x0, y: box.y1 }] });
      continue;
    }
    const { arc, inward } = visibleArc(center, radius, width, height);
    if (!p.fill) {
      for (const run of clipPolyline(arc, box)) out.push({ kind: 'line', points: run, color: p.color, width: lineWidth });
      continue;
    }
    const depth = 2 * corner + 200, first = arc[0]!, last = arc.at(-1)!;
    out.push({ kind: 'polygon', color: p.color, points: [...arc, { x: last.x + inward.x * depth, y: last.y + inward.y * depth },
      { x: first.x + inward.x * depth, y: first.y + inward.y * depth }] });
  }
  return out;
}

/** `#RRGGBB` or `#RRGGBBAA` (already validated) as linear 0–1 RGBA. */
export function overlayRgba(color: string): readonly [number, number, number, number] {
  const n = (i: number): number => parseInt(color.slice(i, i + 2), 16) / 255;
  return [n(1), n(3), n(5), color.length === 9 ? n(7) : 1];
}
