import type { ThemeBackdropStyle, ThemeGridStyle } from '@space-sim/game-api';
export function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 56, g: 189, b: 248 };
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h, 16);
  if (Number.isNaN(num)) return { r: 56, g: 189, b: 248 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Converts hex color strings to normalized 0.0..1.0 float RGB values for WebGL shaders. */
export function hexToRgb01(hex?: string): { r: number; g: number; b: number } {
  const { r, g, b } = hexToRgb(hex);
  return { r: r / 255, g: g / 255, b: b / 255 };
}

/** Applies the palette at the document root and synchronizes mounted UI surfaces. */
export function themeBackdropToShaderIndex(style: ThemeBackdropStyle): number {
  switch (style) {
    case 'spacelab': return 0;
    case 'nebula': return 1;
    case 'carina': return 2;
    case 'galactic': return 3;
    case 'aurora': return 4;
    case 'supernova': return 5;
    case 'void': return 6;
    case 'pillars': return 7;
    case 'helix': return 8;
    case 'asteroids': return 9;
    default: return 0;
  }
}

/** Converts a grid style string to an integer enum for WebGL GLSL shaders. */
export function themeGridToShaderIndex(style: ThemeGridStyle): number {
  switch (style) {
    case 'cartesian': return 0;
    case 'polar': return 1;
    case 'dots': return 2;
    case 'hex': return 3;
    case 'off': return -1;
    default: return 0;
  }
}
