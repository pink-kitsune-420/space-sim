import { disableNetwork } from '../helpers/offline';
import { useLowGraphics } from '../helpers/canvas';
import { packageContracts } from '../../packages/module-tools/package.mjs';
import { openPanel } from '../helpers/workspace';
import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

test.describe.configure({ timeout: 90000 }); // Shader compilation and renderer rebuilds on software GPUs.

const scene = '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(0.2,0.4,0.6,1.0);}';
const pack = (passes: unknown, name = 'Custom sky') => JSON.stringify({ format: 'space-sim-shaders/1', name, passes });
test.beforeEach(async ({ page }) => {
  await useLowGraphics(page);
  await page.setViewportSize({ width: 800, height: 600 });
});

async function load(page: Page, content: string, name = 'custom.json'): Promise<void> {
  await page.locator('#shader-file').setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(content) });
}
async function pixel(page: Page): Promise<number[]> {
  return page.locator('#flight-view').evaluate(canvas => new Promise<number[]>(resolvePixel => {
    requestAnimationFrame(() => {
      const gl = (canvas as HTMLCanvasElement).getContext('webgl2')!;
      const data = new Uint8Array(4);
      gl.readPixels(2, 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
      resolvePixel(Array.from(data));
    });
  }));
}

test('imports, exports, restores and retains custom shaders across renderer switches offline', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await disableNetwork(context);
  await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
  // Some browser test environments only provide Canvas 2D; check its graceful fallback separately.
  test.skip(await page.locator('#renderer-toggle').textContent() !== 'Renderer: WebGL', 'WebGL 2 unavailable in this browser environment');
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const original = await pixel(page);
  await openPanel(page, 'tools');
  await page.locator('.shader-settings summary').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-shader').click();
  const defaults = await (await packageContracts()).decodeDataFile(new Uint8Array(await readFile(await (await downloadEvent).path())), 'shaders') as any;
  expect(Object.keys(defaults.passes).sort()).toEqual(['scene', 'text', 'vector']);
  await load(page, pack({ scene: { fragment: scene } }));
  await expect(page.locator('#shader-name')).toHaveText('Custom sky');
  expect(await pixel(page)).toEqual([51, 102, 153, 255]);
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  await expect(page.locator('#shader-status')).toContainText('Canvas 2D');
  await page.locator('#renderer-toggle').click();
  expect(await pixel(page)).toEqual([51, 102, 153, 255]);
  await openPanel(page, 'tools');
  const customDownload = page.waitForEvent('download');
  await page.locator('#export-shader').click();
  const exported = await readFile(await (await customDownload).path());
  const decoded = await (await packageContracts()).decodeDataFile(new Uint8Array(exported), 'shaders') as any;
  expect(decoded.passes.scene.fragment).toBe(scene);
  await page.locator('#reset-shader').click();
  await expect(page.locator('#shader-name')).toHaveText('Default');
  expect(await pixel(page)).toEqual(original);
  await page.locator('#shader-file').setInputFiles({ name: 'shaders.spacedata', mimeType: 'application/zip', buffer: exported });
  expect(await pixel(page)).toEqual([51, 102, 153, 255]);
  await load(page, JSON.stringify(defaults));
  expect(await pixel(page)).toEqual(original);
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  await load(page, scene, 'blue.frag');
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: WebGL');
  expect(await pixel(page)).toEqual([51, 102, 153, 255]);
  expect(errors).toEqual([]);
});

