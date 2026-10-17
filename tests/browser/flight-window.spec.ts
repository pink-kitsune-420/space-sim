import { test, expect } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => {
  // Exercise HUD layout independently of software WebGL's expensive sky shader.
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(getContext, {
      apply(target, receiver, args) {
        if (String(args[0]).startsWith('webgl')) return null;
        return Reflect.apply(target, receiver, args);
      },
    });
  });
});

test('trajectory floats live readouts, drags, minimizes, persists and closes while flight continues', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await openPanel(page, 'setup');
  await page.locator('#preset').selectOption('planet-orbit');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await closePanel(page);
  await page.locator('#trajectory-toast').click();
  const panel = page.locator('#trajectory-window');
  await expect(panel).toBeVisible();
  await expect(panel.locator('#periapsis')).not.toHaveText('—');
  await expect(panel.locator('#prediction')).toContainText(/orbit|Tracing/i);
  await expect(page.locator('#periapsis')).toHaveCount(1);
  await closePanel(page);
  const initial = (await panel.boundingBox())!;
  const handle = page.getByRole('button', { name: 'Move trajectory window', exact: true });
  const drag = (await handle.boundingBox())!;
  await page.mouse.move(drag.x + 30, drag.y + 14);
  await page.mouse.down();
  await page.mouse.move(drag.x + 210, drag.y + 84, { steps: 8 });
  await page.mouse.up();
  const moved = (await panel.boundingBox())!;
  expect(moved.x).toBeCloseTo(initial.x + 180, 0);
  expect(moved.y).toBeCloseTo(initial.y + 70, 0);
  const grip = (await page.getByRole('button', { name: 'Resize trajectory window', exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 88, grip.y + 68, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await panel.boundingBox())!.width).toBeCloseTo(moved.width + 80, 0);
  await expect.poll(async () => (await panel.boundingBox())!.height).toBeCloseTo(moved.height + 60, 0);
  // The pinned window stays present while flight receives pointer and keyboard input.
  await page.locator('#flight-view').click({ position: { x: 900, y: 150 } });
  await expect(panel).toBeVisible();
  const before = await panel.locator('#prediction').textContent();
  await page.keyboard.press('z');
  await page.keyboard.down('Space');
  await expect.poll(async () => panel.locator('#prediction').textContent()).not.toBe(before);
  await page.keyboard.up('Space');
  await page.getByRole('button', { name: 'Minimize trajectory window' }).click();
  await expect(panel.locator('#trajectory-window-body')).toBeHidden();
  expect((await panel.boundingBox())!.height).toBeLessThan(60);
  await page.reload();
  await expect(panel).toBeVisible();
  await expect(panel.locator('#trajectory-window-body')).toBeHidden();
  expect((await panel.boundingBox())!.width).toBeCloseTo(moved.width + 80, 0);
  expect((await panel.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  await page.getByRole('button', { name: 'Restore trajectory window' }).click();
  await expect(panel.locator('#prediction')).toBeVisible();
  await handle.focus();
  const oldX = (await panel.boundingBox())!.x;
  await page.keyboard.press('ArrowRight');
  expect((await panel.boundingBox())!.x).toBeCloseTo(oldX + 8, 0);
  await page.screenshot({ path: info.outputPath('flight-window.png') });
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => {
    const bounds = (await panel.boundingBox())!;
    return bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 500;
  }).toBe(true);
  await page.getByRole('button', { name: 'Close trajectory window' }).click();
  await expect(panel).toBeHidden();
  await openPanel(page, 'data');
  await expect(page.locator('[data-workspace-panel="data"] #periapsis')).toHaveCount(0);
  await closePanel(page);
  await expect(page.locator('#trajectory-toast')).toBeVisible();
  await expect(page.locator('#periapsis')).toHaveCount(1);
  await page.locator('#telemetry-toast').click();
  const telemetry = page.locator('#telemetry-window');
  await expect(telemetry).toBeVisible();
  await expect(telemetry.locator('.module-rows')).toContainText('Speed');
  await page.locator('#telemetry-minimize').click();
  await expect(telemetry.locator('.flight-window-body')).toBeHidden();
  await page.getByRole('button', { name: 'Restore telemetry window' }).click();
  await page.getByRole('button', { name: 'Move telemetry window', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await page.reload();
  await expect(telemetry).toBeVisible();
  await expect(telemetry.locator('.module-rows')).toContainText('Speed');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Move telemetry window', exact: true }).focus();
  for (let i = 0; i < 13; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.getByRole('button', { name: 'Resize telemetry window', exact: true }).focus();
  const telemetryWidth = (await telemetry.boundingBox())!.width;
  await page.keyboard.press('ArrowRight');
  expect((await telemetry.boundingBox())!.width).toBeCloseTo(telemetryWidth + 8, 0);
  await page.locator('#trajectory-toast').click();
  await page.screenshot({ path: info.outputPath('both-flight-windows.png') });
  await openPanel(page, 'data');
  const instrument = page.locator('#instruments').getByRole('button', { name: 'Telemetry', exact: true });
  await instrument.click();
  await expect(telemetry.locator('.flight-window-empty')).toBeVisible();
  await instrument.click();
  await expect(telemetry.locator('.module-rows')).toContainText('Speed');
  await closePanel(page);
  await page.locator('#telemetry-close').click();
  await openPanel(page, 'data');
  await expect(page.locator('[data-workspace-panel="data"] .module-panel').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('unpinned trajectory closes on flight interaction and chat occupies the bottom-left corner without covering telemetry', async ({ page }, info) => {
  await page.goto('/');
  await closePanel(page);
  await page.locator('#trajectory-toast').click();
  await closePanel(page);
  await page.locator('#trajectory-pin').click();
  await page.locator('#flight-view').click({ position: { x: 900, y: 150 } });
  await expect(page.locator('#trajectory-window')).toBeHidden();
  for (const viewport of [{width:1280,height:720},{width:800,height:600},{width:390,height:844}]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => page.locator('#chat-overlay').evaluate(element => {
      const bounds = element.getBoundingClientRect();
      return Math.abs(window.innerHeight - bounds.bottom - (window.innerWidth <= 650 ? 8 : 12));
    })).toBeLessThan(1);
    for (const minimized of [false, true]) {
      if (minimized) await page.locator('#chat-minimize').click();
      await expect.poll(async () => page.evaluate(() => {
        const chat = document.getElementById('chat-overlay')!.getBoundingClientRect();
        const telemetry = document.querySelector('.telemetry')!.getBoundingClientRect();
        return chat.right <= telemetry.left || telemetry.bottom <= chat.top;
      })).toBe(true);
      await page.screenshot({path:info.outputPath(`chat-${viewport.width}-${minimized}.png`)});
      if (minimized) await page.locator('#chat-min-pill').click();
    }
  }
});


test('chat drags, resizes, persists its layout and drops back to the bottom when minimized', async ({ page }, info) => {
  await page.goto('/');
  const chat = page.locator('#chat-overlay');
  const start = (await chat.boundingBox())!;
  const handle = (await page.getByRole('button', { name: 'Move chat window', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + 40, handle.y + 10);
  await page.mouse.down();
  await page.mouse.move(handle.x + 440, handle.y - 190, { steps: 8 });
  await page.mouse.up();
  const moved = (await chat.boundingBox())!;
  expect(moved.x).toBeCloseTo(start.x + 400, 0);
  expect(moved.y).toBeCloseTo(start.y - 200, 0);
  const grip = (await page.getByRole('button', { name: 'Resize chat window', exact: true }).boundingBox())!;
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 168, grip.y + 88, { steps: 8 });
  await page.mouse.up();
  const resized = (await chat.boundingBox())!;
  expect(resized.width).toBeCloseTo(moved.width + 160, 0);
  expect(resized.height).toBeCloseTo(moved.height + 80, 0);
  await page.reload();
  await expect.poll(async () => (await chat.boundingBox())!.width).toBeCloseTo(resized.width, 0);
  expect((await chat.boundingBox())!.x).toBeCloseTo(resized.x, 0);
  await page.locator('#chat-minimize').click();
  await expect(page.getByRole('button', { name: 'Resize chat window', exact: true })).toBeHidden();
  const atBottom = async () => {
    const bounds = (await chat.boundingBox())!, size = page.viewportSize()!;
    return Math.abs(size.height - (bounds.y + bounds.height) - 12) < 1 && Math.abs(bounds.x - 12) < 1;
  };
  await expect.poll(atBottom).toBe(true);
  await page.reload();
  await expect(chat).toHaveClass(/minimized/);
  await expect.poll(atBottom).toBe(true);
  await page.locator('#chat-min-pill').click();
  await expect(chat).not.toHaveClass(/minimized/);
  expect((await chat.boundingBox())!.width).toBeCloseTo(resized.width, 0);
  expect((await chat.boundingBox())!.x).toBeCloseTo(resized.x, 0);
  expect((await chat.boundingBox())!.y).toBeCloseTo(resized.y, 0);
  await page.screenshot({ path: info.outputPath('resized-chat.png') });
});
