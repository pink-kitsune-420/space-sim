import type { RenderBody } from './presentation';
import type { SurfaceProfile } from './surface';

/** Filtered illustrative ground only. Levels are coarse-to-fine, body-fixed polar
 * bins, RGBA in premultiplied linear light. No collision, topology or fine cells.
 * Treat the descriptor and arrays as immutable; replace the descriptor object on
 * palette/content revision. Providers may use fewer rings; canonical terrain/coasts and cues retain authority. */
export interface RenderOverview {
  readonly levels: readonly { readonly sectors: number; readonly rings: number; readonly rgba: Float32Array }[];
  /** Optional opaque, three-material canonical surface ribbon. The face is only a
   * filtered continuation of this circumference; it adds no latitude or geology. */
  readonly surface?: RenderOverviewSurface;
}
/** Immutable compact surface quadrature. Packed samples hold two 2-bit palette
 * indices (0..2) per angular/depth bin. Angular mips run coarse-to-fine, excluding
 * the leaf; each pair of bytes holds material 0/1 coverage /255, with material 2
 * the residual. Depth rows remain independent for anisotropic physical filtering.
 * Palette triples are linear RGB. <=8192 sectors, <=8 rows, <=13 mixture levels.
 * All angles are body-fixed, depth is metres below canonical ground, not sea. */
export interface RenderOverviewSurface {
  readonly sectors: number;
  readonly rows: number;
  readonly depthMetres: number;
  readonly samples: Uint8Array;
  readonly palette: readonly (readonly number[])[];
  readonly levels: readonly { readonly sectors: number; readonly fractions: Uint8Array }[];
}

/** Sample a finite physical footprint of the canonical ribbon. Output is unlit,
 * straight display RGB with alpha 1, matching unlit foreground palette identities.
 * Zoom selects only filtering: no descriptor calls, allocations or fine demand.
 * Angular/depth quantization is bounded by one leaf bin plus the filter support. */
export function surfaceOverviewColor(body: RenderBody, angle: number, depthMetres: number, footprintMetres: number,
  out: Float64Array): boolean {
  const s = body.overview?.surface;
  if (!s || s.sectors < 1 || s.sectors > 8192 || s.rows < 1 || s.rows > 8 || s.levels.length > 13
    || s.samples.length !== s.sectors * s.rows || s.palette.length !== 3 || !(s.depthMetres > 0)
    || !Number.isInteger(s.rows) || Math.log2(s.sectors) !== s.levels.length
    || !Number.isFinite(angle + depthMetres + footprintMetres) || !(body.radius > 0)) return false;
  out.fill(0);
  const a = ((angle / (2 * Math.PI)) % 1 + 1) % 1;
  const footprint = Math.max(s.depthMetres / s.rows, footprintMetres);
  const lo = Math.max(0, Math.min(s.depthMetres, depthMetres) - footprint / 2);
  const hi = Math.min(s.depthMetres, Math.max(0, depthMetres) + footprint / 2);
  const target = Math.max(1, Math.min(s.sectors, 2 * Math.PI * body.radius / Math.max(1e-12, footprintMetres)));
  const lod = Math.log2(target), lower = Math.floor(lod), blend = lod - lower;
  let total = 0;
  for (let row = 0; row < s.rows; row++) {
    const weight = Math.max(0, Math.min(hi, (row + 1) * s.depthMetres / s.rows) - Math.max(lo, row * s.depthMetres / s.rows));
    if (!weight) continue;
    total += weight;
    for (let side = 0; side < 2; side++) {
      const l = Math.min(s.levels.length, lower + side), level = s.levels[l];
      const sectors = level?.sectors ?? s.sectors, amount = side ? blend : 1 - blend;
      if (level && (sectors !== 2 ** l || level.fractions.length !== sectors * s.rows * 2)) return false;
      const x = a * sectors - .5, ix = Math.floor(x), fraction = x - ix;
      for (let dx = 0; dx < 2; dx++) {
        const column = ((ix + dx) % sectors + sectors) % sectors;
        const w = weight * amount * (dx ? fraction : 1 - fraction);
        if (level) {
          const i = (row * sectors + column) * 2, first = level.fractions[i]! / 255, second = level.fractions[i + 1]! / 255;
          for (let c = 0; c < 3; c++) out[c] = out[c]! + w * (first * s.palette[0]![c]! + second * s.palette[1]![c]! + Math.max(0, 1 - first - second) * s.palette[2]![c]!);
        } else {
          const pair = s.samples[row * sectors + column]!;
          const first = s.palette[pair & 3], second = s.palette[(pair >> 2) & 3];
          if (!first || !second) return false;
          for (let c = 0; c < 3; c++) out[c] = out[c]! + w * (first[c]! + second[c]!) / 2;
        }
      }
    }
  }
  if (!(total > 0)) return false;
  for (let c = 0; c < 3; c++) out[c] = displayColor(out[c]! / total);
  out[3] = 1;
  return out.every(Number.isFinite);
}

