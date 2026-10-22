import { test, expect } from '@playwright/test';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
const debug = async (page: import('@playwright/test').Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');
for (const fallback of [false, true]) for (const [preset, body] of [['pad', 'planet'], ['parvus-pad', 'moon']]) {
  test(`${fallback ? 'actual no-WebGL Canvas' : 'WebGL'} ${body} overview to remote selected circumference and back`, async ({ page }, info) => {
    test.setTimeout(120000); await page.setViewportSize({ width: 1280, height: 900 });
    if (fallback) await useCanvas(page); else await useLowGraphics(page);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?game=space-sim-successor&successorAir=clouds&successorLocalDelay=4000');
    await expect(page.locator('#status')).toHaveText('LANDED');
    await openPanel(page, 'setup'); await page.locator('#preset').selectOption(preset!); await closePanel(page);
    await page.locator('#camera').click();
    await expect.poll(async () => (await debug(page)).successorTiles.residentChunks).toBe(0);
    await expect.poll(async () => (await debug(page)).successorTiles.fineRequests).toBe(0);
    await expect.poll(async () => (await debug(page)).successorOverview.generatedBodies).toBe(2);
    const before = await debug(page); expect(before.successorTiles.fineRequests).toBe(0);
    const canvas = page.locator('#flight-view'), rect = (await canvas.boundingBox())!;
    await canvas.click({ position: { x: rect.width / 2 + 80, y: rect.height / 2 - 100 }, modifiers: ['Shift'] });
    await expect.poll(async () => (await debug(page)).successorFocus.body).toBe(body);
    const angle = (await debug(page)).successorFocus.angle;
    await openPanel(page, 'setup'); await page.locator('#successor-inspect').click();
    await expect.poll(async () => (await debug(page)).successorTiles.pending).toBe(true);
    expect((await debug(page)).successorTiles.residentChunks).toBe(0);
    await closePanel(page);
    // The harness deliberately holds readiness for four seconds.
    await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks, { timeout: 10000 }).toBeGreaterThan(0);
    const local = await debug(page);
    expect(local.successorFocus.angle).toBe(angle); expect(local.body).toBe(body); expect(local.groundClearance).toBeCloseTo(0, 6);
    expect(local.successorTiles.bufferBytes).toBeLessThan(2 * 1024 * 1024);
    expect(local.renderer).toBe(fallback ? 'builtin.canvas' : 'builtin.webgl');
    await page.screenshot({ path: `private-docs/proposals/games/evidence/successor-orbital-material-lod/${info.project.name}-${fallback ? 'Canvas' : 'WebGL'}-${body}-local.png` });
    await canvas.hover(); await page.mouse.wheel(0, -200); await page.waitForTimeout(300); // continuous zoom does not move the body-fixed selection
    expect((await debug(page)).successorFocus.angle).toBe(angle);
    await openPanel(page, 'setup'); await page.locator('#successor-return-overview').click(); await closePanel(page);
    await expect.poll(async () => (await debug(page)).successorTiles.residentChunks).toBe(0);
    expect((await debug(page)).successorTiles.fineRequests).toBe(0);
    await page.screenshot({ path: `private-docs/proposals/games/evidence/successor-orbital-material-lod/${info.project.name}-${fallback ? 'Canvas' : 'WebGL'}-${body}-overview.png` });
    expect(errors).toEqual([]);
  });
}

for (const fallback of [false, true]) test(`${fallback ? 'Canvas' : 'WebGL'} independent simultaneous overview and local cameras`, async ({ page }, info) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1280, height: 900 });
  if (fallback) await useCanvas(page); else await useLowGraphics(page);
  await page.goto('/?game=space-sim-successor'); await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click(); await page.locator('#split-screen-mode').selectOption('split');
  await page.locator('#controls-close').click(); await closePanel(page);
  await expect.poll(async () => (await debug(page)).successorGuestTiles?.[0]?.residentChunks).toBeGreaterThan(0);
  await page.locator('#camera').click();
  await expect.poll(async () => (await debug(page)).successorTiles.residentChunks).toBe(0);
  const d = await debug(page);
  expect(d.successorTiles.fineRequests).toBe(0); expect(d.successorGuestTiles[0].residentChunks).toBeGreaterThan(0);
  await page.screenshot({ path: `private-docs/proposals/games/evidence/successor-orbital-material-lod/${info.project.name}-${fallback ? 'Canvas' : 'WebGL'}-mixed.png` });
});

for (const fallback of [false, true]) test(`${fallback ? 'Canvas' : 'WebGL'} Parvus inspection leaves the ship on Primus`, async ({ page }) => {
  test.setTimeout(90000); if (fallback) await useCanvas(page); else await useLowGraphics(page);
  await page.goto('/?game=space-sim-successor'); await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#camera').click(); await page.keyboard.press('KeyN');
  await page.waitForTimeout(900);
  const box = (await page.locator('#flight-view').boundingBox())!;
  await page.locator('#flight-view').click({ position: { x: box.width / 2 + 70, y: box.height / 2 - 80 }, modifiers: ['Shift'] });
  await expect.poll(async () => (await debug(page)).successorFocus.body).toBe('moon');
  const angle = (await debug(page)).successorFocus.angle;
  await openPanel(page, 'setup'); await page.locator('#successor-inspect').click(); await closePanel(page);
  await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks).toBeGreaterThan(0);
  await page.locator('#camera-rotate-right').click(); await page.locator('#camera-rotate-right').click();
  await page.waitForTimeout(400); expect((await debug(page)).successorFocus.angle).toBe(angle);
  const d = await debug(page); expect(d.body).toBe('planet'); expect(d.groundClearance).toBeCloseTo(0, 6);
  expect(d.successorTiles.materialDomain).toContain('parvus');
});
