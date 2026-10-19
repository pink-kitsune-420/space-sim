import { openPanel } from '../helpers/workspace';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
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
  await useLowGraphics(page);
  const requests: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  if (offline) await disableNetwork(context);
  await page.goto(offline ? `${pathToFileURL(resolve('dist/space-lab-offline.html')).href}?game=planet-viewer` : '/?game=planet-viewer');
  await expect(page.locator('h1')).toHaveText('Planet viewer');
  await expect.poll(async () => (await debug(page)).kind).toBe('static-viewer');
  const before = await debug(page);
  expect(before.modules.map((ref: { id: string }) => ref.id).sort()).toEqual(['spacelab.camera-follow', 'spacelab.input-keyboard', 'spacelab.render-canvas', 'spacelab.render-webgl']);
  await expect(page.locator('#viewer-renderer')).toHaveValue('webgl');
  expect(await page.locator('#planet-view').evaluate(canvas => !!(canvas as HTMLCanvasElement).getContext('webgl2'))).toBe(true);
  await expect(page.locator('#flight-view')).toHaveCount(0);
  await page.locator('#viewer-zoom-in').click();
  await expect.poll(async () => (await debug(page)).camera.scale).toBeGreaterThan(before.camera.scale);
  await page.locator('#viewer-body').selectOption('moon');
  await expect.poll(async () => (await debug(page)).body).toBe('moon');
  await page.waitForTimeout(150);
  expect((await debug(page)).epoch).toBe(0);
  const selected = await debug(page);
  await page.locator('#viewer-renderer').selectOption('2d');
  expect(await page.locator('#planet-view').evaluate(canvas => !!(canvas as HTMLCanvasElement).getContext('2d'))).toBe(true);
  expect((await debug(page)).camera).toEqual(selected.camera);
  await page.locator('#viewer-renderer').selectOption('webgl');
  expect((await debug(page)).renderer).toBe('webgl');
  expect((await debug(page)).body).toBe('moon');
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
    HTMLCanvasElement.prototype.getContext = new Proxy(original, { apply(target, receiver, args) { return args[0] === '2d' || String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, receiver, args); } });
  });
  await page.goto('/?game=planet-viewer');
  await expect(page.locator('#startup-error')).toContainText('Could not start Planet viewer');
  await expect(page.getByRole('link', { name: 'Open Space Sim and the game Library' })).toBeVisible();
  await expect(page.locator('#flight-view')).toHaveCount(0);
});

test('planet viewer falls back to 2D and keeps the current view when WebGL cannot start', async ({ page }) => {
  await useCanvas(page); await page.goto('/?game=planet-viewer');
  await expect(page.locator('#viewer-renderer')).toHaveValue('2d');
  await expect(page.locator('#fixture-status')).toContainText('WebGL unavailable');
  const canvas = await page.locator('#planet-view').elementHandle();
  await page.locator('#viewer-zoom-in').click(); const before = await debug(page);
  await page.locator('#viewer-renderer').selectOption('webgl');
  await expect(page.locator('#viewer-renderer')).toHaveValue('2d');
  expect((await debug(page)).camera).toEqual(before.camera);
  expect(await canvas!.evaluate(element => element.isConnected)).toBe(true);
  await page.locator('#viewer-zoom-out').click();
  expect((await debug(page)).camera.scale).toBeLessThan(before.camera.scale);
});