/** Convert an sRGB channel to linear light. */
export const linearColor = (v: number): number => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
/** Convert a linear-light channel to sRGB. */
export const displayColor = (v: number): number => v <= .0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - .055;

/** Weight premultiplied linear samples by coverage/area. Transparent colors cannot
 * bleed RGB into their neighbors. Output can be reused by a caller. */
export function averageOverview(colors: ArrayLike<number>, weights: ArrayLike<number>, out: Float32Array): void {
  out.fill(0); let total = 0;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i]!; total += w;
    for (let c = 0; c < 4; c++) out[c] = out[c]! + colors[i * 4 + c]! * w;
  }
  if (total > 0) for (let c = 0; c < 4; c++) out[c] = out[c]! / total;
}

// Only immutable feature coefficients are cached, never view/zoom history. These
// reproduce the existing illustration's feature anchors; no new height authority.
const RELIEF = new WeakMap<SurfaceProfile, readonly (readonly number[])[]>();
function featureRelief(body: RenderBody, angle: number, u: number, circumferencePixels: number): number {
  const p = body.surface;
  if (!p || p.hasWater || u > .94 || u < .2) return 1;
  let features = RELIEF.get(p);
  if (!features) {
    const r = p.bounds.minRadius;
    features = p.features.map(f => f.kind === 'crater'
      ? [0, Math.cos(f.angleRadians) * .65, Math.sin(f.angleRadians) * .65,
        Math.min(.13, f.bowlRadiusMetres * .8 / r), Math.min(.65, f.depthMetres / 12), f.centralPeakHeightMetres / 12]
      : [1, Math.cos(f.angleRadians), Math.sin(f.angleRadians), Math.min(.3, f.widthMetres / r / 3), f.heightMetres / 12]);
    RELIEF.set(p, features);
  }
  const scale = p.bounds.maxRadius / p.bounds.minRadius;
  const x = u * scale * Math.cos(angle), y = u * scale * Math.sin(angle), sun = body.sunDirection, spin = body.rotation ?? 0;
  const sx = sun ? Math.cos(spin) * sun.x + Math.sin(spin) * sun.y : -.6;
  const sy = sun ? -Math.sin(spin) * sun.x + Math.cos(spin) * sun.y : .8;
  let shade = 1;
  for (const f of features) {
    if (f[0] === 0) {
      const dx = (x - f[1]!) / f[3]!, dy = (y - f[2]!) / f[3]!, q2 = dx * dx + dy * dy;
      if (q2 > 1.69) continue;
      const visibility = Math.max(0, Math.min(1, (f[3]! * circumferencePixels / (2 * Math.PI) - 1) / 2));
      const q = Math.sqrt(q2), bowl = Math.max(0, 1 - q2), rim = Math.max(0, 1 - Math.abs(q - 1) / .3);
      // Filled bowl and sun-facing rim, with the actual source central peak only.
      shade += visibility * f[4]! * (-.24 * bowl - .8 * bowl * (dx * sx + dy * sy) + .2 * rim);
      if (q < .25) shade += visibility * f[5]! * .3 * (1 - q / .25);
    } else {
      const along = (y * f[1]! - x * f[2]!) / f[3]!;
      if (Math.abs(along) > 1) continue;
      const radial = x * f[1]! + y * f[2]!;
      // Same two waves and .78-radius range anchor as the existing cue strokes.
      const crest = .78 + .025 * Math.sin((along + 1) * 2 * Math.PI);
      const across = (radial - crest) / .065;
      if (Math.abs(across) > 1) continue;
      const envelope = (1 - along * along) * (1 - across * across);
      shade += f[4]! * envelope * (.12 + .55 * across * (f[1]! * sx + f[2]! * sy));
    }
  }
  return 1 + (Math.max(.68, Math.min(1.28, shade)) - 1) * Math.min(1, (.94 - u) / .1);
}

