import { disableNetwork } from '../helpers/offline';
import { useLowGraphics } from '../helpers/canvas';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { test, expect, type Page } from '@playwright/test';
import { build } from 'vite';
import { copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type * as Harness from '../helpers/overlay-harness';

declare global { interface Window { overlayHarness: typeof Harness } }
test.beforeEach(async ({ page }, info) => {
  if (info.title.includes('renderer switches') || info.title.includes('release GPU')) {
    await useLowGraphics(page);
    await page.setViewportSize({ width: 800, height: 600 });
  } else await useCanvas(page);
});

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
const instrument = (page: Page, name: string) => page.locator('#instruments').getByRole('button', { name, exact: true });
async function orbit(page: Page): Promise<void> {
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect.poll(async () => (await debug(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
}

test('the flight instruments are part of the default game and each switches off without touching the world', async ({ page }) => {
  test.setTimeout(60000); // Several profile reloads and a full page reload.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  // Keep the instrument lifecycle smoke check within its frame budget on software GPUs.
  // Renderer switching and WebGL resource cleanup have dedicated checks below.
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, { apply(target, receiver, args) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(target, receiver, args);
    } });
  });
  await page.goto('/');
  await orbit(page);
  await openPanel(page, 'data');
  for (const name of ['Velocity', 'Orbit markers', 'Telemetry', 'Navball', 'Maneuver planner']) await expect(instrument(page, name)).toHaveAttribute('aria-pressed', 'true');
  const panel = page.locator('.module-panel', { has: page.getByRole('heading', { name: 'Telemetry' }) });
  await expect(panel).toContainText('Speed');
  await expect(panel).toContainText(/Period\s*28\.1 s/);
  await expect.poll(async () => (await debug(page)).presentation.overlayPrimitives).toBeGreaterThan(0);
  const before = await debug(page);
  expect(before.presentation.modules).toEqual(['builtin.audio', 'builtin.flight-data', 'builtin.flight-vectors', 'builtin.maneuver-planner', 'builtin.navball', 'builtin.orbit-markers', 'builtin.telemetry']);
  await openPanel(page, 'data');
  await instrument(page, 'Telemetry').click();
  await expect(instrument(page, 'Telemetry')).toHaveAttribute('aria-pressed', 'false');
  await expect(panel).toHaveCount(0);
  await instrument(page, 'Velocity').click();
  await instrument(page, 'Orbit markers').click();
  await instrument(page, 'Navball').click();
  await instrument(page, 'Maneuver planner').click();
  // Flight data stays only while something needs it.
  await expect.poll(async () => (await debug(page)).presentation.modules).toEqual(['builtin.audio']);
  await expect.poll(async () => (await debug(page)).presentation.overlayPrimitives).toBe(0);
  const after = await debug(page);
  expect(after.world).toBe(before.world);
  expect(after.fingerprint).toBe(before.fingerprint);
  expect(after.tick).toBeGreaterThan(before.tick);
  await expect(page.locator('#save-world')).toBeEnabled();
  // A viewer's choices are remembered in this browser, relative to the defaults.
  await page.reload();
  await openPanel(page, 'data');
  for (const name of ['Velocity', 'Orbit markers', 'Telemetry', 'Navball', 'Maneuver planner']) await expect(instrument(page, name)).toHaveAttribute('aria-pressed', 'false');
  await instrument(page, 'Telemetry').click();
  await expect(page.locator('#presentation-status')).toContainText('Telemetry enabled with Flight data, which it needs');
  await expect.poll(async () => (await debug(page)).presentation.modules).toEqual(['builtin.audio', 'builtin.flight-data', 'builtin.telemetry']);
  expect(errors).toEqual([]);
});

