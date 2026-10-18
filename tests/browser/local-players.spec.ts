import { test, expect, type Page } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';
import { ACTION_DEFINITIONS } from '../../apps/web/src/input-config';
import { computeNavballCenter } from '../../apps/web/src/local-players';
import { TRACK } from '../../packages/modules/src/base/toolset/navball';

interface TestPad { index: number; id: string; connected: boolean; axes: number[]; buttons: { pressed: boolean; value: number; touched: boolean }[] }
declare global { interface Window { localPilotTestPads: (TestPad | null)[] } }
const configKey = 'space-sim:local-players:v1';
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function stored(page: Page) { return page.evaluate(key => JSON.parse(localStorage.getItem(key)!), configKey); }
async function button(page: Page, pad: number, index: number, pressed: boolean) {
  await page.evaluate(({ pad, index, pressed }) => {
    window.localPilotTestPads[pad]!.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
  }, { pad, index, pressed });
}
async function players(page: Page, count = 2) {
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator(`.split-count [data-count="${count}"]`).click();
  await expect.poll(async () => (await debug(page)).localPlayers?.count).toBe(count);
}

test.describe.configure({ timeout: 60000 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, { apply(target, receiver, args) {
      if (String(args[0]).startsWith('webgl')) return null;
      return Reflect.apply(target, receiver, args);
    } });
    window.localPilotTestPads = [0, 1].map(index => ({ index, id: `Xbox Test ${index}`, connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) }));
    Object.defineProperty(navigator, 'getGamepads', { value: () => window.localPilotTestPads });
  });
  await page.goto('/');
  await expect.poll(async () => (await debug(page)).localPlayers?.count).toBe(1);
});

test('controller configuration captures buttons while suppressing gameplay for all local pilots', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await players(page);
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('pad:1');
  await page.locator('#tab-gamepad-btn').click();
  const name = ACTION_DEFINITIONS.find(a => a.id === 'orientation')!.name;
  await page.locator('#pad-bindings .key-action-row').filter({ hasText: name }).locator('.add-key-btn').click();
  await button(page, 0, 0, true); await button(page, 1, 0, true);
  await expect.poll(async () => (await stored(page)).slots[0].profile.buttons.orientation.includes(0)).toBe(true);
  await button(page, 0, 9, true); // Start must not pause the world while editing.
  await button(page, 1, 5, true); // Guest warp shortcut must also be held.
  const before = (await debug(page)).time;
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(before + .2);
  const d = await debug(page);
  expect(d.engine).toBe(false);
  expect(d.localPlayers.guests[0].controls.engine).toBe(false);
  expect(d.localPlayers.guests[0].status).toBe('landed');
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await expect(page.locator('#orientation')).toHaveText('Horizon up');
  expect(errors).toEqual([]);
});

test('controller throws respect the cheat, remapping, enabled state and disconnects', async ({ page }) => {
  await button(page, 0, 12, true);
  await page.evaluate(() => { window.localPilotTestPads[0]!.axes[2] = .6; });
  await expect.poll(async () => (await debug(page)).localPlayers.cursors.length).toBeGreaterThan(0);
  expect((await debug(page)).localPlayers.cursors.some((c: { aiming: boolean }) => c.aiming)).toBe(false);
  await button(page, 0, 12, false);
  await page.evaluate(() => { window.localPilotTestPads[0]!.axes[2] = 0; });
  await openPanel(page, 'settings'); await page.locator('#throw-cheat-toggle').check();
  await page.locator('#controls-toggle').click(); await page.locator('#tab-gamepad-btn').click();
  const name = ACTION_DEFINITIONS.find(a => a.id === 'throwShip')!.name;
  const row = page.locator('#pad-bindings .key-action-row').filter({ hasText: name });
  await row.locator('.key-chip').click(); // Remove D-pad Up.
  await row.locator('.add-key-btn').click(); await button(page, 0, 6, true);
  await expect.poll(async () => (await stored(page)).slots[0].profile.buttons.throwShip).toEqual([6]);
  await button(page, 0, 6, false);
  await page.locator('#controls-close').click(); await closePanel(page);
  await button(page, 0, 12, true);
  await expect.poll(async () => (await debug(page)).localPlayers.cursors.length).toBeGreaterThan(0);
  expect((await debug(page)).localPlayers.cursors.some((c: { aiming: boolean }) => c.aiming)).toBe(false);
  await button(page, 0, 12, false); await button(page, 0, 6, true);
  await expect.poll(async () => (await debug(page)).localPlayers.cursors[0]?.aiming).toBe(true);
  await page.evaluate(() => { window.localPilotTestPads[0] = null; });
  await expect.poll(async () => (await debug(page)).localPlayers.cursors.some((c: { aiming: boolean }) => c.aiming)).toBe(false);
  await openPanel(page, 'settings'); await page.locator('#controls-toggle').click(); await page.locator('#tab-gamepad-btn').click();
  await page.locator('#gamepad-enabled').uncheck();
  await page.locator('#controls-close').click(); await closePanel(page);
  await button(page, 1, 12, true);
  await expect.poll(async () => (await debug(page)).localPlayers.cursors).toEqual([]);
});

