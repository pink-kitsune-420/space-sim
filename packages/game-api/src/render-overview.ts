import type { RenderBody } from './presentation';

/** Filtered illustrative ground only. Levels are coarse-to-fine, body-fixed polar
 * bins, RGBA in premultiplied linear light. No collision, topology or fine cells.
 * Treat the descriptor and arrays as immutable; replace the descriptor object on
 * palette/content revision. Providers may use fewer rings; canonical terrain/coasts and cues retain authority. */
export interface RenderOverview {
  readonly levels: readonly { readonly sectors: number; readonly rings: number; readonly rgba: Float32Array }[];
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

/** Fixed body-local query. Camera changes select filtering only, never anchors.
 * Output is straight display RGBA, multiplied by a low-frequency sphere light.
 * The pseudo-normal has no relationship to contact or traversable latitude. */
export function overviewColor(body: RenderBody, angle: number, radiusFraction: number, footprintPixels: number,
  out: Float64Array): boolean {
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