test('dependencies: an add-on enables what it needs, and removing a library removes what uses it', async ({ page }) => {
  await useCanvas(page);
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?presentation=none');
  await expect.poll(async () => (await debug(page)).presentation?.modules).toEqual([]);
  await openPanel(page, 'library');
  await page.locator('.presentation-settings summary').click();
  const list = page.locator('#presentation-list');
  await expect(list.locator('li', { hasText: 'Lead camera (example)' })).toContainText('Needs Flight data');
  await list.locator('input[data-module="example.lead-camera"]').check();
  await expect(page.locator('#presentation-status')).toContainText('Lead camera (example) enabled with Flight data, which it needs');
  await expect(list.locator('input[data-module="builtin.flight-data"]')).toBeChecked();
  await expect(list.locator('li', { hasText: 'Flight data' }).first()).toContainText('Used by Lead camera (example)');
  await orbit(page);
  // Camera modes from modules join the camera button's cycle.
  const camera = page.locator('#camera');
  await expect(camera).toHaveText('Follow ship');
  await camera.click();
  await expect(camera).toHaveText('Planet view');
  await camera.click();
  await expect(camera).toHaveText('Free camera');
  await camera.click();
  await expect(camera).toHaveText('Lead camera');
  await expect.poll(async () => (await debug(page)).camera.mode).toBe('example.lead-camera/lead');
  const lead = await debug(page);
  expect(Math.hypot(lead.camera.center.x - lead.position.x, lead.camera.center.y - lead.position.y)).toBeGreaterThan(1);
  await openPanel(page, 'library');
  await list.locator('input[data-module="builtin.flight-data"]').uncheck();
  await expect(page.locator('#presentation-status')).toContainText('Flight data disabled, with Lead camera (example), which needs it');
  await expect.poll(async () => (await debug(page)).presentation.modules).toEqual([]);
  await expect(camera).toHaveText('Follow ship');
  expect(errors).toEqual([]);
});

test('renderer switches keep the instruments and never change the flight or its fingerprint', async ({ page }) => {
  test.slow(); // Three renderer replacements on a software GPU.
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  test.skip(await page.locator('#renderer-toggle').textContent() !== 'Renderer: WebGL', 'WebGL 2 unavailable in this browser environment');
  await orbit(page);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.locator('#status')).toHaveText('PAUSED');
  const before = await debug(page);
  await openPanel(page, 'settings');
  for (const [label, renderer] of [['Renderer: 2D', 'builtin.canvas'], ['Renderer: WebGL', 'builtin.webgl'], ['Renderer: 2D', 'builtin.canvas']]) {
    await page.locator('#renderer-toggle').click();
    await expect(page.locator('#renderer-toggle')).toHaveText(label!);
    // Diagnostics refresh at 4 Hz: wait for the new renderer's own frames.
    await expect.poll(async () => { const d = await debug(page); return d.renderer === renderer && d.presentation.overlayPrimitives > 0; }).toBe(true);
  }
  const after = await debug(page);
  expect(after.renderer).toBe('builtin.canvas');
  expect(after.presentation.modules).toEqual(before.presentation.modules);
  for (const key of ['world', 'fingerprint', 'tick', 'position', 'velocity']) expect(after[key]).toEqual(before[key]);
  expect(errors).toEqual([]);
});

test('module commands bind keys and buttons and go through the host', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/?example=commands');
  const commands = page.locator('#module-commands');
  await expect(commands.getByRole('button', { includeHidden: true })).toHaveText(['Full throttle Z', 'Cut throttle X', 'Throttle +10% V']);
  await expect(page.locator('#module-name')).toHaveText('example.maneuvers');
  await expect(page.locator('#save-world')).toBeDisabled();
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.press('z');
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  await page.keyboard.press('x');
  await expect(page.locator('#throttle-value')).toHaveText('0%');
  await page.keyboard.press('v');
  await expect(page.locator('#throttle-value')).toHaveText('10%');
  await openPanel(page, 'ship');
  await commands.getByRole('button', { name: /Full throttle/ }).click();
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  expect((await debug(page)).commands).toEqual(['example.maneuvers/full-throttle', 'example.maneuvers/cut-throttle', 'example.maneuvers/trim-throttle']);
  expect(errors).toEqual([]);
});

test('repeated presentation changes release GPU programs, panels and module resources', async ({ page }) => {
  test.slow(); // Many renderer rebuilds on a software GPU.
  await page.addInitScript(() => {
    const live = new Set<WebGLProgram>();
    const stats = { live: 0 };
    (window as unknown as { programStats: typeof stats }).programStats = stats;
    const proto = WebGL2RenderingContext.prototype, create = proto.createProgram, remove = proto.deleteProgram;
    proto.createProgram = function () { const p = create.call(this); if (p) live.add(p); stats.live = live.size; return p; };
    proto.deleteProgram = function (p) { if (p) live.delete(p); stats.live = live.size; return remove.call(this, p); };
  });
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/');
  test.skip(await page.locator('#renderer-toggle').textContent() !== 'Renderer: WebGL', 'WebGL 2 unavailable in this browser environment');
  await orbit(page);
  const programs = () => page.evaluate(() => (window as unknown as { programStats: { live: number } }).programStats.live);
  // Three pack programs, the private colored pass and the private overlay-label pass.
  await expect.poll(programs).toBe(5);
  await openPanel(page, 'data');
  for (let i = 0; i < 4; i++) {
    for (const name of ['Telemetry', 'Velocity', 'Orbit markers', 'Navball', 'Maneuver planner']) await instrument(page, name).click();
    await expect.poll(async () => (await debug(page)).presentation.modules.length).toBe(i % 2 ? 7 : 1);
    expect(await page.locator('.module-panel').count()).toBeLessThanOrEqual(1);
  }
  await openPanel(page, 'settings');
  for (let i = 0; i < 4; i++) await page.locator('#renderer-toggle').click();
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: WebGL');
  await expect.poll(programs).toBe(5);
  await page.locator('#renderer-toggle').click();
  await expect.poll(programs).toBe(0);
  await expect(page.locator('.module-panel')).toHaveCount(1);
  expect((await debug(page)).presentation.faults).toEqual([]);
  expect(errors).toEqual([]);
});