test('a small guest pane draws and picks its navball pin consistently, and the instrument switch disables it', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  await players(page); await page.locator('#split-screen-mode').selectOption('split');
  await page.locator('#controls-close').click(); await closePanel(page);
  const canvas = page.locator('.split-pane canvas');
  await expect.poll(async () => (await canvas.boundingBox())?.width).toBeCloseTo(480, 0);
  const box = (await canvas.boundingBox())!, scale = .8;
  await expect.poll(async () => (await debug(page)).hud.navballs.find((dial: { slot: number }) => dial.slot === 1)?.width).toBeCloseTo(box.width, 0);
  const center = (await debug(page)).hud.navballs.find((dial: { slot: number }) => dial.slot === 1);
  const pin = { x: center.x + (TRACK+2)*scale*.72, y: center.y - (TRACK+2)*scale*.72 };
  const pixel = () => canvas.evaluate((el, at) => {
    const rgb = (el as HTMLCanvasElement).getContext('2d')!.getImageData(Math.round(at.x), Math.round(at.y), 1, 1).data;
    return Math.max(...[0, 210, 255].map((value, i) => Math.abs(value - rgb[i]!)));
  }, pin);
  await expect.poll(pixel).toBeLessThanOrEqual(2);
  await page.mouse.click(box.x + pin.x, box.y + pin.y);
  await expect.poll(async () => (await stored(page)).slots[1].navball.pinned).toBe(false);
  await openPanel(page, 'data');
  await page.locator('#instruments').getByRole('button', { name: 'Navball', exact: true }).click();
  await closePanel(page);
  await expect.poll(pixel).toBeGreaterThan(2);
  await page.mouse.click(box.x + pin.x, box.y + pin.y);
  expect((await stored(page)).slots[1].navball.pinned).toBe(false);
});

test('using controller A on a navball pin consumes the engine binding', async ({ page }) => {
  // Put the primary dial at the initial cursor position to exercise the input conflict precisely.
  await players(page, 1);
  await page.getByLabel('Player 1 navball location', { exact: true }).selectOption('custom');
  await page.locator('#controls-close').click(); await closePanel(page);
  // Drag the unlocked dial to the centre; the pad cursor initially starts at the ship there.
  const canvas = page.locator('#flight-view'), box = (await canvas.boundingBox())!;
  const before = (await stored(page)).slots[0].navball;
  const center = computeNavballCenter(before, box.width, box.height, 1);
  const pinOffset = (TRACK+2)*.72;
  await page.mouse.click(box.x+center.x+pinOffset, box.y+center.y-pinOffset);
  await expect.poll(async () => (await stored(page)).slots[0].navball.pinned).toBe(false);
  // Position the pin at the ship-centred cursor by dragging the dial centre by -pinOffset,+pinOffset.
  await page.mouse.move(box.x+center.x, box.y+center.y); await page.mouse.down();
  await page.mouse.move(box.x+box.width/2-pinOffset, box.y+box.height/2+pinOffset, { steps: 8 }); await page.mouse.up();
  await page.evaluate(() => { window.localPilotTestPads[0]!.axes[2] = .2; });
  await expect.poll(async () => (await debug(page)).localPlayers.cursors.length).toBeGreaterThan(0);
  await page.evaluate(() => { window.localPilotTestPads[0]!.axes[2] = 0; });
  // The cursor moved a few pixels to become visible but remains within the pin's hit area.
  const time = (await debug(page)).time;
  await button(page, 0, 0, true);
  await expect.poll(async () => (await stored(page)).slots[0].navball.pinned).toBe(true);
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(time + .2);
  expect((await debug(page)).engine).toBe(false);
  await expect(page.locator('#status')).toHaveText('LANDED');
});