test('planet viewer submits authored planet appearances to the body shader instead of inventing flat terrain', async ({ page }) => {
  await useLowGraphics(page);
  await page.addInitScript(() => {
    const names = new WeakMap<WebGLUniformLocation, string>();
    (window as any).viewerBodyUniforms = {};
    const locate = WebGL2RenderingContext.prototype.getUniformLocation, integer = WebGL2RenderingContext.prototype.uniform1i;
    WebGL2RenderingContext.prototype.getUniformLocation = function(program, name) {
      const location = locate.call(this, program, name); if (location) names.set(location, name); return location;
    };
    WebGL2RenderingContext.prototype.uniform1i = function(location, value) {
      const name = location && names.get(location);
      if (name === 'u_bodyCount' || name === 'u_bodies[0].style') (window as any).viewerBodyUniforms[name] = value;
      integer.call(this, location, value);
    };
  });
  await page.goto('/?game=planet-viewer');
  await expect(page.locator('#viewer-renderer')).toHaveValue('webgl');
  await expect.poll(() => page.evaluate(() => (window as any).viewerBodyUniforms['u_bodyCount'])).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as any).viewerBodyUniforms['u_bodies[0].style'])).toBeGreaterThan(0);
});

test('planet viewer keyboard, wheel and drag controls change only the view and respect focus', async ({ page }) => {
  await useCanvas(page); await page.goto('/?game=planet-viewer');
  const stage = page.locator('#starter-views'); await stage.focus();
  const initial = await debug(page);
  await page.keyboard.press('Equal');
  await expect.poll(async () => (await debug(page)).camera.scale).toBeGreaterThan(initial.camera.scale);
  await page.keyboard.press('Minus');
  await expect.poll(async () => (await debug(page)).camera.scale).toBeCloseTo(initial.camera.scale, 10);
  await page.keyboard.down('ArrowRight');
  await expect.poll(async () => (await debug(page)).camera.center.x).toBeGreaterThan(initial.camera.center.x);
  await page.keyboard.up('ArrowRight'); await page.keyboard.press('KeyR');
  await expect.poll(async () => (await debug(page)).camera.center.x).toBe(initial.camera.center.x);
  const box = (await stage.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + 50, y + 20, { steps: 4 }); await page.mouse.up();
  expect((await debug(page)).camera.center.x).toBeLessThan(initial.camera.center.x);
  await page.mouse.wheel(0, -150);
  await expect.poll(async () => (await debug(page)).camera.scale).toBeGreaterThan(initial.camera.scale);
  await page.locator('#viewer-fit').click(); const fit = await debug(page);
  expect(fit.camera.center).toEqual(initial.camera.center);
  await page.locator('#viewer-body').focus(); await page.keyboard.press('Equal');
  await page.waitForTimeout(100); expect((await debug(page)).camera).toEqual(fit.camera);
  expect((await debug(page)).epoch).toBe(0);
});

test('planet viewer handles native touch pan, pinch, cancellation and fresh gestures', async ({ page }, info) => {
  test.skip(info.project.name !== 'chromium', 'Native touch injection uses Chromium CDP.');
  await useCanvas(page); await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?game=planet-viewer');
  const stage = page.locator('#starter-views'); await stage.scrollIntoViewIfNeeded();
  const box = (await stage.boundingBox())!, x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', points: { x: number; y: number; id: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });
  const initial = await debug(page);
  await touch('touchStart', [{ x, y, id: 1 }]); await touch('touchMove', [{ x: x + 30, y, id: 1 }]); await touch('touchEnd', []);
  await expect.poll(async () => (await debug(page)).camera.center.x).toBeLessThan(initial.camera.center.x);
  const panned = await debug(page);
  await touch('touchStart', [{ x: x - 30, y, id: 1 }, { x: x + 30, y, id: 2 }]);
  await touch('touchMove', [{ x: x - 60, y, id: 1 }, { x: x + 60, y, id: 2 }]); await touch('touchCancel', []);
  await expect.poll(async () => (await debug(page)).camera.scale).toBeGreaterThan(panned.camera.scale);
  const cancelled = await debug(page); await page.waitForTimeout(100);
  expect((await debug(page)).camera).toEqual(cancelled.camera);
  await touch('touchStart', [{ x, y, id: 3 }]); await touch('touchMove', [{ x: x - 20, y, id: 3 }]); await touch('touchEnd', []);
  await expect.poll(async () => (await debug(page)).camera.center.x).toBeGreaterThan(cancelled.camera.center.x);
  expect((await debug(page)).epoch).toBe(0); await cdp.detach();
});

