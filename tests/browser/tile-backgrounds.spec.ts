import { expect, test } from '@playwright/test';
import { rolldown } from 'rolldown';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';

let source: string;
test.beforeAll(async () => {
  const bundle = await rolldown({ input: resolve('tests/fixtures/tile-renderer-host.ts'), plugins: [{
    name: 'public-api-and-shaders',
    resolveId(id, importer) {
      if (id === '@space-sim/game-api') return resolve('packages/game-api/src/index.ts');
      if (id.endsWith('?raw') && importer) return resolve(dirname(importer), id);
    },
    load(id) { if (id.endsWith('?raw')) return 'export default ' + JSON.stringify(readFileSync(id.slice(0, -4), 'utf8')); },
  }] });
  try { source = (await bundle.generate({ format: 'iife', name: 'TileRendererHost' })).output[0]!.code; }
  finally { await bundle.close(); }
});

for (const renderer of ['canvas', 'webgl'] as const) {
  test(`${renderer} draws walls only behind air and releases its resources`, async ({ page }) => {
    await page.goto('about:blank');
    await page.setContent('<canvas style="width:128px;height:128px"></canvas>');
    await page.addScriptTag({ content: source });
    const result = await page.evaluate(kind => {
      const api = (window as unknown as { TileRendererHost: any }).TileRendererHost;
      const canvas = document.querySelector('canvas')!;
      if (kind === 'webgl' && !canvas.getContext('webgl2')) return { unavailable: true };
      const buffers: WebGLBuffer[] = [];
      const original = kind === 'webgl' ? WebGL2RenderingContext.prototype.createBuffer : undefined;
      if (original) WebGL2RenderingContext.prototype.createBuffer = function () {
        const buffer = original.call(this); if (buffer) buffers.push(buffer); return buffer;
      };
      let draw: any;
      try {
        draw = kind === 'canvas' ? new api.CanvasRenderer(canvas) : new api.WebGLRenderer(canvas);
        draw.features.tilePalettes.register('fixture', ['#00000000', '#c86432', '#64c832']);
        const frame = { state: api.initialState(), path: [], pathClosed: false, engine: false,
          camera: { center: { x: 16, y: 16 }, rotation: 0, scale: 4 }, bodies: [],
          shipWorldPosition: { x: 1e20, y: 1e20 }, padPosition: { x: 1e20, y: 1e20 },
          showShip: false, showPad: false, showScale: false };
        const read = (x: number, y: number): number[] => {
          const ratio = canvas.width / 128;
          if (kind === 'canvas') return Array.from(canvas.getContext('2d')!.getImageData(x * ratio, y * ratio, 1, 1).data);
          const gl = canvas.getContext('webgl2')!; const bytes = new Uint8Array(4);
          gl.readPixels(x * ratio, canvas.height - 1 - y * ratio, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
          return Array.from(bytes);
        };
        draw.draw(frame);
        const background = read(6, 125);
        const tiles = new Uint16Array(1024); tiles[0] = 1;
        const walls = new Uint16Array(1024); walls[0] = 2; walls[1] = 2;
        const chunk = { kind: 'tile-chunk', space: 'world', origin: { x: 0, y: 0 },
          tileMetres: 1, size: 32, tiles, walls, paletteId: 'fixture' };
        draw.draw({ ...frame, overlays: [chunk] });
        const foreground = read(2, 125), wall = read(6, 125);
        draw.draw({ ...frame, overlays: [{ ...chunk, walls: undefined }] });
        const omitted = read(6, 125);
        draw.dispose(); draw = undefined;
        const leaked = kind === 'webgl' ? buffers.filter(buffer => canvas.getContext('webgl2')!.isBuffer(buffer)).length : 0;
        return { unavailable: false, foreground, wall, background, omitted, leaked };
      } finally {
        draw?.dispose();
        if (original) WebGL2RenderingContext.prototype.createBuffer = original;
      }
    }, renderer);
    test.skip(result.unavailable, 'WebGL 2 is unavailable in this browser environment');
    expect(result.foreground).toEqual([200, 100, 50, 255]);
    for (const [i, expected] of [55, 110, 28].entries()) expect(Math.abs(result.wall![i]! - expected)).toBeLessThanOrEqual(1);
    expect(result.omitted).toEqual(result.background);
    expect(result.leaked).toBe(0);
  });
}
