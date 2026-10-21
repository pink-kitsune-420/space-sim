import { DEFAULT_TILE_PALETTE_HEX, type ThemeBackdropStyle, type ThemeGridStyle } from '@space-sim/game-api';
export { DEFAULT_TILE_PALETTE_HEX };
export function hexToRgb(hex?: string): { r: number; g: number; b: number } {
  if (!hex) return { r: 56, g: 189, b: 248 };
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  const num = parseInt(h.slice(0, 6), 16);
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


/** Allocates and populates a 1024x1 RGBA8 texture for O(1) tile palette lookups in WebGL 2 shaders. */
export function createTilePaletteTexture(gl: WebGL2RenderingContext, hexColors: readonly string[] = DEFAULT_TILE_PALETTE_HEX): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  const data = new Uint8Array(1024 * 4);
  for (let i = 0; i < 1024; i++) {
    if (i === 0) {
      data[0] = 0; data[1] = 0; data[2] = 0; data[3] = 0;
      continue;
    }
    const color = hexColors[i];
    if (color) {
      const rgb = hexToRgb(color);
      data[i * 4] = rgb.r;
      data[i * 4 + 1] = rgb.g;
      data[i * 4 + 2] = rgb.b;
      data[i * 4 + 3] = color.length === 9 ? parseInt(color.slice(7, 9), 16) : 255;
    } else {
      data[i * 4] = (i * 67) & 0xff;
      data[i * 4 + 1] = (i * 131) & 0xff;
      data[i * 4 + 2] = (i * 197) & 0xff;
      data[i * 4 + 3] = 255;
    }
  }
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

