/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial evaluation only.
 * See ../../../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

/** Decorative appearance only: these IDs never describe collision or resources.
 * Slots are renderer transport values and are deliberately separate from identity. */
export const APPEARANCE_IDS = ['warm-aggregate', 'cool-aggregate', 'dark-aggregate'] as const;
export type AppearanceId = typeof APPEARANCE_IDS[number];
export type MaterialStyle = 'colored' | 'muted';
export interface MaterialDomain {
  readonly id: string;
  readonly seed: number;
  readonly colors: Readonly<Record<AppearanceId, string>>;
}

export const MATERIAL_DOMAINS: Readonly<Record<'planet' | 'moon', MaterialDomain>> = Object.freeze({
  planet: Object.freeze({ id: 'successor.primus-appearance/1', seed: 17,
    colors: Object.freeze({ 'warm-aggregate': '#71604a', 'cool-aggregate': '#525e64', 'dark-aggregate': '#40464a' }) }),
  moon: Object.freeze({ id: 'successor.parvus-appearance/1', seed: 43,
    colors: Object.freeze({ 'warm-aggregate': '#73716b', 'cool-aggregate': '#626d77', 'dark-aggregate': '#474f59' }) }),
});

/** Body-fixed Cartesian metres in the landing-pad tangent frame, with origin at
 * reference radius. The immutable pad angle defines the axes, never the camera.
 * Classify fixed 1m addresses before sampling .25/.5/1m display cells. Thus all
 * supported resolutions preserve the same region edges, including negative x/y.
 * This descriptor can be queried without allocating or generating a tile patch. */
export function appearanceAt(domain: MaterialDomain, xMetres: number, yMetres: number): AppearanceId {
  const x = Math.floor(xMetres), y = Math.floor(yMetres);
  const band = Math.floor((y + 2 * Math.sin(x / 24)) / 4);
  const region = Math.floor(x / 48);
  const hash = Math.imul(region, 374761393) ^ Math.imul(band, 668265263) ^ domain.seed;
  return APPEARANCE_IDS[((hash ^ (hash >>> 13)) >>> 0) % APPEARANCE_IDS.length]!;
}

/** Index zero is transparent. Reordering this list changes slots, never identities. */
export const MATERIAL_SLOTS = APPEARANCE_IDS;
export function materialPalette(domain: MaterialDomain, slots: readonly AppearanceId[] = MATERIAL_SLOTS): readonly string[] {
  return Object.freeze(['#00000000', ...slots.map(id => domain.colors[id])]);
}
export const MATERIAL_PALETTES = Object.freeze({
  planet: materialPalette(MATERIAL_DOMAINS.planet), moon: materialPalette(MATERIAL_DOMAINS.moon),
});
