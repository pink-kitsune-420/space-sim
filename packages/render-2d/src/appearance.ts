import type { AppearanceStyle, RenderBody } from '../../game-api/src/index';

/** Shader style numbers (see scene.frag). 0 is the plain disc. */
export const STYLE_INDEX: Readonly<Record<AppearanceStyle, number>> = Object.freeze({
  rocky: 1, arid: 2, oceanic: 3, banded: 4, icy: 5, hazy: 6, volcanic: 7, star: 8,
});

/** How much each palette colour covers a typical world of each style, for its far-away dot. */
const COVERAGE: Readonly<Record<AppearanceStyle, readonly number[]>> = Object.freeze({
  rocky: [.5, .3, .2, 0], arid: [.65, .15, .15, .05], oceanic: [.6, .2, .1, .1], banded: [.4, .35, .2, .05],
  icy: [.6, .1, .25, .05], hazy: [.4, .3, .3, 0], volcanic: [.45, .35, .05, .15], star: [.3, .5, .2, 0],
});

export type RGB = readonly [number, number, number];

export function parseRGB(hex: string): RGB {
  const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export interface AppearanceUniforms {
  readonly style: number;
  /** water, clouds, ice, craters, turbulence, glow: 0..1, 0.5 by default. */
  readonly tune: readonly [number, number, number, number, number, number];
  readonly colors: readonly [RGB, RGB, RGB, RGB];
  readonly mean: RGB;
  readonly seed: number;
}

const CACHE = new WeakMap<object, AppearanceUniforms>();

/** Parsed palette for a body, cached per appearance object. Undefined draws a plain disc. */
export function appearanceUniforms(body: RenderBody): AppearanceUniforms | undefined {
  const a = body.appearance;
  if (!a) return undefined;
  const cached = CACHE.get(a);
  if (cached) return cached;
  const colors = [0, 1, 2, 3].map(i => parseRGB(a.colors[i] ?? a.colors[0] ?? body.color ?? '#233c47')) as unknown as AppearanceUniforms['colors'];
  const weights = COVERAGE[a.style];
  const mean = [0, 1, 2].map(k => colors.reduce((sum, c, i) => sum + c[k]! * weights[i]!, 0)) as unknown as RGB;
  // A stable per-body pattern offset from its id.
  let h = 2166136261;
  for (const ch of body.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const tune = [a.water, a.clouds, a.ice, a.craters, a.turbulence, a.glow].map(v => v ?? .5) as unknown as AppearanceUniforms['tune'];
  const result = { style: STYLE_INDEX[a.style], colors, mean, tune, seed: a.seed ?? (h >>> 0) % 997 / 10 };
  CACHE.set(a, result);
  return result;
}
