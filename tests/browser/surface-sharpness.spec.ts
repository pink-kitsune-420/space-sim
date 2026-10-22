import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
test.beforeAll(async () => {
  for (const slot of ['reference', 'candidate']) await build({ configFile: false, logLevel: 'error',
    define: { __SURFACE_FIXTURE_SLOT__: JSON.stringify(slot) },
    resolve: { alias: { '@space-sim/game-api': resolve('packages/game-api/src/index.ts') } },
    plugins: slot === 'reference' ? [{ name: 'legacy-summary-pixel-reference', enforce: 'pre', async load(id) {
      if (id !== resolve('modules/render-webgl/src/webgl.ts')) return;
      const source = await readFile(id, 'utf8'), flag = 'private surfaceAtlasFailed = false;';
      if (source.split(flag).length !== 2) throw Error('Expected one private atlas flag');
      return source.replace(flag, 'private surfaceAtlasFailed = true;');
    } }] : [],
    build: { outDir: 'dist', emptyOutDir: false, lib: { entry: resolve('tests/browser/fixtures/surface-sharpness.ts'), formats: ['iife'],
      name: 'SurfaceSharpness' + slot, fileName: () => 'surface-sharpness-' + slot + '.js' } },
  });
});
test('actual GPU retains uniform material interiors across the visible body-fixed ribbon', async ({ page }, info) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 1280, height: 900 });
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/surface-fixture.html', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto('/surface-fixture.html');
  for (const slot of ['reference', 'candidate']) await page.addScriptTag({ url: '/surface-sharpness-' + slot + '.js' });
  const rows = []; let priorWrong = 0;
  for (const id of ['planet', 'moon']) for (const [spin, rotation, base, scale] of [[0, 0, 0, 1], [.7, -.3, 0, 1], [2, .7, 1e12, 2], [-.4, -.8, -1e12, 1]]) {
    const result = await page.evaluate(async t => {
      const w = window as unknown as Record<string, { run(t: unknown): Promise<{ wrong: number; checked: number; worst: number; glError: number; summaryUploads: number }> }>;
      return { reference: await w.surfaceSharpness_reference!.run(t), candidate: await w.surfaceSharpness_candidate!.run(t) };
    }, { id, spin, rotation, base, scale });
    expect(result.candidate.checked).toBeGreaterThan(35);
    expect(result.candidate.wrong, JSON.stringify({ id, spin, rotation, base, scale, ...result })).toBe(0);
    expect(result.candidate.glError).toBe(0); expect(result.reference.glError).toBe(0);
    expect(result.candidate.summaryUploads).toBe(2); expect(result.reference.summaryUploads).toBe(0);
    priorWrong += result.reference.wrong; rows.push({ id, spin, rotation, base, scale, ...result });
  }
  expect(priorWrong).toBeGreaterThan(0); expect(errors).toEqual([]);
  const path = info.outputPath('material-sharpness.json'); await writeFile(path, JSON.stringify({ browser: info.project.name, rows }, null, 2));
  await info.attach('material-sharpness', { path, contentType: 'application/json' });
});

test('a view above the horizon allocates no material textures for invisible ground', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route('**/surface-fixture.html', r => r.fulfill({ contentType: 'text/html', body: '<body style="margin:0"></body>' }));
  await page.goto('/surface-fixture.html');
  await page.addScriptTag({ url: '/surface-sharpness-candidate.js' });
  for (const id of ['planet', 'moon']) {
    const result = await page.evaluate(async id => {
      const fixture = (window as unknown as { surfaceSharpness_candidate: { run(t: unknown): Promise<{ checked: number; glError: number; summaryUploads: number }> } }).surfaceSharpness_candidate;
      return fixture.run({ id, spin: 0, rotation: 0, base: 0, scale: 1, hidden: true });
    }, id);
    expect(result.checked).toBe(0); expect(result.glError).toBe(0); expect(result.summaryUploads).toBe(0);
  }
});
