/** First-party renderer lighting adapter. */
export { NIGHT_LEVEL, TWILIGHT_COLOR, daylight, skyLight, twilight } from '@space-sim/game-api';

/** A world-space direction on screen (CSS pixels, y down) under a camera rotation. */
export function screenDirection(direction: { readonly x: number; readonly y: number }, rotation: number): { x: number; y: number } {
  const c = Math.cos(rotation), s = Math.sin(rotation);
  return { x: direction.x * c - direction.y * s, y: -(direction.x * s + direction.y * c) };
}
