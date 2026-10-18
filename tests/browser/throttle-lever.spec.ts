import { test, expect, type Page } from '@playwright/test';
import { closePanel, openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

test.describe.configure({ timeout: 60000 });

const lever = (page: Page, slot = 0) => page.locator(`.throttle-lever[data-slot="${slot}"]`);
const track = (page: Page, slot = 0) => lever(page, slot).getByRole('slider');
async function power(page: Page, expected: number, slot = 0) {
  await expect.poll(async () => Math.abs(Number(await track(page, slot).getAttribute('aria-valuenow')) - expected)).toBeLessThanOrEqual(1);
}
async function drag(page: Page, power: number, slot = 0) {
  const box = (await track(page, slot).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + (power === 0 ? box.height - 2 : power === 1 ? 2 : 8 + (1 - power) * (box.height - 16)), { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await useCanvas(page); await page.goto('/'); await closePanel(page);
  await expect(track(page)).toBeVisible();
});

test('lever and existing controls synchronize, held input locks and cancels dragging', async ({ page }) => {
  await drag(page, .25);
  await power(page, 25);
  await expect(page.locator('#throttle-value')).toHaveText(await lever(page).locator('output').innerText());
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'ship');
  await page.locator('#throttle').fill('63');
  await page.locator('#throttle').dispatchEvent('input');
  await closePanel(page);
  await expect(lever(page).locator('output')).toHaveText('63%');
  await page.locator('#flight-view').focus();
  await page.keyboard.down('ArrowUp');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
  await drag(page, .1);
  await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
  await page.keyboard.up('ArrowUp');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'false');
  // Begin dragging, then press the engine key: the current gesture must be discarded.
  const box = (await track(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 56); await page.mouse.down();
  await power(page, 50);
  await page.keyboard.down('Space');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await page.mouse.move(box.x + 20, box.y + 104);
  await power(page, 50);
  await page.keyboard.up('Space');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'false');
  await page.mouse.move(box.x + 20, box.y + 8); await page.mouse.up();
  await power(page, 50);
  await drag(page, 0); await expect(track(page)).toHaveAttribute('aria-valuenow', '0');
  await track(page).focus(); await page.keyboard.press('End');
  await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
});

test('lever fits beside the navball on desktop and phone and hides with it', async ({ page }, info) => {
  for (const size of [{ width: 1366, height: 622 }, { width: 375, height: 812 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => {
      const b = (await lever(page).boundingBox())!;
      return b.x >= 0 && b.y >= 0 && b.x + b.width <= size.width && b.y + b.height <= size.height;
    }).toBe(true);
    await drag(page, .75); await power(page, 75);
    await page.screenshot({ path: info.outputPath(`lever-${size.width}.png`) });
  }
  await openPanel(page, 'settings');
  await page.locator('#hud-visible-navball').uncheck();
  await expect(lever(page)).toBeHidden();
  await page.locator('#hud-visible-navball').check(); await closePanel(page);
  await expect(lever(page)).toBeVisible();
});

test('each pilot owns a separate lever in shared and split views', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="4"]').click();
  await page.locator('#controls-close').click(); await closePanel(page);
  for (const mode of ['dynamic', 'split']) {
    await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
    await page.locator('#split-screen-mode').selectOption(mode);
    await page.locator('#controls-close').click(); await closePanel(page);
    await page.locator('.split-pane, #flight-view').evaluateAll(elements => Promise.all(elements.flatMap(el => el.getAnimations().map(a => a.finished))));
    for (let slot = 0; slot < 4; slot++) {
      await expect(track(page, slot)).toBeVisible();
      await drag(page, (slot + 1) / 5, slot);
    }
    for (let slot = 0; slot < 4; slot++) await power(page, (slot + 1) * 20, slot);
  }
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="1"]').click();
  await page.locator('#controls-close').click(); await closePanel(page);
  await expect(lever(page, 1)).toBeHidden();
});

test('pointer cancellation and blur require a fresh drag', async ({ page }) => {
  const box = (await track(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 56); await page.mouse.down();
  await power(page, 50);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.move(box.x + 20, box.y + 104); await page.mouse.up();
  await power(page, 50);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await drag(page, .4); await power(page, 40);
});

test('native touch dragging and cancellation leave camera and throttle stable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native touch injection uses Chromium CDP');
  await page.setViewportSize({ width: 375, height: 812 });
  const box = (await track(page).boundingBox())!;
  const before = await page.locator('#debug').evaluate(el => { const c = JSON.parse(el.textContent!).camera; return { mode: c.mode, follow: c.follow }; });
  const cdp = await page.context().newCDPSession(page);
  const touch = async (type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel', y: number) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x: box.x + 20, y }],
  });
  await touch('touchStart', box.y + 56);
  await touch('touchMove', box.y + 8);
  await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
  await touch('touchCancel', 0);
  expect(await page.locator('#debug').evaluate(el => { const c = JSON.parse(el.textContent!).camera; return { mode: c.mode, follow: c.follow }; })).toEqual(before);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await drag(page, .4); await power(page, 40);
});


test('controller throttle follows the same readout and locks pointer input', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{
    index: 0, id: 'Xbox Test', connected: true, mapping: 'standard', axes: [0, -1, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
  }] }));
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
  await drag(page, 0); await expect(track(page)).toHaveAttribute('aria-valuenow', '100');
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] }));
  await expect(track(page)).toHaveAttribute('aria-disabled', 'false');
  await drag(page, .3); await power(page, 30);
  await openPanel(page, 'settings'); await page.locator('#theme-toggle').click();
  await page.locator('[data-tab="tab-hud"]').click();
  await page.locator('[data-window-option="apollo"]').click();
  await expect(lever(page).locator('output')).toHaveCSS('color', 'rgb(255, 179, 0)');
  await expect(lever(page).locator('.throttle-lever-handle')).toHaveCSS('border-top-color', 'rgb(255, 179, 0)');
});
