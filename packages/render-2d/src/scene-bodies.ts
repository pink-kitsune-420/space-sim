import type { Camera, RenderBody, Vec } from '../../game-api/src/index';
import { appearanceUniforms } from './appearance';
import { screenDirection } from './lighting';

const HEX_RGB_CACHE = new Map<string, readonly [number, number, number]>();
export function parseHex(hex: string): readonly [number, number, number] {
  const cached = HEX_RGB_CACHE.get(hex);
  if (cached) return cached;
  let clean = hex.startsWith('#') ? hex.slice(1) : hex;
  if (clean.length === 3) clean = clean.split('').map(c => c + c).join('');
  const result: readonly [number, number, number] = clean.length >= 6
    ? [
        ((parseInt(clean.slice(0, 6), 16) >> 16) & 255) / 255,
        ((parseInt(clean.slice(0, 6), 16) >> 8) & 255) / 255,
        (parseInt(clean.slice(0, 6), 16) & 255) / 255,
      ]
    : [0.5, 0.5, 0.5];
  HEX_RGB_CACHE.set(hex, result);
  return result;
}

const HEX_RGBA_CACHE = new Map<string, readonly [number, number, number, number]>();
export function parseHexAlpha(hex: string): readonly [number, number, number, number] {
  const cached = HEX_RGBA_CACHE.get(hex);
  if (cached) return cached;
  const clean = hex.startsWith('#') ? hex.slice(1) : hex;
  let result: readonly [number, number, number, number];
  if (clean.length === 8) {
    const rgb = parseHex(clean.slice(0, 6));
    const a = parseInt(clean.slice(6, 8), 16) / 255;
    result = [rgb[0], rgb[1], rgb[2], a];
  } else {
    const rgb = parseHex(clean);
    result = [rgb[0], rgb[1], rgb[2], 0.5];
  }
  HEX_RGBA_CACHE.set(hex, result);
  return result;
}

/** The scene shader's per-body uniforms. Shader packs may omit any optional member (null). */
const FIELDS = ['screenPos', 'horizonPoint', 'horizonNormal', 'radius', 'color', 'accent', 'atmosphere', 'isStar',
  'sunDir', 'style', 'c1', 'c2', 'c3', 'mean', 'spin', 'seed', 'metres', 'tune', 'tune2'] as const;
export type BodyUniformLocations = Readonly<Record<typeof FIELDS[number], WebGLUniformLocation | null>>;

export function bodyUniformLocations(gl: WebGL2RenderingContext, program: WebGLProgram, index: number): BodyUniformLocations {
  return Object.fromEntries(FIELDS.map(f => [f, gl.getUniformLocation(program, `u_bodies[${index}].${f}`)])) as BodyUniformLocations;
}

/** Upload one body: `pos` and `r` in CSS pixels, `center` the viewport centre (for the horizon of huge bodies). */
export function setBodyUniforms(gl: WebGL2RenderingContext, u: BodyUniformLocations, b: RenderBody, pos: Vec, r: number,
  center: Vec, camera: Camera, worldSeed = 0): void {
  const isStar = b.surfaceFeatures === 'star';
  const look = appearanceUniforms(b, worldSeed);
  const col = look ? look.colors[0] : parseHex(b.color ?? '#233c47');
  const accent = parseHex(b.horizonColor ?? b.accentColor ?? '#659497');
  const atmo = parseHexAlpha(b.skyColor ?? b.atmosphereColor ?? '#29495380');
  let hx = pos.x, hy = pos.y, nx = 0, ny = 0;
  const dx = center.x - pos.x, dy = center.y - pos.y;
  const distToCenter = Math.hypot(dx, dy);
  if (r > 2048 && distToCenter > 1) {
    nx = dx / distToCenter;
    ny = dy / distToCenter;
    hx = pos.x + nx * r;
    hy = pos.y + ny * r;
  }
  gl.uniform2f(u.screenPos, pos.x, pos.y);
  gl.uniform2f(u.horizonPoint, hx, hy);
  gl.uniform2f(u.horizonNormal, nx, ny);
  gl.uniform1f(u.radius, r);
  gl.uniform3f(u.color, col[0], col[1], col[2]);
  gl.uniform3f(u.accent, accent[0], accent[1], accent[2]);
  gl.uniform4f(u.atmosphere, atmo[0], atmo[1], atmo[2], atmo[3]);
  gl.uniform1i(u.isStar, isStar ? 1 : 0);
  const sun = b.sunDirection && !isStar ? screenDirection(b.sunDirection, camera.rotation) : { x: 0, y: 0 };
  gl.uniform2f(u.sunDir, sun.x, sun.y);
  gl.uniform1i(u.style, look?.style ?? 0);
  if (!look) return;
  const [, c1, c2, c3] = look.colors;
  gl.uniform3f(u.c1, c1[0], c1[1], c1[2]);
  gl.uniform3f(u.c2, c2[0], c2[1], c2[2]);
  gl.uniform3f(u.c3, c3[0], c3[1], c3[2]);
  gl.uniform3f(u.mean, look.mean[0], look.mean[1], look.mean[2]);
  gl.uniform1f(u.spin, (b.rotation ?? 0) + camera.rotation);
  gl.uniform1f(u.seed, look.seed);
  gl.uniform1f(u.metres, b.radius);
  gl.uniform4f(u.tune, look.tune[0], look.tune[1], look.tune[2], look.tune[3]);
  gl.uniform2f(u.tune2, look.tune[4], look.tune[5]);
}
