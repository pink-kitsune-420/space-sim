/** Day/night shading shared by both renderers and the terrain. Presentation only.
 * `cosSun` is the cosine between a surface's outward direction and the direction to the sun. */

/** Brightness of the night side, so it stays readable. */
export const NIGHT_LEVEL = 0.35;
/** Half-width of the terminator, in cosine. */
const TERMINATOR = 0.18;

const smoothstep = (lo: number, hi: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
};

/** Ground brightness: 1 in daylight, NIGHT_LEVEL at night, smooth across the terminator. */
export function daylight(cosSun: number): number {
  return NIGHT_LEVEL + (1 - NIGHT_LEVEL) * smoothstep(-TERMINATOR, TERMINATOR, cosSun);
}

/** Atmosphere glow strength: faint on the night side. */
export function skyLight(cosSun: number): number {
  return 0.2 + 0.8 * smoothstep(-0.25, 0.1, cosSun);
}

/** Sunrise and sunset warmth near the terminator, 0 to 1. */
export function twilight(cosSun: number): number {
  return 1 - smoothstep(0, 0.3, Math.abs(cosSun));
}

/** Warm twilight tint, RGB 0..1. */
export const TWILIGHT_COLOR: readonly [number, number, number] = [1, 0.6, 0.35];

/** A world-space direction on screen (CSS pixels, y down) under a camera rotation. */
export function screenDirection(direction: { readonly x: number; readonly y: number }, rotation: number): { x: number; y: number } {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { x: direction.x * c - direction.y * s, y: -(direction.x * s + direction.y * c) };
}
