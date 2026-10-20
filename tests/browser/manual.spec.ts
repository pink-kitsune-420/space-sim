import { test, expect } from '@playwright/test';
import { openPanel } from '../helpers/workspace';
import { readFileSync } from 'node:fs';
const { version } = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

test.describe.configure({ timeout: 90000 });

test.beforeEach(async ({ page }) => {
  // This verifies documentation/navigation; renderer behavior has separate coverage.
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, { apply(target, receiver, args) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(target, receiver, args);
    } });
  });
});

test('manual shows player and creator docs with live keys', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'manual');
  const manual = page.locator('#manual-window');
  await expect(manual).toBeVisible();
  await expect(manual.locator('#manual-build-version')).toContainText(`Spacelab ${version}`);
  await expect(manual.locator('#manual-tab-players')).toHaveAttribute('aria-selected', 'true');
  await expect(manual.getByRole('button', { name: 'Configure controls…' })).toHaveCount(0);

  // The controls page is generated from the current keybindings.
  await manual.locator('.manual-topic[data-page="controls"]').click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Controls');
  await expect(manual.locator('#manual-page').getByRole('button', { name: 'Configure controls…' })).toHaveCount(1);
  await expect(manual.locator('.manual-controls caption')).toHaveText(['Flight', 'Time warp', 'Camera & view', 'System']);
  await expect(manual.locator('.manual-controls tr', { hasText: 'Fire Main Engine' }).locator('.manual-keyboard kbd')).toHaveText(['Space']);

  // In-page links and search.
  await manual.locator('#manual-tab-creators').click();
  await expect(manual.getByRole('button', { name: 'Configure controls…' })).toHaveCount(0);
  await manual.locator('#manual-page a[data-page="shaders"]').click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Shader packs');
  await manual.locator('.manual-topic[data-page="files"]').click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Files, exports and saved progress');
  await expect(manual.locator('#manual-page')).toContainText('Setup → Export');
  await expect(manual.locator('#manual-page')).toContainText('Fleet → Save universe');
  await manual.locator('#manual-search').fill('determin');
  await expect(manual.locator('.manual-topic b')).toHaveText(['Files, exports and saved progress', 'Code modules', 'Rules for simulation modules']);
  await manual.locator('#manual-search').fill('zzzz');
  await expect(manual.locator('.manual-empty')).toHaveText('No pages match.');
  await manual.locator('#manual-search').fill('');
  await manual.locator('#manual-tab-players').click();
  await manual.locator('.manual-topic[data-page="moon-flight"]').click();
  await expect(manual.locator('#manual-page')).toContainText('Find transfer windows');
  await manual.locator('#manual-page a[data-page="transfers"]').last().click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Transfer plans');
  await manual.locator('.manual-topic[data-page="multiplayer"]').click();
  await expect(manual.getByRole('button', { name: 'Configure controls…' })).toHaveCount(0);
  await expect(manual.locator('#manual-page')).toContainText('npm run host');
  await expect(manual.locator('#manual-page')).toContainText('GAME_ADDRESS');
  await manual.locator('#manual-tab-creators').click();
  await manual.locator('.manual-topic[data-page="shaders"]').click();

  // The chosen audience and page survive a reload.
  await page.reload();
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'manual');
  await expect(manual.locator('#manual-tab-creators')).toHaveAttribute('aria-selected', 'true');
  await expect(manual.locator('#manual-page h2')).toHaveText('Shader packs');
});