test('shader replacement is atomic, rejects incompatible interfaces and releases GPU programs', async ({ page }) => {
  await page.addInitScript(() => {
    const livePrograms = new Set<WebGLProgram>(), liveShaders = new Set<WebGLShader>();
    const stats = { compiles: 0, lookups: 0, allocations: 0, livePrograms: 0, liveShaders: 0 };
    (window as unknown as { shaderStats: typeof stats }).shaderStats = stats;
    const proto = WebGL2RenderingContext.prototype;
    const createProgram = proto.createProgram, deleteProgram = proto.deleteProgram;
    const createShader = proto.createShader, deleteShader = proto.deleteShader;
    const compile = proto.compileShader, lookup = proto.getUniformLocation, allocate = proto.bufferData;
    proto.createProgram = function () { const p = createProgram.call(this); if (p) livePrograms.add(p); stats.livePrograms = livePrograms.size; return p; };
    proto.deleteProgram = function (p) { if (p) livePrograms.delete(p); stats.livePrograms = livePrograms.size; return deleteProgram.call(this, p); };
    proto.createShader = function (type) { const s = createShader.call(this, type); if (s) liveShaders.add(s); stats.liveShaders = liveShaders.size; return s; };
    proto.deleteShader = function (s) { if (s) liveShaders.delete(s); stats.liveShaders = liveShaders.size; return deleteShader.call(this, s); };
    proto.compileShader = function (s) { stats.compiles++; return compile.call(this, s); };
    proto.getUniformLocation = function (p, name) { stats.lookups++; return lookup.call(this, p, name); };
    // Preserve the overloads while counting GPU buffer allocations.
    proto.bufferData = function (this: WebGL2RenderingContext, ...args: Parameters<typeof allocate>) { stats.allocations++; return allocate.apply(this, args); } as typeof allocate;
  });
  await page.goto('/');
  test.skip(await page.locator('#renderer-toggle').textContent() !== 'Renderer: WebGL', 'WebGL 2 unavailable in this browser environment');
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await openPanel(page, 'tools');
  await page.locator('.shader-settings summary').click();
  await load(page, pack({ scene: { fragment: scene } }));
  await expect(page.locator('#shader-name')).toHaveText('Custom sky');
  const stats = () => page.evaluate(() => (window as unknown as { shaderStats: Record<string, number> }).shaderStats);
  const before = await stats();
  expect(before.livePrograms).toBe(5); // Three pack programs plus the private terrain and overlay text programs.
  expect(before.liveShaders).toBe(0);
  await page.waitForTimeout(250);
  expect(await stats()).toEqual(before); // No compilation, uniform lookups or GPU buffer allocation per frame.
  const badShaders = [
    pack({ scene: { fragment: scene }, vector: { fragment: 'broken GLSL' } }),
    pack({ scene: { fragment: scene.replace('void main()', 'uniform vec3 u_resolution;\nvoid main()').replace('vec4(0.2,0.4,0.6,1.0)', 'vec4(u_resolution,1.0)') } }),
    pack({ scene: { vertex: '#version 300 es\nlayout(location=3) in vec2 a_position;\nvoid main(){gl_Position=vec4(a_position,0,1);}', fragment: scene } }),
    pack({ scene: { fragment: scene }, text: { fragment: scene.replace('void main()', 'uniform sampler2D unknownTexture;\nvoid main()').replace('vec4(0.2,0.4,0.6,1.0)', 'texture(unknownTexture,vec2(0.5))') } }),
    '{broken JSON',
  ];
  for (const bad of badShaders) {
    await load(page, bad);
    await expect(page.locator('#shader-status')).toContainText('Shader was not loaded:');
    expect(await pixel(page)).toEqual([51, 102, 153, 255]);
    expect((await stats()).livePrograms).toBe(5);
    expect((await stats()).liveShaders).toBe(0);
  }
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  expect((await stats()).livePrograms).toBe(0);
  await openPanel(page, 'tools');
  await page.locator('#reset-shader').click(); // Reset also works while using Canvas.
  await expect(page.locator('#shader-name')).toHaveText('Default');
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await stats()).livePrograms).toBe(5);
  expect((await stats()).liveShaders).toBe(0);
});

test('unavailable WebGL falls back to Canvas and reports shader loading errors without interrupting flight', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, options?: unknown) {
      if (type === 'webgl2') return null;
      return original.call(this, type as '2d', options);
    } as typeof original;
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: 2D');
  await openPanel(page, 'tools');
  await page.locator('.shader-settings summary').click();
  await load(page, scene, 'blue.frag');
  await expect(page.locator('#shader-status')).toContainText('WebGL 2 is unavailable');
  await expect(page.locator('#shader-name')).toHaveText('Default');
  await expect(page.locator('#status')).toHaveText('LANDED');
  expect(errors).toEqual([]);
});

