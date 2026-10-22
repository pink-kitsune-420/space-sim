/** Internal F9 foundation; not yet a supported SDK root export.
 * Coordinates are dimensionless lattice coordinates; output is [value, dx, dy, dz].
 * First-party integer hashing and quintic interpolation; no trigonometry or heap
 * allocation. Integer lattice addresses wrap modulo 2^32, never rounded floats. */
export function latticeValue(seed: number, x: number, y: number, z: number): number {
  let h = (seed ^ Math.imul(x, 0x9e3779b1) ^ Math.imul(y, 0x85ebca77) ^ Math.imul(z, 0xc2b2ae3d)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff * 2 - 1;
}

/** Each partial derivative is bounded by 2*max(quintic') = 3.75.
 * Convex interpolation bounds value by [-1,1]. C2 across lattice boundaries. */
export const NOISE_GRADIENT_BOUND = 3.75 * Math.sqrt(3);

/** Caller supplies at least four Float64 slots. Coordinates must be finite with
 * absolute value <2^31, so adjacent lattice cells retain their fractional address. */
export function noise3(seed: number, x: number, y: number, z: number, out: Float64Array): void {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const a = x - ix, b = y - iy, c = z - iz;
  const u = a * a * a * (a * (a * 6 - 15) + 10);
  const v = b * b * b * (b * (b * 6 - 15) + 10);
  const w = c * c * c * (c * (c * 6 - 15) + 10);
  const du = 30 * a * a * (a - 1) * (a - 1);
  const dv = 30 * b * b * (b - 1) * (b - 1);
  const dw = 30 * c * c * (c - 1) * (c - 1);
  const p000 = latticeValue(seed, ix, iy, iz), p100 = latticeValue(seed, ix + 1, iy, iz);
  const p010 = latticeValue(seed, ix, iy + 1, iz), p110 = latticeValue(seed, ix + 1, iy + 1, iz);
  const p001 = latticeValue(seed, ix, iy, iz + 1), p101 = latticeValue(seed, ix + 1, iy, iz + 1);
  const p011 = latticeValue(seed, ix, iy + 1, iz + 1), p111 = latticeValue(seed, ix + 1, iy + 1, iz + 1);
  const a00 = p000 + u * (p100 - p000), a10 = p010 + u * (p110 - p010);
  const a01 = p001 + u * (p101 - p001), a11 = p011 + u * (p111 - p011);
  const b0 = a00 + v * (a10 - a00), b1 = a01 + v * (a11 - a01);
  out[0] = b0 + w * (b1 - b0);
  out[1] = du * ((p100 - p000) * (1 - v) * (1 - w) + (p110 - p010) * v * (1 - w)
    + (p101 - p001) * (1 - v) * w + (p111 - p011) * v * w);
  out[2] = dv * ((a10 - a00) * (1 - w) + (a11 - a01) * w);
  out[3] = dw * (b1 - b0);
}

export type FractalMode = 'fbm' | 'ridge' | 'billow';

/** Normalized weighted octaves; frequencies double, weights halve. Ridge and
 * billow are centered in [-1,1]. At an absolute-value cusp, derivative is zero;
 * the global Lipschitz bound still applies. No per-query allocation. */
export function fractal3(seed: number, x: number, y: number, z: number, frequency: number,
  octaves: number, mode: FractalMode, out: Float64Array): void {
  let value = 0, dx = 0, dy = 0, dz = 0, weight = 1, sum = 0;
  for (let i = 0; i < octaves; i++) {
    noise3((seed + Math.imul(i, 0x9e3779b9)) >>> 0, x * frequency, y * frequency, z * frequency, out);
    const n = out[0]!, sign = Math.sign(n);
    const derivative = mode === 'fbm' ? 1 : mode === 'billow' ? 2 * sign : -4 * (1 - Math.abs(n)) * sign;
    value += weight * (mode === 'fbm' ? n : mode === 'billow' ? 2 * Math.abs(n) - 1 : 2 * (1 - Math.abs(n)) ** 2 - 1);
    dx += weight * derivative * out[1]! * frequency;
    dy += weight * derivative * out[2]! * frequency;
    dz += weight * derivative * out[3]! * frequency;
    sum += weight; weight *= .5; frequency *= 2;
  }
  out[0] = value / sum; out[1] = dx / sum; out[2] = dy / sum; out[3] = dz / sum;
}

/** Euclidean derivative with respect to the supplied unit-sphere Cartesian
 * coordinates, not metres along the surface. Divide by radius for physical slope. */
export function fractalSlopeBound(frequency: number, octaves: number, mode: FractalMode): number {
  let weight = 1, sum = 0, slope = 0;
  for (let i = 0; i < octaves; i++) {
    slope += weight * frequency; sum += weight; weight *= .5; frequency *= 2;
  }
  return slope / sum * NOISE_GRADIENT_BOUND * (mode === 'ridge' ? 4 : mode === 'billow' ? 2 : 1);
}