test('survey zoom buttons and shortcuts affect only the selected view without advancing its world', async ({ page }) => {
  await page.goto('/?game=survey-fixture'); await page.locator('#survey-seats').selectOption('2');
  await page.locator('#survey-pilot').selectOption({ value: '1' });
  const canvases = page.locator('#starter-views canvas'), scales = () => canvases.evaluateAll(items => items.map(item => Number((item as HTMLElement).dataset.scale)));
  await expect.poll(async () => {
    const values = await scales(); return values.length === 2 && values.every(Number.isFinite);
  }).toBe(true);
  const initial = await scales(), state = (await debug(page)).state;
  await page.locator('#survey-zoom-out').click(); await expect.poll(async () => (await scales())[1]).toBeLessThan(initial[1]!);
  expect((await scales())[0]).toBe(initial[0]);
  await page.locator('#survey-fit').click(); await expect.poll(scales).toEqual(initial);
  await page.locator('#starter-views').focus(); await page.keyboard.press('Equal');
  await expect.poll(async () => (await scales())[1]).toBeGreaterThan(initial[1]!);
  await page.keyboard.press('Minus'); await expect.poll(scales).toEqual(initial);
  await page.keyboard.press('Equal'); await expect.poll(async () => (await scales())[1]).toBeGreaterThan(initial[1]!);
  await page.keyboard.press('KeyR'); await expect.poll(scales).toEqual(initial);
  expect((await debug(page)).state).toEqual(state);
});

for (const game of ['planet-viewer', 'survey-fixture']) for (const width of [390, 600]) test(`${game} phone layout at ${width}px keeps the view, status and controls apart`, async ({ page }) => {
  await useCanvas(page); await page.setViewportSize({ width, height: 844 });
  await page.goto(`/?game=${game}`);
  if (game === 'survey-fixture') await page.locator('#survey-seats').selectOption('4');
  const rectangles = await page.evaluate(() => {
    const box = (selector: string) => { const rect = document.querySelector(selector)!.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom }; };
    return { heading: box('.starter-heading'), stage: box('#starter-views'), status: box('#fixture-status'), tools: box('.starter-tools'), help: box('#starter-help'), controls: box('.fixture-controls'),
      overflow: document.querySelector('main')!.scrollWidth > document.querySelector('main')!.clientWidth };
  });
  expect(rectangles.heading.bottom).toBeLessThanOrEqual(rectangles.stage.top);
  expect(rectangles.stage.bottom).toBeLessThanOrEqual(rectangles.status.top);
  expect(rectangles.status.bottom).toBeLessThanOrEqual(rectangles.tools.top);
  expect(rectangles.help.bottom).toBeLessThanOrEqual(rectangles.controls.top);
  expect(rectangles.overflow).toBe(false);
});

for (const name of ['Planet viewer', 'Survey fixture']) test(`${name} explains unavailable portable export and starts its supported source adapter`, async ({ page }) => {
  await useCanvas(page); await page.goto('/'); await openPanel(page, 'library');
  await expect(page.locator('.game-examples')).not.toHaveAttribute('open');
  await expect(page.locator('.game-examples .game-card')).toHaveCount(3);
  await page.locator('#game-search').fill(name);
  await expect(page.locator('.game-examples')).toHaveAttribute('open', '');
  const builtin = page.locator('.game-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(builtin.getByRole('button', { name: 'Export game', exact: true })).toBeDisabled();
  await expect(builtin).toContainText('Export isn’t available for this example yet.');
  await builtin.getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('h1')).toHaveText(name);
  await expect(page.locator('#starter-help')).toHaveAttribute('open', '');
  await expect(page.locator('#starter-help li')).toHaveCount(name === 'Planet viewer' ? 2 : 4);
  await expect(page.locator('#flight-view')).toHaveCount(0);
});
