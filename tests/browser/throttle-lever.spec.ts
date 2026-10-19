import { disableNetwork } from '../helpers/offline';
import { test, expect, type Page } from '@playwright/test';
import { closePanel, openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

test.describe.configure({ timeout: 60000 });

const lever = (page: Page, slot = 0) => page.locator(`.throttle-lever[data-slot="${slot}"]`);
const track = (page: Page, slot = 0) => lever(page, slot).getByRole('slider');
async function power(page: Page, expected: number, slot = 0) {
  await expect.poll(async () => Math.abs(Number(await track(page, slot).getAttribute('aria-valuenow')) - expected)).toBeLessThanOrEqual(1);
}
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function advance(page: Page) {
  const time = (await debug(page)).time;
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(time + .3);
}
async function tap(page: Page, code: string, ctrlKey = false) {
  await page.locator('#flight-view').evaluate((el, { code, ctrlKey }) => {
    for (const type of ['keydown', 'keyup']) el.dispatchEvent(new KeyboardEvent(type, { code, ctrlKey, bubbles: true }));
  }, { code, ctrlKey });
}
async function drag(page: Page, power: number, slot = 0) {
  const box = (await track(page, slot).boundingBox())!;
  const current = Number(await track(page, slot).getAttribute('aria-valuenow')) / 100;
  await page.mouse.move(box.x + box.width / 2, box.y + 8 + (1 - current) * (box.height - 16));
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + (power === 0 ? box.height - 2 : power === 1 ? 2 : 8 + (1 - power) * (box.height - 16)), { steps: 4 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await useCanvas(page); await page.goto('/'); await closePanel(page);
  await expect(track(page)).toBeVisible();
});

test('every active view owns one HUD lifecycle and removal releases guest instruments while retaining Player 1',async({page})=>{
  await page.evaluate(()=>{(window as any).primaryLever=document.querySelector('.throttle-lever[data-slot="0"]');});
  for(const count of [1,2,3,4,2,1]){
    await openPanel(page,'settings');await page.locator('#players-toggle').click();
    await page.locator(`.split-count [data-count="${count}"]`).click();
    await page.locator('#controls-close').click();await closePanel(page);
    await expect.poll(async()=>{const d=await debug(page);return d.hud.views.length;}).toBe(count);
    await expect(page.locator('.throttle-lever')).toHaveCount(count);
    const views=(await debug(page)).hud.views;
    expect(new Set(views.map((view:any)=>view.seat)).size).toBe(count);expect(new Set(views.map((view:any)=>view.viewport)).size).toBe(count);
    expect(views.every((view:any)=>view.instruments===2)).toBe(true);
    expect(await page.evaluate(()=>(window as any).primaryLever===document.querySelector('.throttle-lever[data-slot="0"]'))).toBe(true);
  }
  await openPanel(page,'settings');await page.locator('#hud-visible-navball').uncheck();
  await expect(page.locator('.throttle-lever')).toHaveCount(0);
  await expect.poll(async()=>(await debug(page)).hud.views[0].instruments).toBe(0);
});

test('keyboard ramp persists, fine taps and cut synchronize with the unchanged lever', async ({ page }) => {
  await power(page, 0);
  await page.locator('#flight-view').focus();
  await tap(page, 'ArrowUp'); await power(page, 1);
  await advance(page); await power(page, 1);
  await tap(page, 'ArrowUp'); await power(page, 2);
  await page.keyboard.down('Control'); await tap(page, 'ArrowUp', true);
  await page.keyboard.up('Control'); await power(page, 2);
  await tap(page, 'ArrowDown'); await power(page, 1);
  await page.keyboard.press('KeyX'); await power(page, 0);
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
  await drag(page, .25); await power(page, 25);
  await page.locator('#flight-view').focus();
  await page.keyboard.down('ArrowDown');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.up('ArrowDown'); await advance(page);
  const reduced = Number(await track(page).getAttribute('aria-valuenow'));
  expect(reduced).toBeLessThan(25); expect(reduced).toBeGreaterThan(0);
  await advance(page); await power(page, reduced);
  await page.keyboard.down('Space');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await drag(page, .1); await power(page, reduced);
  await page.keyboard.press('KeyX'); await power(page, 0);
  await advance(page); await power(page, 0);
  await page.keyboard.up('Space'); await advance(page); await power(page, 0);
  // A cut and two short taps in one task must still produce two steps without a rendered frame.
  await page.locator('#flight-view').evaluate(el => {
    for (const code of ['KeyX', 'ArrowUp', 'ArrowUp']) {
      el.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true }));
    }
  });
  await power(page, 2);
  // Existing accessible slider keys still start and cut persistent thrust.
  await track(page).focus(); await page.keyboard.press('End'); await power(page, 100);
  await page.keyboard.press('Home'); await power(page, 0);
});

