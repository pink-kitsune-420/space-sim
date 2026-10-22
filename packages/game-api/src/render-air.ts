import type { Vec } from './state';
import type { Camera, RenderBody } from './presentation';

/** Independent decorative radial air. Heights are metres above the maximum canonical
 * terrain radius (or body.radius). This replaces legacy sky/glow even in off mode.
 * Near views include a lighting-based sky that fades to space with altitude and overview zoom; off keeps clear space.
 * Phase is supplied in body-fixed radians; renderers never advance time. No weather,
 * ground lighting, collision or shader-pack ABI is implied. Values must be finite;
 * heights positive, colors/opacity in 0..1. Unsupported providers may omit this effect. */
export interface RenderAir {
  readonly mode: 'off' | 'air' | 'clouds';
  readonly heightMetres: number;
  readonly cloudAltitudeMetres: number;
  readonly cloudThicknessMetres: number;
  readonly color: readonly [number, number, number];
  readonly opacity: number;
  readonly phaseRadians: number;
  /** Optional shared direction toward the star, in system coordinates.
   * Kept separate from ground sunDirection so enabling air cannot relight tiles/terrain. */
  readonly sunDirection?: Vec;
}

/** Maximum angular segments per body/pass, independent of world or fine-cell count. */
export const AIR_SEGMENTS = 512;
const valid = (a: RenderAir): boolean => ['off', 'air', 'clouds'].includes(a.mode)
  && [a.heightMetres, a.cloudAltitudeMetres, a.cloudThicknessMetres].every(v => Number.isFinite(v) && v > 0)
  && a.color.length === 3 && a.color.every(v => Number.isFinite(v) && v >= 0 && v <= 1)
  && Number.isFinite(a.opacity) && a.opacity >= 0 && a.opacity <= 1 && Number.isFinite(a.phaseRadians);

/** Seamless bounded periodic coverage, not a simulated or saved weather field.
 * Body-fixed angle and supplied phase are the only inputs; camera/resolution are absent. */
export function airCloudCoverage(angle: number, phase: number): number {
  const x = angle - phase;
  const n = .38 + .14 * Math.sin(17 * x) + .3 * Math.sin(41 * x + .7) + .16 * Math.sin(73 * x + 2);
  const t = Math.max(0, Math.min(1, (n - .5) / .24));
  return t * t * (3 - 2 * t);
}

/** Reusable camera-relative triangle mesh (CSS x/y then straight RGBA per vertex).
 * `length` counts floats valid until the next update; no buffers are retained by a
 * draw consumer after draw returns. Four air bands plus two tapered cloud halves, <=512
 * view-limited segments, plus a near-view sky quad in the far layer. Storage is
 * fixed, with no per-segment allocations. The consumer
 * MUST mask outside all canonical ground silhouettes and draw gameplay cues later.
 * The shell is a radial 2D section, with no far hemisphere projected onto ground. */