test('a hidden hosting tab releases guest thrust while its world keeps running', async ({ page }) => {
  await players(page);
  await page.getByLabel('Player 2 input', { exact: true }).selectOption('pad:1');
  await page.locator('#controls-close').click();
  await openPanel(page, 'tools');
  await page.locator('#local-multiplayer summary').click();
  await page.locator('#debug-host-game').click();
  await expect(page.locator('.connection')).toContainText('HOSTING');
  await closePanel(page);
  await button(page, 1, 0, true);
  await expect.poll(async () => (await debug(page)).localPlayers.guests[0].controls.engine).toBe(true);
  const before = (await debug(page)).time;
  // Keep the physical button held: hidden frames must not reapply it after release().
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  try {
    await expect.poll(async () => (await debug(page)).localPlayers.guests[0].controls.engine).toBe(false);
    await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(before + .3);
    const d = await debug(page);
    expect(d.engine).toBe(false);
    expect(d.localPlayers.guests[0].controls).toEqual({ turn: 0, throttle: 0, engine: false });
    expect(d.localPlayers.cursors).toEqual([]);
    await expect(page.locator('.connection')).toContainText('HOSTING');
  } finally {
    await button(page, 1, 0, false);
    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      document.dispatchEvent(new Event('visibilitychange'));
    });
  }
});

test('cancelling a guest slingshot abandons the throw without launching its ship', async ({ page }) => {
  await players(page);
  await page.locator('#split-screen-mode').selectOption('split');
  await page.locator('#controls-close').click();
  await page.locator('#throw-cheat-toggle').check();
  await closePanel(page);
  const canvas = page.locator('.split-pane canvas');
  await expect(canvas).toBeVisible();
  const box = (await canvas.boundingBox())!;
  const gesture = { pointerId: 7, pointerType: 'touch', altKey: true,
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await canvas.dispatchEvent('pointerdown', gesture);
  await expect(page.locator('#flight-slingshot-hud')).not.toHaveClass(/hidden/);
  await canvas.dispatchEvent('pointermove', { ...gesture, clientX: gesture.clientX + 80 });
  await canvas.dispatchEvent('pointercancel', { ...gesture, clientX: gesture.clientX + 80 });
  await expect(page.locator('#flight-slingshot-hud')).toHaveClass(/hidden/);
  const before = (await debug(page)).time;
  await expect.poll(async () => (await debug(page)).time).toBeGreaterThan(before + .2);
  expect((await debug(page)).localPlayers.guests[0].status).toBe('landed');
});

test('HUD edit mode moves only the selected guest navball in shared and split views', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 720 });
  for (const mode of ['dynamic', 'split']) {
    await players(page, 2); await page.locator('#split-screen-mode').selectOption(mode);
    await page.locator('#controls-close').click(); await closePanel(page);
    await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
    const pane = mode === 'split' ? page.locator('.split-pane canvas') : page.locator('#flight-view');
    const box = (await pane.boundingBox())!;
    await expect.poll(async () => (await debug(page)).hud.navballs[1].width).toBeCloseTo(box.width, 0);
    const center = (await debug(page)).hud.navballs[1];
    const primary = (await stored(page)).slots[0].navball;
    await page.mouse.move(box.x + center.x, box.y + center.y); await page.mouse.down();
    await page.mouse.move(box.x + center.x + 60, box.y + center.y - 40, { steps: 6 }); await page.mouse.up();
    await expect.poll(async () => (await stored(page)).slots[1].navball.anchor).toBe('custom');
    expect((await stored(page)).slots[1].navball.pinned).toBe(true);
    expect((await stored(page)).slots[0].navball).toEqual(primary);
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    await expect.poll(async () => (await debug(page)).hud.navballs[1].x).toBeCloseTo(center.x + 60, 0);
  }
  await openPanel(page, 'settings'); await page.locator('#hud-visible-players').uncheck(); await closePanel(page);
  for (const tag of await page.locator('.split-tag').all()) await expect(tag).toBeHidden();
  await page.reload();
  await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(2);
  for (const tag of await page.locator('.split-tag').all()) await expect(tag).toBeHidden();
});