test('activation level can be remembered, recalled, reset and restored after reload', async ({ page }) => {
  await openPanel(page, 'ship');
  await page.locator('#throttle').fill('23'); await page.locator('#throttle').dispatchEvent('input');
  await expect(page.locator('#activation-throttle')).toHaveValue('23');
  await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, 23);
  await advance(page); await power(page, 23);
  await page.keyboard.press('KeyX'); await power(page, 0);
  await drag(page, .1); await power(page, 10);
  await page.locator('#flight-view').focus(); await page.keyboard.press('KeyZ'); await power(page, 23);
  await page.reload(); await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, 23);
  await openPanel(page, 'ship');
  await page.locator('#activation-throttle').fill('18'); await page.locator('#activation-throttle').press('Tab');
  await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, 18);
  await openPanel(page, 'ship'); await page.locator('#activation-throttle-reset').click();
  await expect(page.locator('#activation-throttle')).toHaveValue('50');
  await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, 50);
  await page.keyboard.press('KeyX'); await power(page, 0);
});

test('holds ramp continuously, opposing keys cancel, and remember saves active power', async ({ page }) => {
  await page.clock.install({ time: 0 });
  // Install the clock before startup schedules requestAnimationFrame.
  await page.reload(); await closePanel(page);
  await page.locator('#flight-view').focus();
  await page.clock.pauseAt(10_000);
  await page.keyboard.down('ArrowUp');
  await page.clock.runFor(1000);
  await page.keyboard.up('ArrowUp'); await power(page, 26);
  await page.clock.runFor(500); await power(page, 26);
  await page.keyboard.down('ArrowDown');
  await page.clock.runFor(500);
  await page.keyboard.up('ArrowDown'); await power(page, 13.8);
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowDown');
  await page.clock.runFor(32);
  const before = await track(page).getAttribute('aria-valuenow');
  await page.clock.runFor(500);
  await expect(track(page)).toHaveAttribute('aria-valuenow', before!);
  await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowDown');
  await page.keyboard.press('Shift+KeyZ');
  const remembered = Number(await track(page).getAttribute('aria-valuenow'));
  await page.keyboard.press('KeyX'); await page.clock.runFor(32); await power(page, 0);
  await page.keyboard.press('KeyZ'); await page.clock.runFor(32); await power(page, remembered);
  await page.clock.resume();
  await page.reload(); await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, remembered);
  await page.keyboard.press('KeyX'); await page.keyboard.press('Shift+KeyZ');
  await page.keyboard.press('KeyZ'); await power(page, 0);
});