/** Fixed body-local query. Camera changes select filtering only, never anchors.
 * Output is straight display RGBA, multiplied by a low-frequency sphere light.
 * The pseudo-normal has no relationship to contact or traversable latitude. */
export function overviewColor(body: RenderBody, angle: number, radiusFraction: number, footprintPixels: number,
  out: Float64Array): boolean {
  if (body.overview?.surface) {
    const u = Math.max(0, Math.min(1, radiusFraction));
    // A face pixel continues the selected circumference's visible crust. Deep
    // Cartesian disc strata cannot stand in for the actual ground at that angle.
    const footprint = 2 * Math.PI * body.radius * Math.max(3, footprintPixels / 96) / Math.max(1, footprintPixels * Math.max(.05, u));
    if (!surfaceOverviewColor(body, angle, (1 - u) * body.overview.surface.depthMetres, footprint, out)) return false;
    const z = Math.sqrt(Math.max(0, 1 - u * u)), spin = body.rotation ?? 0, sun = body.sunDirection;
    const light = sun ? .22 + .78 * Math.max(0, (u * (Math.cos(angle + spin) * sun.x + Math.sin(angle + spin) * sun.y) + .55 * z) / 1.142) : .55 + .45 * z;
    const relief = featureRelief(body, angle, u, footprintPixels), average = body.overview.levels[0]?.rgba;
    // Restrained display contrast after linear filtering; physical ribbon colors
    // remain exact. The center tends to the global mixture, avoiding polar spokes.
    const detail = Math.min(1, u / .35);
    for (let c = 0; c < 3; c++) {
      const mean = average ? displayColor(average[c]!) : out[c]!;
      const material = Math.max(0, Math.min(1, mean + (out[c]! - mean) * 1.8 * detail));
      out[c] = material * light * relief;
    }
    return true;
  }
  const levels = body.overview?.levels;
  if (!levels?.length || levels.length > 12) return false;
  out.fill(0);
  const a = ((angle / (2 * Math.PI)) % 1 + 1) % 1;
  for (let l = 0; l < levels.length; l++) {
    const level = levels[l]!;
    if (level.sectors < 1 || level.sectors > 128 || level.rings < 1 || level.rings > 16
      || !Number.isInteger(level.sectors) || !Number.isInteger(level.rings)
      || level.sectors * level.rings > 2048 || level.rgba.length !== level.sectors * level.rings * 4) return false;
    // Crossfade hierarchy levels while each sector spans 3..6 pixels. Changing
    // zoom cannot abruptly replace an entire material pattern at a LOD boundary.
    const t = l === 0 ? 1 : Math.max(0, Math.min(1, (footprintPixels * Math.max(0, Math.min(1, radiusFraction)) / level.sectors - 3) / 3));
    const ax = a * level.sectors - .5, ay = Math.max(0, Math.min(level.rings - 1, radiusFraction * level.rings - .5));
    const x = Math.floor(ax), y = Math.floor(ay), tx = ax - x, ty = ay - y;
    const x0 = (x + level.sectors) % level.sectors, x1 = (x0 + 1) % level.sectors, y1 = Math.min(level.rings - 1, y + 1);
    for (let c = 0; c < 4; c++) {
      const low = level.rgba[(y * level.sectors + x0) * 4 + c]! * (1 - tx) + level.rgba[(y * level.sectors + x1) * 4 + c]! * tx;
      const high = level.rgba[(y1 * level.sectors + x0) * 4 + c]! * (1 - tx) + level.rgba[(y1 * level.sectors + x1) * 4 + c]! * tx;
      out[c] = out[c]! * (1 - t) + (low * (1 - ty) + high * ty) * t;
    }
    if (t < 1) break;
  }
  const alpha = out[3]!;
  const spin = body.rotation ?? 0, sun = body.sunDirection;
  const u = Math.max(0, Math.min(1, radiusFraction)), z = Math.sqrt(Math.max(0, 1 - u * u));
  const light = sun ? .22 + .78 * Math.max(0, (u * (Math.cos(angle + spin) * sun.x + Math.sin(angle + spin) * sun.y) + .55 * z) / 1.142) : .55 + .45 * z;
  for (let c = 0; c < 3; c++) out[c] = displayColor(alpha > 0 ? out[c]! / alpha : 0) * light;
  out[3] = alpha;
  return out.every(Number.isFinite);
}