export class AirMesh {
  readonly vertices = new Float32Array(AIR_SEGMENTS * 6 * 36);
  length = 0;
  private cr = 1; private sr = 0; private ax = 0; private ay = 0;
  private theta = 0; private anchor = 0; private scale = 1; private width = 0; private height = 0;
  private vertex(angle: number, radius: number, r: number, g: number, b: number, alpha: number): void {
    const d = angle - this.theta;
    const radial = radius - this.anchor - 2 * radius * Math.sin(d / 2) ** 2;
    const tangent = radius * Math.sin(d);
    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    const x = this.ax + c * radial - s * tangent, y = this.ay + s * radial + c * tangent;
    this.screenVertex(this.width / 2 + (x * this.cr - y * this.sr) * this.scale,
      this.height / 2 - (x * this.sr + y * this.cr) * this.scale, r, g, b, alpha);
  }
  private screenVertex(x: number, y: number, r: number, g: number, b: number, alpha: number): void {
    const out = this.vertices; let i = this.length;
    out[i++] = x; out[i++] = y;
    out[i++] = r; out[i++] = g; out[i++] = b; out[i++] = alpha;
    this.length = i;
  }
  /** Build only the requested layer. Off/invalid/culled bodies yield zero vertices.
   * Air is presentation-only; profile extrema are read without sampling fine cells. */
  update(body: RenderBody, camera: Camera, width: number, height: number, layer: 'far' | 'near'): void {
    this.length = 0;
    const air = body.air;
    if (!air || !valid(air) || air.mode === 'off' || air.opacity === 0 || body.surfaceFeatures === 'star'
      || !(camera.scale > 0) || !Number.isFinite(camera.scale)) return;
    const min = body.surface?.bounds.minRadius ?? body.radius, max = body.surface?.bounds.maxRadius ?? body.radius;
    const outer = max + Math.max(air.heightMetres, air.cloudAltitudeMetres + air.cloudThicknessMetres);
    const x = camera.center.x - body.position.x, y = camera.center.y - body.position.y;
    const distance = Math.hypot(x, y), view = Math.hypot(width, height) / (2 * camera.scale) + 2 / camera.scale;
    if (distance - view > outer || distance + view < min) return;
    this.theta = Math.atan2(y, x); this.anchor = max;
    const c = Math.cos(this.theta), s = Math.sin(this.theta);
    this.ax = max * c - x; this.ay = max * s - y;
    this.cr = Math.cos(camera.rotation); this.sr = Math.sin(camera.rotation);
    this.scale = camera.scale; this.width = width; this.height = height;
    // The view's enclosing circle conservatively bounds every shell intersection.
    const half = distance <= view ? Math.PI : Math.asin(Math.min(1, view / distance));
    const start = this.theta - half, span = 2 * half;
    const sun = air.sunDirection ?? body.sunDirection;
    if (layer === 'far') {
      // Camera centre is a view target, not a physical observer. Apparent-size
      // fading keeps body-centred orbital maps in space, even with a landed ship.
      const near = smoothstep(.6, 1.4, body.radius * camera.scale / Math.max(width, height));
      const density = smoothstep(.1, .65, (max + air.heightMetres - distance) / air.heightMetres);
      const alpha = near * density;
      if (alpha > .0001) {
        const cosSun = sun && distance > 0 ? (x * sun.x + y * sun.y) / distance : 1;
        const day = (skyLight(cosSun) - .2) / .8, warm = twilight(cosSun) * .35;
        const br = (.018 + (air.color[0] * .9 - .018) * day) * (1 - warm) + warm;
        const bg = (.03 + (air.color[1] * .9 - .03) * day) * (1 - warm) + .45 * warm;
        const bb = (.05 + (air.color[2] * .9 - .05) * day) * (1 - warm) + .2 * warm;
        const tr = .006 + (air.color[0] * .55 - .006) * day;
        const tg = .012 + (air.color[1] * .55 - .012) * day;
        const tb = .026 + (air.color[2] * .55 - .026) * day;
        const nx = distance ? (x * this.cr - y * this.sr) / distance : 0;
        const ny = distance ? -(x * this.sr + y * this.cr) / distance : -1;
        const tx = -ny, ty = nx, extent = Math.hypot(width, height) / 2 + 2;
        const cx = width / 2, cy = height / 2;
        this.screenVertex(cx - nx * extent - tx * extent, cy - ny * extent - ty * extent, br, bg, bb, alpha);
        this.screenVertex(cx - nx * extent + tx * extent, cy - ny * extent + ty * extent, br, bg, bb, alpha);
        this.screenVertex(cx + nx * extent - tx * extent, cy + ny * extent - ty * extent, tr, tg, tb, alpha);
        this.screenVertex(cx + nx * extent - tx * extent, cy + ny * extent - ty * extent, tr, tg, tb, alpha);
        this.screenVertex(cx - nx * extent + tx * extent, cy - ny * extent + ty * extent, br, bg, bb, alpha);
        this.screenVertex(cx + nx * extent + tx * extent, cy + ny * extent + ty * extent, tr, tg, tb, alpha);
      }
    }
    for (let band = layer === 'far' ? 2 : 0; band < (layer === 'far' ? 4 : air.mode === 'clouds' ? 6 : 2); band++) {
      if (layer === 'near' && band >= 2 && band < 4) continue;
      const cloud = band >= 4;
      const segments = Math.min(AIR_SEGMENTS, Math.max(4, Math.ceil(span * (cloud ? 64 : 8)),
        Math.ceil(span * Math.sqrt(outer * camera.scale / 1.6))));
      const lo = cloud ? max + air.cloudAltitudeMetres : min + (max + air.heightMetres - min) * band / 4;
      const hi = cloud ? lo + air.cloudThicknessMetres : min + (max + air.heightMetres - min) * (band + 1) / 4;
      if (distance - view > hi || distance + view < lo) continue;
      for (let j = 0; j < segments; j++) {
        const a = start + span * j / segments, b = start + span * (j + 1) / segments;
        const middle = (a + b) / 2;
        const cosSun = sun ? Math.cos(middle) * sun.x + Math.sin(middle) * sun.y : 1;
        const light = skyLight(cosSun), warm = twilight(cosSun) * .35;
        const r = cloud ? .83 : air.color[0] * (1 - warm) + warm;
        const g = cloud ? .87 : air.color[1] * (1 - warm) + .6 * warm;
        const bl = cloud ? .9 : air.color[2] * (1 - warm) + .35 * warm;
        const coverageA = cloud ? airCloudCoverage(a - (body.rotation ?? 0), air.phaseRadians) : 1;
        const coverageB = cloud ? airCloudCoverage(b - (body.rotation ?? 0), air.phaseRadians) : 1;
        const strength = cloud ? Math.min(1, air.opacity * 4) : air.opacity * (1 - band / 4);
        const peakA = strength * light * coverageA, peakB = strength * light * coverageB;
        const alphaA = band === 4 ? 0 : peakA, alphaB = band === 4 ? 0 : peakB;
        const outerA = cloud ? band === 4 ? peakA : 0 : air.opacity * light * (1 - (band + 1) / 4);
        const outerB = cloud ? band === 4 ? peakB : 0 : outerA;
        // A lens within the fixed shell, with clear gaps and both radial edges fading.
        const localA = a - (body.rotation ?? 0) - air.phaseRadians;
        const localB = b - (body.rotation ?? 0) - air.phaseRadians;
        const centerA = lo + (hi - lo) * (.5 + .12 * Math.sin(9 * localA));
        const centerB = lo + (hi - lo) * (.5 + .12 * Math.sin(9 * localB));
        const halfA = (hi - lo) * .35 * coverageA, halfB = (hi - lo) * .35 * coverageB;
        const loA = cloud ? band === 4 ? centerA - halfA : centerA : lo;
        const loB = cloud ? band === 4 ? centerB - halfB : centerB : lo;
        const hiA = cloud ? band === 4 ? centerA : centerA + halfA : hi;
        const hiB = cloud ? band === 4 ? centerB : centerB + halfB : hi;
        if (Math.max(peakA, peakB) < .0001) continue;
        this.vertex(a, loA, r, g, bl, alphaA); this.vertex(b, loB, r, g, bl, alphaB); this.vertex(a, hiA, r, g, bl, outerA);
        this.vertex(a, hiA, r, g, bl, outerA); this.vertex(b, loB, r, g, bl, alphaB); this.vertex(b, hiB, r, g, bl, outerB);
      }
    }
  }
}

/** Renderer lighting scalars shared with legacy terrain; cosine in the sun/body frame. */
const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo))); return t * t * (3 - 2 * t);
};
/** Brightness floor of the readable legacy night ground. */
export const NIGHT_LEVEL = .35;
/** Warm terminator tint in normalized RGB. */
export const TWILIGHT_COLOR: readonly [number, number, number] = [1, .6, .35];
/** Readable night ground floor, smoothly approaching daylight. */
export const daylight = (cosSun: number): number => NIGHT_LEVEL + (1 - NIGHT_LEVEL) * smoothstep(-.18, .18, cosSun);
/** Faint night air; full strength in daylight. */
export const skyLight = (cosSun: number): number => .2 + .8 * smoothstep(-.25, .1, cosSun);
/** Warmth at sunrise/sunset. */
export const twilight = (cosSun: number): number => 1 - smoothstep(0, .3, Math.abs(cosSun));