test('remember shortcut can be remapped as a chord and survives reload', async ({ page }) => {
  await openPanel(page, 'settings'); await page.locator('#controls-toggle').click();
  const row = page.locator('.key-action-row').filter({ hasText: 'Remember Current Throttle' });
  await row.locator('.key-chip').click();
  await page.keyboard.press('Shift+KeyY');
  await expect(row.locator('.key-chip')).toContainText('Shift+Y');
  await page.locator('#controls-close').click(); await closePanel(page);
  await drag(page, .12); await power(page, 12);
  await page.locator('#flight-view').focus(); await page.keyboard.press('Shift+KeyY');
  await page.keyboard.press('KeyX'); await power(page, 0);
  await page.reload(); await closePanel(page); await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyZ'); await power(page, 12);
  await page.keyboard.press('KeyX'); await page.keyboard.press('Shift+KeyY');
  await page.keyboard.press('KeyZ'); await power(page, 0);
});

test('dragging launches without a burn button and zero throttle leaves the ship coasting', async ({ page }) => {
  await drag(page, .8);
  await expect(page.locator('#status')).toHaveText('FLYING');
  await advance(page); await power(page, 80);
  await drag(page, 0); await power(page, 0);
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
  const position = (await debug(page)).position;
  await advance(page);
  expect((await debug(page)).position).not.toEqual(position);
  await expect(lever(page)).toHaveAttribute('data-firing', 'false');
});

test('the offline file preserves lever thrust and keyboard takeover', async ({ page, context }) => {
  await disableNetwork(context);
  await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
  await closePanel(page);
  await drag(page, .3); await power(page, 30);
  await advance(page); await power(page, 30);
  await page.locator('#flight-view').focus(); await page.keyboard.down('Space');
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.up('Space');
  await advance(page); await power(page, 0);
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
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
      await drag(page, (slot + 1) / 20, slot);
    }
    for (let slot = 0; slot < 4; slot++) {
      await power(page, (slot + 1) * 5, slot);
      await expect(lever(page, slot)).toHaveAttribute('data-firing', 'true');
    }
    await expect.poll(async () => (await debug(page)).localPlayers.guests.every((g: { controls: { engine: boolean } }) => g.controls.engine)).toBe(true);
    // Keyboard takeover belongs only to its assigned pilot.
    await page.locator('#flight-view').focus(); await page.keyboard.down('Space');
    await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
    await page.keyboard.up('Space'); await power(page, 0);
    for (let slot = 1; slot < 4; slot++) await power(page, (slot + 1) * 5, slot);
  }
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="1"]').click();
  await page.locator('#controls-close').click(); await closePanel(page);
  await expect(lever(page, 1)).toBeHidden();
});

test('guest keyboard takeover releases only the guest burn', async ({ page }) => {
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click();
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('keyboard');
  await page.locator('#controls-close').click(); await closePanel(page);
  await drag(page, .2); await drag(page, .3, 1);
  await power(page, 20); await power(page, 30, 1);
  await page.locator('#flight-view').focus(); await page.keyboard.down('Space');
  await expect(track(page, 1)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.up('Space');
  await power(page, 0, 1); await power(page, 20);
  await advance(page); await power(page, 0, 1); await power(page, 20);
  await expect.poll(async () => (await debug(page)).localPlayers.guests[0].controls.engine).toBe(false);
});

test('keyboard throttle actions follow assignment and are inert when no pilot owns the keyboard', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{
    index: 0, id: 'Xbox Test', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
  }] }));
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click();
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('keyboard');
  await page.locator('#controls-close').click();
  await openPanel(page, 'ship');
  await page.locator('#activation-pilot').selectOption('1');
  await page.locator('#activation-throttle').fill('20');
  await page.locator('#activation-throttle').press('Tab'); await closePanel(page);
  await drag(page, .1); await drag(page, .2, 1);
  await page.locator('#flight-view').focus();
  await tap(page, 'ArrowUp'); await power(page, 21, 1); await power(page, 10);
  await page.keyboard.press('Shift+KeyZ');
  await page.keyboard.press('KeyX'); await power(page, 0, 1); await power(page, 10);
  await page.keyboard.press('KeyZ'); await power(page, 21, 1); await power(page, 10);
  await page.keyboard.press('KeyX'); await power(page, 0, 1);
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.getByLabel('Player 1 input', { exact: true }).selectOption('pad:0');
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('none');
  await page.locator('#controls-close').click(); await closePanel(page);
  await drag(page, .1); await drag(page, .2, 1);
  await page.locator('#flight-view').focus();
  for (const key of ['ArrowUp', 'ArrowDown', 'Shift+KeyZ', 'KeyX', 'KeyZ']) {
    await page.keyboard.press(key); await advance(page);
    await power(page, 10); await power(page, 20, 1);
  }
});

