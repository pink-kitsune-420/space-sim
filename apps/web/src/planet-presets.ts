import type { AppearanceStyle, BodyAppearance } from '../../../packages/sim-core/src/index';

/** A starting point in the planet designer. */
export interface PlanetPreset {
  readonly id: string;
  readonly name: string;
  readonly appearance: BodyAppearance & { readonly colors: readonly [string, string, string, string] };
}

const look = (style: AppearanceStyle, colors: readonly [string, string, string, string],
  tuning: Omit<BodyAppearance, 'style' | 'colors'> = {}): PlanetPreset['appearance'] => ({ style, colors, ...tuning });

export const PLANET_PRESETS: readonly PlanetPreset[] = [
  { id: 'earth', name: 'Earth-like', appearance: look('oceanic', ['#1a4f86', '#3f7535', '#c7a56a', '#f2f6f8']) },
  { id: 'ocean', name: 'Ocean world', appearance: look('oceanic', ['#164a7a', '#3d6e3a', '#d6c08a', '#f4f7fa'], { water: .85, clouds: .65, ice: .35 }) },
  { id: 'jungle', name: 'Jungle world', appearance: look('oceanic', ['#1e5a6e', '#2f5e22', '#8a7a3a', '#eef2f0'], { water: .4, clouds: .75, ice: .15 }) },
  { id: 'snowball', name: 'Snowball', appearance: look('oceanic', ['#2a4f70', '#6f7f6a', '#b9b2a0', '#f4f8fb'], { water: .55, clouds: .4, ice: .95 }) },
  { id: 'desert', name: 'Desert', appearance: look('arid', ['#d2a868', '#8a5e3a', '#efe6d2', '#f5f1ea'], { water: .35, ice: .2 }) },
  { id: 'mars', name: 'Rust world', appearance: look('arid', ['#b65a33', '#6e3420', '#d79a72', '#f2ede6'], { water: .45, ice: .5 }) },
  { id: 'salt', name: 'Dried seas', appearance: look('arid', ['#a88a62', '#5e4a36', '#e9e2d4', '#f2eee8'], { water: .8, ice: .3 }) },
  { id: 'moon', name: 'Barren moon', appearance: look('rocky', ['#8f8d89', '#4f4d4b', '#c0bdb6', '#8f8d89'], { craters: .7 }) },
  { id: 'scorched', name: 'Scorched rock', appearance: look('rocky', ['#8a837c', '#5e5852', '#b3aca4', '#8a837c'], { water: .3, craters: .9 }) },
  { id: 'dark', name: 'Dark moon', appearance: look('rocky', ['#4a4448', '#2a2629', '#7a7076', '#4a4448'], { craters: .6 }) },
  { id: 'lava', name: 'Lava world', appearance: look('volcanic', ['#3d2b24', '#1e1613', '#ff6a1f', '#c9a83a'], { glow: .75 }) },
  { id: 'sulfur', name: 'Sulfur moon', appearance: look('volcanic', ['#c9b048', '#6e5a2a', '#ff5a1a', '#efe28a'], { glow: .45 }) },
  { id: 'ice', name: 'Ice moon', appearance: look('icy', ['#d6e3ee', '#7f98ad', '#ffffff', '#d6e3ee'], { ice: .7, craters: .3 }) },
  { id: 'gas', name: 'Gas giant', appearance: look('banded', ['#d8b98e', '#a5714a', '#f4e8d2', '#c25a3c'], { turbulence: .55 }) },
  { id: 'pale', name: 'Pale giant', appearance: look('banded', ['#e2cd98', '#bf9f68', '#f6ecca', '#d6bd86'], { turbulence: .35 }) },
  { id: 'ice-giant', name: 'Ice giant', appearance: look('banded', ['#3f6fd0', '#2b4fa6', '#86aef2', '#eef4ff'], { turbulence: .45 }) },
  { id: 'hazy', name: 'Cloud world', appearance: look('hazy', ['#d9b878', '#b8925a', '#f2dfae', '#e8cc90']) },
  { id: 'smog', name: 'Orange haze', appearance: look('hazy', ['#d09a4a', '#a8742e', '#e8bf7a', '#c08a3e'], { turbulence: .35 }) },
];

export const STAR_PRESETS: readonly PlanetPreset[] = [
  { id: 'yellow', name: 'Yellow star', appearance: look('star', ['#fff8e6', '#ffd27a', '#ff8a2a', '#c8661c']) },
  { id: 'red', name: 'Red dwarf', appearance: look('star', ['#ffe2c8', '#ff8a4a', '#c8401a', '#7a2410']) },
  { id: 'blue', name: 'Blue giant', appearance: look('star', ['#ffffff', '#bcd4ff', '#7aa0ff', '#4a6ad0']) },
];

/** What each palette colour paints, by style. */
export const COLOR_ROLES: Readonly<Record<AppearanceStyle, readonly [string, string, string, string]>> = {
  rocky: ['Ground', 'Lava seas', 'Highlands', 'Polar frost'],
  arid: ['Sand', 'Rock', 'Salt flats', 'Polar ice'],
  oceanic: ['Ocean', 'Vegetation', 'Desert', 'Ice and cloud'],
  banded: ['Band', 'Dark band', 'Light band', 'Storms'],
  icy: ['Ice', 'Cracks', 'Frost', 'Tint'],
  hazy: ['Cloud', 'Dark cloud', 'Light cloud', 'Tint'],
  volcanic: ['Rock', 'Dark crust', 'Lava', 'Sulfur'],
  star: ['Core', 'Surface', 'Limb', 'Spots'],
};

/** The sliders each style uses, with their label for it. */
export const TUNING_LABELS: Readonly<Record<AppearanceStyle, Partial<Record<'water' | 'clouds' | 'ice' | 'craters' | 'turbulence' | 'glow', string>>>> = {
  rocky: { water: 'Lava seas', ice: 'Polar frost', craters: 'Craters' },
  arid: { water: 'Dry seas', ice: 'Polar ice', craters: 'Craters' },
  oceanic: { water: 'Sea level', clouds: 'Clouds', ice: 'Ice and cold', turbulence: 'Storminess' },
  banded: { turbulence: 'Turbulence' },
  icy: { ice: 'Frost', craters: 'Craters' },
  hazy: { turbulence: 'Swirl' },
  volcanic: { craters: 'Calderas', glow: 'Lava' },
  star: {},
};