test('a copied offline HTML runs the instruments and module commands without network access', async ({ page, context }, testInfo) => {
  const path = testInfo.outputPath('instruments.html');
  await copyFile(resolve('dist/space-lab-offline.html'), path);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', req => { if (/^https?:/.test(req.url())) requests.push(req.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await disableNetwork(context);
  await page.goto(`${pathToFileURL(path).href}?example=commands`);
  await openPanel(page, 'data');
  await expect(instrument(page, 'Telemetry')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.module-panel')).toContainText('Thrust / weight');
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.press('z');
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await page.keyboard.up('Space');
  await expect.poll(async () => (await debug(page)).presentation.overlayPrimitives).toBeGreaterThan(0);
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test.describe('overlay rasterization', () => {
  let script: string;
  test.beforeAll(async () => {
    const output = await build({ configFile: false, logLevel: 'silent', build: { write: false,
      lib: { entry: resolve('tests/helpers/overlay-harness.ts'), name: 'overlayHarness', formats: ['iife'] } } });
    const bundle = Array.isArray(output) ? output[0]! : output;
    if (!('output' in bundle)) throw new Error('Expected test harness bundle');
    const chunk = bundle.output.find(c => c.type === 'chunk');
    if (!chunk || chunk.type !== 'chunk') throw new Error('Missing test harness chunk');
    script = chunk.code;
  });
  test.use({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 2 });
  test('Canvas and WebGL draw module overlays at the same CSS pixels on a high-DPI screen', async ({ page }) => {
    await page.goto('about:blank');
    await page.addScriptTag({ content: script });
    const probes = [
      { x: 200, y: 100 }, { x: 200, y: 106 }, // red 4 px screen line, and just below it
      { x: 400, y: 300 }, { x: 400, y: 325 }, // green 20 px world disc, and outside it
      { x: 400, y: 450 }, { x: 400, y: 456 }, // yellow world line at y = -75 m
      { x: 680, y: 150 }, { x: 650, y: 150 }, // magenta ring edge, and its empty centre
      { x: 600, y: 300 }, { x: 594, y: 300 }, // planet-sized cyan ring's visible arc
    ];
    // Anti-aliased edges vary by engine; line and disc centres must carry the overlay color.
    const near = (p: number[] | undefined, rgb: readonly number[]): boolean => !!p && rgb.every((c, i) => Math.abs(p[i]! - c) < 70);
    for (const renderer of ['canvas', 'webgl'] as const) {
      const result = await page.evaluate(options => window.overlayHarness.draw(options),
        { renderer, probes, boxes: [{ x0: 480, y0: 506, x1: 580, y1: 522 }] });
      expect(result.size).toEqual([1600, 1200]);
      expect(result.error).toBe(0);
      const p = result.probes as number[][];
      const colors = [[255, 0, 0], [0, 255, 0], [255, 255, 0], [255, 0, 255], [0, 255, 255]];
      colors.forEach((rgb, i) => {
        expect(near(p[2 * i], rgb), `${renderer} probe ${2 * i} ${p[2 * i]}`).toBe(true);
        expect(near(p[2 * i + 1], rgb), `${renderer} probe ${2 * i + 1} ${p[2 * i + 1]}`).toBe(false);
      });
      const glyphs = result.boxes[0]!.filter(px => near(px, [51, 102, 255])).length;
      expect(glyphs).toBeGreaterThan(40);
      await page.screenshot({ path: `test-results/overlays-${renderer}-${test.info().project.name}.png` });
    }
  });
});
