/** Deterministic math for physics: the same bits in every JavaScript engine.
 *
 * `Math.sin`, `cos`, `atan2`, `exp`, `hypot` and non-integer `**` are implementation
 * defined: measured over 20,000 inputs, Node 22 and Chromium 156 (both V8) disagree in the
 * last bits on 3–20% of sin/cos/atan2/exp/pow results, and Firefox 157 on 35% of hypot
 * results. Hosts and clients then drift apart by up to a millimetre in 30 s.
 * IEEE 754 requires correctly rounded +, -, *, / and sqrt, so these functions use only
 * those operations: polynomial kernels on a reduced range, with Cody-Waite reduction by
 * constants split from high-precision values.
 * Accuracy is within a few ulps; identical bits everywhere is the point. */

/** π/2 in three parts: the first two have 33 significant bits, so n·part is exact for
 * |n| < 2^20 (arguments up to about 1.6e6 radians). */
const PIO2_1 = 1.5707963267341256;
const PIO2_2 = 6.077100506303966e-11;
const PIO2_3 = 2.0222662487959506e-21;
const INV_PIO2 = 0.6366197723675814;
/** Beyond this, reduce by whole turns first (rare: headings and moon phases stay small). */
const MEDIUM = 1.6e6;
const TAU = 2 * Math.PI;
const HALF_PI = Math.PI / 2;
const QUARTER_PI = Math.PI / 4;
const EIGHTH_PI = Math.PI / 8;
const TAN_PI_8 = Math.sqrt(2) - 1;
const TAN_PI_16 = 0.19891236737965800691;
const TAN_3PI_16 = 0.66817863791929891999;
/** ln 2 split: 32 bits then the rest; k·LN2_HI is exact for |k| < 2^21. */
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const INV_LN2 = 1.4426950408889634;

// Taylor coefficients, generated once from exact integer factorials (deterministic).
/** sin r = r + r·z·(SIN[0] + z·(SIN[1] + …)), z = r², terms r^3 … r^17. */
const SIN = Array.from({ length: 8 }, (_, k) => (k % 2 ? 1 : -1) / factorial(2 * k + 3));
/** cos r = 1 + z·(COS[0] + z·(COS[1] + …)), terms r^2 … r^18. */
const COS = Array.from({ length: 9 }, (_, k) => (k % 2 ? 1 : -1) / factorial(2 * k + 2));
/** e^x - 1 = x·(EXPM1[0] + x·(EXPM1[1] + …)), terms x^1 … x^16. */
const EXPM1 = Array.from({ length: 16 }, (_, k) => 1 / factorial(k + 1));
function factorial(n: number): number { let f = 1; for (let i = 2; i <= n; i++) f *= i; return f; }

/** sin on [-π/4, π/4]. */
function sinKernel(r: number): number {
  if (r === 0) return r; // keep the sign of zero
  const z = r * r;
  let p = SIN[7]!;
  for (let k = 6; k >= 0; k--) p = SIN[k]! + z * p;
  return r + r * z * p;
}
/** cos on [-π/4, π/4]. */
function cosKernel(r: number): number {
  const z = r * r;
  let p = COS[8]!;
  for (let k = 7; k >= 0; k--) p = COS[k]! + z * p;
  return 1 + z * p;
}

/** Quadrant n (as an integer-valued double) and remainder r with x = n·π/2 + r. */
function reduce(x: number): { readonly n: number; readonly r: number } {
  if (!(Math.abs(x) <= MEDIUM)) {
    if (!Number.isFinite(x)) return { n: 0, r: NaN };
    x %= TAU; // exact remainder by the double nearest 2π
  }
  const n = Math.round(x * INV_PIO2);
  return { n, r: ((x - n * PIO2_1) - n * PIO2_2) - n * PIO2_3 };
}

export function sin(x: number): number {
  if (Math.abs(x) <= QUARTER_PI) return sinKernel(x);
  const { n, r } = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return sinKernel(r);
    case 1: return cosKernel(r);
    case 2: return -sinKernel(r);
    default: return -cosKernel(r);
  }
}

export function cos(x: number): number {
  if (Math.abs(x) <= QUARTER_PI) return cosKernel(x);
  const { n, r } = reduce(x);
  switch (((n % 4) + 4) % 4) {
    case 0: return cosKernel(r);
    case 1: return -sinKernel(r);
    case 2: return -cosKernel(r);
    default: return sinKernel(r);
  }
}

