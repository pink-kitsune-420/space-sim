import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { expect, test, type Page } from '@playwright/test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { disableNetwork } from '../helpers/offline';

async function debug(page: Page) { return JSON.parse(await page.locator('#fixture-debug').textContent() || '{}'); }
async function noFlightAudio(page: Page) {
  await page.addInitScript(() => {
    const Original = window.AudioContext;
    (window as any).fixtureAudioContexts = 0;
    if (Original) window.AudioContext = class extends Original { constructor(options?: AudioContextOptions) { super(options); (window as any).fixtureAudioContexts++; } };
  });
}
for (const offline of [false, true]) test(`${offline ? 'offline' : 'hosted'} planet viewer selects body/camera/render services without starting a flight session`, async ({ page, context }) => {
  await noFlightAudio(page);
  const requests: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  if (offline) await disableNetwork(context);
  await page.goto(offline ? `${pathToFileURL(resolve('dist/space-lab-offline.html')).href}?game=planet-viewer` : '/?game=planet-viewer');
  await expect(page.locator('h1')).toHaveText('Planet viewer');
  await expect.poll(async () => (await debug(page)).kind).toBe('static-viewer');
  const before = await debug(page);
  expect(before.modules.map((ref: { id: string }) => ref.id).sort()).toEqual(['spacelab.camera-follow', 'spacelab.render-canvas']);
  await expect(page.locator('#flight-view')).toHaveCount(0);
  await page.locator('#viewer-zoom-in').click();
  await expect.poll(async () => (await debug(page)).camera.scale).toBeGreaterThan(before.camera.scale);
  await page.locator('#viewer-body').selectOption('moon');
  await expect.poll(async () => (await debug(page)).body).toBe('moon');
  await page.waitForTimeout(150);
  expect((await debug(page)).epoch).toBe(0);
  expect(await page.evaluate(() => (window as any).fixtureAudioContexts)).toBe(0);
  if (offline) expect(requests).toEqual([]);
  await page.screenshot({ path: `test-results/planet-viewer-${offline ? 'offline' : 'hosted'}-${test.info().project.name}.png` });
  await page.reload(); await expect(page.locator('h1')).toHaveText('Planet viewer');
});

test('survey actions, one shared tick and bounded state work with four independent views and target rebinding', async ({ page }) => {
  await noFlightAudio(page); await page.goto('/?game=survey-fixture');
  await expect(page.locator('h1')).toHaveText('Survey fixture');
  await expect.poll(async () => (await debug(page)).kind).toBe('bounded-survey');
  await page.locator('#survey-seats').selectOption('4');
  await expect(page.locator('#starter-views canvas:visible')).toHaveCount(4);
  const before = await debug(page); await page.waitForTimeout(150);
  expect((await debug(page)).state.tick).toBe(before.state.tick); // Rendering does not step the shared state.
  await page.locator('#starter-views').focus();
  await page.keyboard.down('ArrowRight'); await page.locator('#survey-step').click(); await page.keyboard.up('ArrowRight');
  expect((await debug(page)).state.positions).toEqual([1, 0, 0, 0]);
  expect((await debug(page)).state.tick).toBe(before.state.tick + 1);
  await page.locator('#survey-step').click(); expect((await debug(page)).state.positions).toEqual([1, 0, 0, 0]);
  await page.locator('#survey-pilot').selectOption({ value: '1' });
  await page.locator('#starter-views').focus();
  await page.keyboard.press('Space'); await page.locator('#survey-step').click();
  expect((await debug(page)).state.observations).toEqual([0, 1, 0, 0]);
  const canvases = page.locator('#starter-views canvas');
  const scales = await canvases.evaluateAll(elements => elements.map(element => Number((element as HTMLElement).dataset.scale)));
  await page.locator('#survey-zoom').click();
  await expect.poll(async () => Number(await canvases.nth(1).getAttribute('data-scale'))).toBeGreaterThan(scales[1]!);
  expect(Number(await canvases.nth(0).getAttribute('data-scale'))).toBe(scales[0]);
  const zoomed = Number(await canvases.nth(1).getAttribute('data-scale'));
  await page.locator('#survey-mode').selectOption('dynamic'); await expect(page.locator('#starter-views canvas:visible')).toHaveCount(1);
  await page.locator('#survey-mode').selectOption('split'); await expect(page.locator('#starter-views canvas:visible')).toHaveCount(4);
  await expect.poll(async () => Number(await canvases.nth(1).getAttribute('data-scale'))).toBeCloseTo(zoomed, 8);
  await page.setViewportSize({ width: 900, height: 700 });
  await page.locator('#survey-rebind').click(); expect((await debug(page)).targets.slice(0, 2)).toEqual([1, 0]);
  const state = (await debug(page)).state;
  await page.locator('#survey-right').click();
  expect((await debug(page)).state.positions[0]).toBe(state.positions[0] + 1);
  expect((await debug(page)).state.positions[1]).toBe(state.positions[1]);
  expect((await debug(page)).state.tick).toBe(state.tick + 1);
  await page.locator('#survey-seats').selectOption('1'); await expect(page.locator('#starter-views canvas')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).fixtureAudioContexts)).toBe(0);
  await expect(page.locator('#flight-view')).toHaveCount(0);
});

test('survey save/restore validates the complete candidate and clears held input', async ({ page }) => {
  await page.goto('/?game=survey-fixture');
  await expect.poll(async () => (await debug(page)).kind).toBe('bounded-survey');
  await page.locator('#survey-right').click(); await page.locator('#survey-record').click();
  const saved = (await debug(page)).state;
  await page.locator('#survey-save').click();
  await page.locator('#survey-right').click();
  await page.locator('#survey-load').click();
  expect((await debug(page)).state).toEqual(saved);
  await page.locator('#survey-step').click();
  expect((await debug(page)).state.positions).toEqual(saved.positions);
  const before = (await debug(page)).state;
  await page.evaluate(() => localStorage.setItem('spacelab:builtin.survey-fixture:state/1', JSON.stringify({ schema: 'unknown/1' })));
  await page.locator('#survey-load').click(); await expect(page.locator('#fixture-status')).toContainText('Invalid survey');
  expect((await debug(page)).state).toEqual(before);
});

test('unavailable viewer renderer leaves explicit startup recovery without creating flight state', async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(original, { apply(target, receiver, args) { return args[0] === '2d' ? null : Reflect.apply(target, receiver, args); } });
  });
  await page.goto('/?game=planet-viewer');
  await expect(page.locator('#startup-error')).toContainText('Could not start Planet viewer');
  await expect(page.getByRole('link', { name: 'Open Space Sim and the game Library' })).toBeVisible();
  await expect(page.locator('#flight-view')).toHaveCount(0);
});

for (const name of ['Planet viewer', 'Survey fixture']) test(`${name} explains unavailable portable export and starts its supported source adapter`, async ({ page }) => {
  await useCanvas(page); await page.goto('/'); await openPanel(page, 'library');
  const builtin = page.locator('.game-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(builtin.getByRole('button', { name: 'Export game', exact: true })).toBeDisabled();
  await expect(builtin).toContainText('Portable export needs a compatible non-flight game adapter.');
  await builtin.getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(name);
  await expect(page.locator('#flight-view')).toHaveCount(0);
});