test('topics and article scroll independently while search stays visible', async ({ page }, info) => {
  await page.goto('/'); await openPanel(page, 'manual');
  const manual = page.locator('#manual-window'), topics = manual.locator('.manual-topics');
  const article = manual.locator('#manual-page'), search = manual.locator('#manual-search');
  const searchY = (await search.boundingBox())!.y;
  expect(await topics.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(100);
  const nav = (await topics.boundingBox())!;
  await page.mouse.move(nav.x + nav.width / 2, nav.y + nav.height / 2);
  await page.mouse.wheel(0, 2000);
  await expect.poll(() => topics.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  await manual.locator('.manual-topic[data-page="commands"]').click();
  await expect(article.locator('h2')).toHaveText('Chat commands and sandbox tools');
  expect((await search.boundingBox())!.y).toBeCloseTo(searchY, 0);
  await search.fill('Controls');
  await manual.locator('.manual-topic[data-page="controls"]').click();
  await search.fill('');
  const navScroll = await topics.evaluate(node => node.scrollTop);
  const reading = (await article.boundingBox())!;
  await page.mouse.move(reading.x + reading.width / 2, reading.y + reading.height / 2);
  await page.mouse.wheel(0, 500);
  await expect.poll(() => article.evaluate(node => node.scrollTop)).toBeGreaterThan(100);
  expect(await topics.evaluate(node => node.scrollTop)).toBeCloseTo(navScroll, 0);
  expect((await search.boundingBox())!.y).toBeCloseTo(searchY, 0);
  expect(await manual.locator('#manual-window-body').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
  await search.fill('Your first orbit');
  await manual.locator('.manual-topic[data-page="first-orbit"]').click();
  expect(await article.evaluate(node => node.scrollTop)).toBe(0);
  await search.fill('');
  await page.screenshot({ path: info.outputPath('manual-scroll-panes.png') });
});

test('Code modules uses compact expandable sections while all details remain searchable', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'manual');
  const manual = page.locator('#manual-window'), article = manual.locator('#manual-page');
  await manual.locator('#manual-tab-creators').click();
  await manual.locator('.manual-topic[data-page="modules"]').click();
  const sections = article.locator(':scope > details');
  expect(await sections.count()).toBeGreaterThan(8);
  await expect(article.locator(':scope > details[open]')).toHaveCount(0);
  const kinds = sections.filter({ has: page.locator('summary', { hasText: 'Module kinds' }) });
  await kinds.locator('summary').focus(); await page.keyboard.press('Enter');
  await expect(kinds).toHaveAttribute('open', '');
  await expect(kinds.locator('dt')).toHaveText(['Data', 'Simulation', 'Presentation']);
  await kinds.locator('summary').click(); await expect(kinds).not.toHaveAttribute('open');
  await manual.locator('#manual-search').fill('AudioOutput');
  await expect(manual.locator('.manual-topic[data-page="modules"]')).toBeVisible();
  const audio = sections.filter({ has: page.locator('summary', { hasText: 'Audio providers' }) });
  await audio.locator('summary').click(); await expect(audio).toHaveAttribute('open', '');
  await expect(audio.locator('p')).toContainText('AudioOutput');
});

test('manual resizes from every side and maximizes back to its saved geometry without losing navigation', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'manual');
  const manual = page.locator('#manual-window');
  await manual.locator('[data-page="first-orbit"]').first().click();
  await manual.locator('.manual-deeper summary').click();
  const resize = async (edge: string, dx: number, dy: number) => {
    const handle = (await manual.locator(`[data-edge="${edge}"]`).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + dx, handle.y + handle.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
  };
  const initial = (await manual.boundingBox())!;
  await resize('w', 100, 0);
  let bounds = (await manual.boundingBox())!;
  expect(bounds.width).toBeCloseTo(initial.width - 100, 0);
  expect(bounds.x).toBeCloseTo(initial.x + 100, 0);
  await resize('n', 0, 40);
  bounds = (await manual.boundingBox())!;
  expect(bounds.height).toBeCloseTo(initial.height - 40, 0);
  expect(bounds.y).toBeCloseTo(initial.y + 40, 0);
  await resize('s', 0, -60);
  expect((await manual.boundingBox())!.height).toBeCloseTo(bounds.height - 60, 0);
  await resize('e', 40, 0);
  expect((await manual.boundingBox())!.width).toBeCloseTo(bounds.width + 40, 0);
  await manual.getByRole('button', { name: 'Resize manual window', exact: true }).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  const restored = (await manual.boundingBox())!;
  expect(restored.width).toBeCloseTo(bounds.width + 8, 0);

  await manual.locator('#manual-maximize').click();
  await expect(manual.locator('#manual-maximize')).toHaveAttribute('aria-pressed', 'true');
  const viewport = (await page.locator('#flight-console .viewport').boundingBox())!;
  const maximized = (await manual.boundingBox())!;
  expect(maximized.width).toBeCloseTo(viewport.width - 16, 0);
  expect(maximized.height).toBeCloseTo(viewport.height - 16, 0);
  await expect(manual.locator('.manual-deeper')).toHaveAttribute('open', '');
  await expect(manual.locator('#manual-page h2')).toHaveText('Your first orbit');
  await manual.locator('#manual-maximize').click();
  const normal = (await manual.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(normal[key]).toBeCloseTo(restored[key], 0);

  await manual.locator('#manual-pin').click();
  await manual.locator('#manual-maximize').click();
  await page.reload();
  await expect(manual).toBeVisible();
  await expect(manual.locator('#manual-maximize')).toHaveAttribute('aria-pressed', 'true');
  await manual.locator('#manual-maximize').click();
  const reloaded = (await manual.boundingBox())!;
  for (const key of ['x', 'y', 'width', 'height'] as const) expect(reloaded[key]).toBeCloseTo(restored[key], 0);
  await manual.locator('#manual-minimize').click();
  await expect(manual.locator('#manual-window-body')).toBeHidden();
  await manual.locator('#manual-minimize').click();
  await manual.locator('#manual-tab-creators').click();
  await expect(manual.locator('#manual-tab-creators')).toHaveAttribute('aria-selected', 'true');
  await manual.locator('#manual-close').click();
  await expect(manual).toBeHidden();
  await openPanel(page, 'manual');
  await expect(manual).toBeVisible();
});

test('manual stays readable and restores within a smaller viewport', async ({ page }, info) => {
  await page.goto('/');
  await openPanel(page, 'manual');
  const manual = page.locator('#manual-window');
  await manual.locator('#manual-maximize').click();
  await page.setViewportSize({ width: 390, height: 600 });
  await expect.poll(async () => (await manual.boundingBox())!.width).toBeCloseTo(374, 0);
  await manual.locator('#manual-maximize').click();
  const bounds = (await manual.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(8);
  expect(bounds.y).toBeGreaterThanOrEqual(8);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(592);
  await manual.locator('[data-page="controls"]').first().click();
  await expect(manual.locator('#manual-page h2')).toHaveText('Controls');
  await expect(manual.locator('.manual-layout')).toHaveCSS('grid-template-columns', /^(\d+(\.\d+)?px)$/);
  expect(await manual.locator('#manual-window-body').evaluate(body => body.scrollWidth - body.clientWidth)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: info.outputPath('manual-mobile.png') });
  await manual.getByRole('button', { name: 'Configure controls…' }).click();
  await expect(page.locator('#controls-dialog')).toBeVisible();
  await page.locator('#controls-close').click();
  await expect(manual).toBeVisible();
});

test('manual uses player 1 keyboard and controller mappings and refreshes after configuring them', async ({ page }, info) => {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim:keybindings:v1', JSON.stringify({ engine: ['KeyJ', 'KeyL'], pause: [] }));
    localStorage.setItem('space-sim:local-players:v1', JSON.stringify({ count: 2, slots: [
      { device: 'auto', profile: { turnAxis: 2, invertTurn: true, buttons: { engine: [2] } } },
      { device: 'pad:1', profile: { buttons: { engine: [3] } } },
    ] }));
    const pads = [0, 1].map(index => ({ index, id: 'DualSense Test', connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => pads });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openPanel(page, 'manual');
  const manual = page.locator('#manual-window');
  await manual.locator('[data-page="controls"]').first().click();
  const engine = manual.locator('.manual-controls tbody tr').filter({ hasText: 'Fire Main Engine' });
  await expect(engine.locator('.manual-keyboard kbd')).toHaveText(['J', 'L']);
  await expect(engine.locator('.manual-controller kbd')).toHaveText(['Square (▢)']);
  await expect(manual.locator('.manual-controls tbody tr').filter({ hasText: 'Turn Left (CCW)' }).locator('.manual-controller')).toContainText('Axis 2 +');
  await page.screenshot({ path: info.outputPath('manual-mapped-controls.png') });

  await manual.getByRole('button', { name: 'Configure controls…' }).click();
  await expect(page.locator('#controls-dialog')).toBeVisible();
  const keyRow = page.locator('#keybindings-list .key-action-row').filter({ hasText: 'Fire Main Engine' });
  await keyRow.locator('.key-chip').first().click();
  await page.keyboard.press('KeyK');
  await page.locator('#tab-gamepad-btn').click();
  const padRow = page.locator('#pad-bindings .key-action-row').filter({ hasText: 'Fire Main Engine' });
  await padRow.locator('.key-chip').click();
  await padRow.locator('.add-key-btn').click();
  await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!.buttons[6]!, { pressed: true, value: 1 }));
  await expect(padRow.locator('.key-chip')).toHaveText('L2 Trigger');
  await page.evaluate(() => Object.assign(navigator.getGamepads()[0]!.buttons[6]!, { pressed: false, value: 0 }));
  await page.locator('#controls-close').click();
  await expect(engine.locator('.manual-keyboard kbd')).toHaveText(['K', 'L']);
  await expect(engine.locator('.manual-controller kbd')).toHaveText(['L2 Trigger']);
  await manual.locator('[data-page="welcome"]').first().click();
  const engineHint = manual.locator('#manual-page > ol > li').filter({ hasText: /^Look over/ });
  await expect(engineHint).toContainText('K / L or L2 Trigger');
  await expect(manual.getByRole('button', { name: 'Configure controls…' })).toHaveCount(0);
  await manual.locator('.manual-topic[data-page="controls"]').click();
  await expect(manual.getByRole('button', { name: 'Configure controls…' })).toHaveCount(1);
  await manual.getByRole('button', { name: 'Configure controls…' }).click();
  await page.locator('#tab-gamepad-btn').click();
  await page.locator('#gamepad-enabled').uncheck();
  await page.locator('#controls-close').click();
  await manual.locator('.manual-topic[data-page="welcome"]').click();
  await expect(engineHint).not.toContainText('L2 Trigger');
  expect(errors).toEqual([]);
});