test('full packs replace all stages and receive drawing roles, glyph textures and real time', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).shaderClock = 10000;
    Object.defineProperty(performance, 'now', { value: () => (window as any).shaderClock });
  });
  await page.goto('/');
  test.skip(await page.locator('#renderer-toggle').textContent() !== 'Renderer: WebGL', 'WebGL 2 unavailable in this browser environment');
  await openPanel(page, 'tools');
  await page.locator('.shader-settings summary').click();
  const downloadEvent = page.waitForEvent('download');
  await page.locator('#export-shader').click();
  const full = await (await packageContracts()).decodeDataFile(new Uint8Array(await readFile(await (await downloadEvent).path())), 'shaders') as any;
  full.name = 'All stages';
  full.passes.scene.fragment = scene;
  full.passes.vector.fragment = `#version 300 es
    precision highp float;
    uniform int u_style;
    uniform float u_time;
    out vec4 fragColor;
    void main() { fragColor = u_style == 5 ? vec4(0.9, fract(u_time), 0.2, 1.0) : vec4(1.0, 0.0, 0.0, 1.0); }`;
  full.passes.text.fragment = `#version 300 es
    precision highp float;
    in vec2 v_uv;
    uniform sampler2D u_tex;
    uniform int u_style;
    uniform float u_time;
    out vec4 fragColor;
    void main() { fragColor = vec4(0.0, 1.0, 1.0, texture(u_tex, v_uv).a * (u_style == 11 ? 1.0 : 0.5 + 0.5 * sin(u_time))); }`;
  await load(page, JSON.stringify(full));
  await expect(page.locator('#shader-name')).toHaveText('All stages');
  const vesselPixels = () => page.locator('#flight-view').evaluate(canvas => new Promise<{ ship: number[]; cyanGlyphs: number; error: number }>(done => {
    requestAnimationFrame(() => {
      const el = canvas as HTMLCanvasElement, gl = el.getContext('webgl2')!;
      const dpr = el.width / el.clientWidth;
      const ship = new Uint8Array(4);
      gl.readPixels(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, ship);
      const w = Math.floor(90 * dpr), h = Math.floor(20 * dpr), text = new Uint8Array(w * h * 4);
      gl.readPixels(Math.floor(el.width / 2 + 16 * dpr), Math.floor(el.height / 2 + 12 * dpr), w, h, gl.RGBA, gl.UNSIGNED_BYTE, text);
      let cyanGlyphs = 0;
      for (let i = 0; i < text.length; i += 4) if (text[i]! < 60 && text[i + 1]! > 200 && text[i + 2]! > 200) cyanGlyphs++;
      done({ ship: Array.from(ship), cyanGlyphs, error: gl.getError() });
    });
  }));
  const before = await vesselPixels();
  expect(before.ship[0]).toBeCloseTo(230, -1);
  expect(before.ship[2]).toBe(51);
  expect(before.cyanGlyphs).toBeGreaterThan(10);
  expect(before.error).toBe(0);
  await page.evaluate(() => { (window as any).shaderClock += 250; });
  await expect.poll(async () => (await vesselPixels()).ship[1]).not.toBe(before.ship[1]);
  await openPanel(page, 'setup');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const stopped = await vesselPixels();
  expect(stopped.ship[0]).toBeCloseTo(230, -1);
  expect(stopped.ship.slice(1)).toEqual([64, 51, 255]);
  await page.evaluate(() => { (window as any).shaderClock += 250; });
  // Shader time continues while physics is paused.
  await expect.poll(async () => {
    const p = (await vesselPixels()).ship;
    return [Math.abs(p[0]! - 230) <= 1 ? 230 : p[0], p[1], p[2], p[3]];
  }).toEqual([230, 128, 51, 255]);
  await load(page, await readFile(resolve('examples/shaders/violet.json'), 'utf8'));
  await expect(page.locator('#shader-name')).toHaveText('Violet');
  expect((await vesselPixels()).error).toBe(0);
});
