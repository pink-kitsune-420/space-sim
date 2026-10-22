import { waitForWorldReady } from '../helpers/loading';
import { test, expect } from '@playwright/test';
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
const debug = async (page: import('@playwright/test').Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');
for (const fallback of [false, true]) for (const [preset, body] of [['pad', 'planet'], ['parvus-pad', 'moon']]) {
  test(`${fallback ? 'actual no-WebGL Canvas' : 'WebGL'} ${body} overview to remote selected circumference and back`, async ({ page }, info) => {
    test.setTimeout(120000); await page.setViewportSize({ width: 1280, height: 900 });
    if (fallback) await useCanvas(page); else await useLowGraphics(page);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?game=space-sim-successor&planetPreview=0&successorAir=clouds&successorLocalDelay=4000'); await waitForWorldReady(page);
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
    await expect.poll(async () => { const s = (await debug(page)).successorTiles; return [s.pending, s.residentChunks]; }).toEqual([true, 0]);
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
    await expect.poll(async () => { const s = (await debug(page)).successorTiles; return [s.residentChunks, s.fineRequests]; }).toEqual([0, 0]);
    await page.screenshot({ path: `private-docs/proposals/games/evidence/successor-orbital-material-lod/${info.project.name}-${fallback ? 'Canvas' : 'WebGL'}-${body}-overview.png` });
    expect(errors).toEqual([]);
  });
}

for (const fallback of [false, true]) test(`${fallback ? 'Canvas single view preserves saved split settings' : 'WebGL independent simultaneous overview and local cameras'}`, async ({ page }, info) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 1280, height: 900 });
  if (fallback) await useCanvas(page); else await useLowGraphics(page);
  if (fallback) await page.addInitScript(() => localStorage.setItem('space-sim:local-players:v1', JSON.stringify({ count: 4, screenMode: 'split' })));
  await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page); await expect(page.locator('#status')).toHaveText('LANDED');
  if (fallback) {
    const saved = await page.evaluate(() => localStorage.getItem('space-sim:local-players:v1'));
    await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(1);
    await expect(page.locator('.split-pane')).toHaveCount(0);
    await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
    await expect(page.locator('.split-count [data-count="2"]')).toBeDisabled();
    await expect(page.locator('#split-screen-mode')).toBeDisabled();
    await expect(page.locator('#split-players-note')).toContainText('One local view');
    await page.locator('#controls-close').click(); await closePanel(page);
    await page.locator('#camera').click();
    await expect.poll(async () => (await debug(page)).successorTiles.fineRequests).toBe(0);
    expect((await debug(page)).successorGuestTiles).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem('space-sim:local-players:v1'))).toBe(saved);
    return;
  }
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
  await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page); await expect(page.locator('#status')).toHaveText('LANDED');
  await page.locator('#camera').click(); await page.locator('#flight-view').focus(); await page.keyboard.press('KeyN');
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

test('successor Canvas suspends split views and WebGL and Classic restore the saved seats', async ({ page }) => {
  test.setTimeout(120000); await useLowGraphics(page);
  await page.goto('/?game=space-sim-successor&planetPreview=0'); await waitForWorldReady(page); await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'settings'); await page.locator('#players-toggle').click();
  await page.locator('.split-count [data-count="2"]').click();
  await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(2);
  await page.locator('#controls-close').click();
  const saved = await page.evaluate(() => localStorage.getItem('space-sim:local-players:v1'));
  await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await debug(page)).renderer).toBe('builtin.canvas');
  await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(1);
  await expect(page.locator('.split-pane')).toHaveCount(0);
  expect((await debug(page)).successorGuestTiles).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('space-sim:local-players:v1'))).toBe(saved);
  await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await debug(page)).renderer).toBe('builtin.webgl');
  await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(2);
  await page.locator('#players-toggle').click();
  await expect(page.locator('.split-count [data-count="2"]')).toBeEnabled();
  await page.locator('#controls-close').click();
  await page.locator('#renderer-toggle').click();
  await page.goto('/'); await waitForWorldReady(page); await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'settings'); await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await debug(page)).renderer).toBe('builtin.canvas');
  await expect.poll(async () => (await debug(page)).localPlayers.count).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('space-sim:local-players:v1'))).toBe(saved);
});
