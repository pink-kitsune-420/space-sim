import { test, expect, type Page } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

interface WarpTestPad { index: number; id: string; connected: boolean; axes: number[]; buttons: { pressed: boolean; value: number; touched: boolean }[] }
declare global { interface Window { warpTestPad: WarpTestPad } }

async function orbit(page: Page, touch = false): Promise<void> {
  await useCanvas(page);
  await page.addInitScript(touch => {
    localStorage.setItem('space-sim:touch-controls:v1', touch ? 'always' : 'never');
    window.warpTestPad = { index: 0, id: 'Xbox Warp Test', connected: true, axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 18 }, () => ({ pressed: false, touched: false, value: 0 })) };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [window.warpTestPad] });
  }, touch);
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await closePanel(page);
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
}

async function padButton(page: Page, index: number): Promise<void> {
  for (const pressed of [true, false]) await page.evaluate(async ({ index, pressed }) => {
    window.warpTestPad.buttons[index] = { pressed, touched: pressed, value: pressed ? 1 : 0 };
    // Let the flight loop observe both edges before the next press.
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  }, { index, pressed });
}

for (const input of ['keyboard', 'touch', 'controller'] as const) {
  test(`${input}: blocked faster-warp presses do not accumulate requests at the safety ceiling`, async ({ page }) => {
    await orbit(page, input === 'touch');
    async function step(up: boolean): Promise<void> {
      if (input === 'keyboard') await page.keyboard.press(up ? 'BracketRight' : 'BracketLeft');
      else if (input === 'controller') await padButton(page, up ? 5 : 4);
      else {
        const button = page.locator(up ? '#touch-warp-up' : '#touch-warp-down');
        await button.dispatchEvent('pointerdown', { pointerId: 1 });
        await button.dispatchEvent('pointerup', { pointerId: 1 });
      }
    }
    // Steering holds the safety ceiling at 4x without changing the orbit.
    await page.keyboard.down('ArrowRight');
    for (let i = 0; i < 8; i++) await step(true);
    await expect(page.locator('#warp-factor')).toHaveText('4×');
    await expect(page.locator('#warp-up')).toBeDisabled();
    await step(false);
    await expect(page.locator('#warp-factor')).toHaveText('3×');
    await page.keyboard.up('ArrowRight');
    // Clearing the ceiling must not resurrect blocked faster-warp presses.
    await expect(page.locator('#warp-up')).toBeEnabled();
    await expect(page.locator('#warp-factor')).toHaveText('3×');
    await page.keyboard.press('Slash');
    await expect(page.locator('#warp-factor')).toHaveText('1×');
    await expect(page.locator('#warp-down')).toBeDisabled();
  });
}

test('warp buttons follow changing safety ceilings and decrease from the effective rate', async ({ page }) => {
  await orbit(page);
  for (let i = 0; i < 7; i++) await page.locator('#warp-up').click();
  await expect(page.locator('#warp-factor')).toHaveText('50×');
  await expect(page.locator('#warp-up')).toBeDisabled();
  await expect(page.locator('#warp-up')).toHaveAttribute('title', /Orbit period/);

  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.down('ArrowRight');
  await expect(page.locator('#warp-factor')).toHaveText('4×');
  await expect(page.locator('#warp-up')).toBeDisabled();
  await page.locator('#warp-down').click();
  await expect(page.locator('#warp-factor')).toHaveText('3×');
  await page.keyboard.up('ArrowRight');
  await expect(page.locator('#warp-up')).toBeEnabled();
  await page.locator('#warp-up').click();
  await expect(page.locator('#warp-factor')).toHaveText('4×');

  await page.locator('#pause').click();
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await expect(page.locator('#warp-up')).toBeDisabled();
  await page.locator('#flight-view').click({ position: { x: 20, y: 120 } });
  await page.keyboard.press('BracketRight');
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await page.locator('#pause').click();
  await expect(page.locator('#warp-up')).toBeEnabled();
  await expect(page.locator('#warp-factor')).toHaveText('1×');
});