test('guest controller reset clears only the guest burn', async ({ page }) => {
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{
    index: 0, id: 'Xbox Test', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: i === 8 && document.body.dataset.resetGuest === 'true', touched: false, value: 0 })),
  }] }));
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click();
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('pad:0');
  await page.locator('#controls-close').click(); await closePanel(page);
  await drag(page, .2); await drag(page, .3, 1);
  await power(page, 20); await power(page, 30, 1);
  await page.evaluate(() => { document.body.dataset.resetGuest = 'true'; });
  await power(page, 0, 1); await advance(page); await power(page, 0, 1); await power(page, 20);
});

test('controller fine ramp, cut and recall belong only to the assigned guest', async ({ page }) => {
  await openPanel(page, 'ship');
  await page.locator('#activation-pilot').selectOption('1');
  await page.locator('#activation-throttle').fill('20');
  await page.locator('#activation-throttle').press('Tab');
  await closePanel(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{
    index: 0, id: 'Xbox Test', connected: true, mapping: 'standard', axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 18 }, (_, i) => ({ pressed: (document.body.dataset.padButtons ?? '').split(',').includes(String(i)), touched: false, value: 0 })),
  }] }));
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click();
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('pad:0');
  await page.locator('#controls-close').click(); await closePanel(page);
  await drag(page, .1); await power(page, 10);
  const pulse = async (value: string) => page.evaluate(async value => {
    document.body.dataset.padButtons = value;
    // Let the app poll the press, then release within two frames, before hold repeat.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
      document.body.dataset.padButtons = ''; resolve();
    })));
  }, value);
  await pulse('6,12'); await advance(page);
  const fine = Number(await track(page, 1).getAttribute('aria-valuenow'));
  expect(fine).toBeGreaterThan(0); expect(fine).toBeLessThanOrEqual(1.3);
  await advance(page); await expect(track(page, 1)).toHaveAttribute('aria-valuenow', String(fine));
  await pulse('12'); await advance(page);
  const normal = Number(await track(page, 1).getAttribute('aria-valuenow'));
  expect(normal - fine).toBeGreaterThanOrEqual(.9); expect(normal - fine).toBeLessThanOrEqual(6.3);
  await advance(page); await expect(track(page, 1)).toHaveAttribute('aria-valuenow', String(normal));
  await pulse('11'); await power(page, 0, 1);
  await advance(page); await power(page, 10);
  await pulse('0'); await power(page, 20, 1);
  await advance(page); await power(page, 20, 1); await power(page, 10);
  await pulse('11'); await power(page, 0, 1);
  await page.locator('#flight-view').focus();
  await page.keyboard.press('KeyX'); await power(page, 0);
});

test('pointer cancellation and blur require a fresh drag', async ({ page }) => {
  const box = (await track(page).boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 8 + .7 * (box.height - 16)); await page.mouse.down();
  await power(page, 30);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await page.mouse.move(box.x + 20, box.y + 104); await page.mouse.up();
  await power(page, 0);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await drag(page, .4); await power(page, 40);
});

test('pause and reset clear a persistent burn', async ({ page }) => {
  await drag(page, .3); await power(page, 30);
  await page.keyboard.press('KeyP');
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await power(page, 0);
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#status')).toHaveText('LANDED');
  await advance(page); await power(page, 0);
  await drag(page, .3); await power(page, 30);
  await page.keyboard.press('KeyR');
  await advance(page); await power(page, 0);
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
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
  await expect(page.locator('#status')).toHaveText('FLYING');
  await advance(page); await power(page, 100);
  await drag(page, .4); await power(page, 40);
});