/** atan on [-0.2, 0.2]: odd Taylor series to t^25. */
function atanSmall(t: number): number {
  const z = t * t;
  let p = 1 / 25;
  for (let k = 11; k >= 1; k--) p = (k % 2 ? -1 : 1) / (2 * k + 1) + z * p;
  return t + t * z * p;
}
/** atan for 0 <= z <= 1, reduced to |t| <= 0.2 about 0, π/8 or π/4. */
function atanUnit(z: number): number {
  if (z > TAN_3PI_16) return QUARTER_PI + atanSmall((z - 1) / (z + 1));
  if (z > TAN_PI_16) return EIGHTH_PI + atanSmall((z - TAN_PI_8) / (1 + z * TAN_PI_8));
  return atanSmall(z);
}
/** atan for z >= 0 (including Infinity). */
function atanPositive(z: number): number { return z > 1 ? HALF_PI - atanUnit(1 / z) : atanUnit(z); }

/** Two-argument arctangent with Math.atan2's quadrants and signed zeros. */
export function atan2(y: number, x: number): number {
  if (Number.isNaN(x) || Number.isNaN(y)) return NaN;
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity && ay === Infinity) {
    const a = x > 0 ? QUARTER_PI : 3 * QUARTER_PI;
    return y > 0 ? a : -a;
  }
  if (ax === 0) {
    if (ay === 0) {
      const a = Object.is(x, -0) ? Math.PI : 0;
      return Object.is(y, -0) || y < 0 ? -a : a;
    }
    return y > 0 ? HALF_PI : -HALF_PI;
  }
  const a = atanPositive(ay / ax);
  if (x > 0) return y > 0 || Object.is(y, 0) ? a : -a;
  return y > 0 || Object.is(y, 0) ? Math.PI - a : a - Math.PI;
}

/** Hypotenuse from one square root (correctly rounded everywhere), scaled away from
 * overflow and underflow. */
export function hypot(x: number, y: number): number {
  const ax = Math.abs(x), ay = Math.abs(y);
  if (ax === Infinity || ay === Infinity) return Infinity;
  const big = ax > ay ? ax : ay;
  if (big > 1e150 || (big < 1e-150 && big > 0)) {
    const sx = ax / big, sy = ay / big;
    return big * Math.sqrt(sx * sx + sy * sy);
  }
  return Math.sqrt(x * x + y * y);
}

/** 2^k for an integer k, exactly. */
function powerOfTwo(k: number): number {
  let result = 1;
  const factor = k < 0 ? 0.5 : 2;
  for (let i = Math.abs(k); i > 0; i--) result *= factor;
  return result;
}

/** e^x - 1, accurate near zero. */
export function expm1(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (Math.abs(x) <= 0.5) {
    let p = EXPM1[15]!;
    for (let k = 14; k >= 0; k--) p = EXPM1[k]! + x * p;
    return x * p;
  }
  return exp(x) - 1;
}

export function exp(x: number): number {
  if (Number.isNaN(x)) return NaN;
  if (x > 709.8) return Infinity;
  if (x < -745.2) return 0;
  const k = Math.round(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;
  let p = EXPM1[15]!;
  for (let i = 14; i >= 0; i--) p = EXPM1[i]! + r * p;
  const er = 1 + r * p;
  // Split the scaling so subnormal and near-overflow results stay exact.
  return k > 1000 ? er * powerOfTwo(1000) * powerOfTwo(k - 1000)
    : k < -1000 ? er * powerOfTwo(-1000) * powerOfTwo(k + 1000) : er * powerOfTwo(k);
}

/** x^(2/5) for x >= 0 (the Laplace sphere-of-influence exponent). With x = b·2^(5q),
 * b in [1, 32): x^(2/5) = b^(2/5)·4^q, and b^(2/5) is Newton's root of y^5 = b^2. */
export function twoFifths(x: number): number {
  if (x === 0) return 0;
  if (!(x > 0) || !Number.isFinite(x)) return NaN;
  let e = 0, b = x;
  while (b >= 2) { b /= 2; e++; }
  while (b < 1) { b *= 2; e--; }
  const q = Math.floor(e / 5);
  b *= powerOfTwo(e - 5 * q);
  const target = b * b;
  // b^(2/5) lies in [1, 4); start just above the root so Newton descends monotonically.
  let y = 1 + 0.4 * (b - 1);
  for (let i = 0; i < 60; i++) {
    const y2 = y * y, y4 = y2 * y2;
    const next = y - (y4 * y - target) / (5 * y4);
    if (!(next < y)) break;
    y = next;
  }
  return y * powerOfTwo(2 * q);
}

/** Wrap an angle into (-π, π] using exact remainders: no trigonometry, so a normalized
 * angle is returned unchanged. */
export function normalizeAngle(a: number): number {
  if (a > -Math.PI && a <= Math.PI) return a;
  let r = a % TAU;
  if (r > Math.PI) r -= TAU;
  else if (r <= -Math.PI) r += TAU;
  return r;
}