test('controller throttle follows the same readout and locks pointer input', async ({ page }) => {
  await drag(page, .3); await power(page, 30);
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [{
    index: 0, id: 'Xbox Test', connected: true, mapping: 'standard', axes: [0, -1, 0, 0],
    buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })),
  }] }));
  await expect(track(page)).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('#throttle-value')).toHaveText('100%');
  await drag(page, 0); await power(page, 100);
  await page.evaluate(() => Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] }));
  await expect(track(page)).toHaveAttribute('aria-disabled', 'false');
  await advance(page); await power(page, 100);
  await page.locator('#flight-view').focus(); await page.keyboard.press('KeyX'); await power(page, 0);
  await drag(page, .3); await power(page, 30);
  await openPanel(page, 'settings'); await page.locator('#theme-toggle').click();
  await page.locator('[data-tab="tab-hud"]').click();
  await page.locator('[data-window-option="apollo"]').click();
  await expect(lever(page).locator('output')).toHaveCSS('color', 'rgb(255, 179, 0)');
  await expect(lever(page).locator('.throttle-lever-handle')).toHaveCSS('border-top-color', 'rgb(255, 179, 0)');
});

test('HUD target rebind and viewport resize preserve one instrument pair per seat and leave removed controls inert',async({page})=>{
  await page.evaluate(()=>{(window as any).primaryLever=document.querySelector('.throttle-lever[data-slot="0"]');});
  await drag(page,.25);await power(page,25);
  const previous=(await debug(page)).ship;await openPanel(page,'fleet');await page.getByRole('button',{name:'Launch another',exact:true}).click();
  await expect.poll(async()=>(await debug(page)).ship).not.toBe(previous);
  await expect.poll(async()=>{const d=await debug(page);return d.hud.views[0].target===d.ship;}).toBe(true);
  await closePanel(page);await power(page,0);expect((await debug(page)).engine).toBe(false);
  await openPanel(page,'settings');await page.locator('#players-toggle').click();await page.locator('.split-count [data-count="3"]').click();await page.locator('#controls-close').click();await closePanel(page);
  await expect(page.locator('.throttle-lever')).toHaveCount(3);
  for(const mode of ['split','dynamic']){
    await openPanel(page,'settings');await page.locator('#players-toggle').click();await page.locator('#split-screen-mode').selectOption(mode);await page.locator('#controls-close').click();await closePanel(page);
    for(const size of [{width:1280,height:900},{width:960,height:720}]){
      await page.setViewportSize(size);
      await expect.poll(async()=>{const views=(await debug(page)).hud.views;return views.length===3&&new Set(views.map((v:any)=>v.viewport)).size===3&&views.every((v:any)=>v.instruments===2);}).toBe(true);
      for(let slot=0;slot<3;slot++)await expect(track(page,slot)).toBeVisible();
    }
  }
  await page.evaluate(()=>{(window as any).removedSlider=document.querySelector('.throttle-lever[data-slot="2"] [role="slider"]');});
  await openPanel(page,'settings');await page.locator('#players-toggle').click();await page.locator('.split-count [data-count="1"]').click();await page.locator('#controls-close').click();await closePanel(page);
  await expect(page.locator('.throttle-lever')).toHaveCount(1);
  await page.evaluate(()=>{const stale=(window as any).removedSlider;stale.dispatchEvent(new KeyboardEvent('keydown',{code:'End',key:'End',bubbles:true}));});
  await expect.poll(async()=>(await debug(page)).hud.views.length).toBe(1);await power(page,0);expect((await debug(page)).engine).toBe(false);
  expect(await page.evaluate(()=>(window as any).primaryLever===document.querySelector('.throttle-lever[data-slot="0"]'))).toBe(true);
});
