import { test, expect, type Page } from '@playwright/test';
import { generateSurface, querySurface, validateSurfaceDefinition } from '../../packages/sim-core/src/surface';
import game from '../../games/space-sim-successor/game.json' with { type: 'json' };
import { useCanvas, useLowGraphics } from '../helpers/canvas';
import { openPanel, closePanel } from '../helpers/workspace';
import type { Vec } from '../../packages/game-api/src/index';

const debug = async (page: Page) => JSON.parse(await page.locator('#debug').textContent() || '{}');
/** Exercise the real pointer drag handler, including very long offscreen captured
 * drags, without velocity/fling noise. No private host state is exposed or changed. */
async function panTo(page: Page, target: Vec) {
  const camera = (await debug(page)).camera;
  await page.locator('#flight-view').evaluate((canvas, { camera, target }) => {
    const rect = canvas.getBoundingClientRect(), x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const dx = target.x - camera.center.x, dy = target.y - camera.center.y;
    const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation);
    const moveX = (-dx * c + dy * s) * camera.scale, moveY = (dx * s + dy * c) * camera.scale;
    const init = { pointerId: 37, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, bubbles: true };
    canvas.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: x, clientY: y }));
    canvas.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: x + moveX, clientY: y + moveY }));
    canvas.dispatchEvent(new PointerEvent('pointercancel', { ...init, clientX: x + moveX, clientY: y + moveY, buttons: 0 }));
  }, { camera, target });
  await expect.poll(async () => {
    const c = (await debug(page)).camera.center; return Math.hypot(c.x - target.x, c.y - target.y);
  }).toBeLessThan(.01);
}

for (const fallback of [false, true]) for (const id of ['planet', 'moon'] as const) {
  test(`${fallback ? 'native Canvas' : 'WebGL'} camera streams ${id} beyond the old patch and cancels stale demand`, async ({ page }, info) => {
    test.setTimeout(120000); await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setViewportSize(fallback ? { width: 1000, height: 760 } : { width: 640, height: 480 });
    if (fallback) await useCanvas(page); else await useLowGraphics(page);
    const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('/?game=space-sim-successor&successorLocalDelay=4000');
    await expect(page.locator('#status')).toHaveText('LANDED');
    await openPanel(page, 'setup'); await page.locator('#preset').selectOption(id === 'planet' ? 'pad' : 'parvus-pad'); await closePanel(page);
    await page.evaluate(() => document.querySelector<HTMLButtonElement>('#pause')!.click());
    await expect(page.locator('#status')).toHaveText('PAUSED');
    await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks, { timeout: 15000 }).toBeGreaterThan(0);
    const initial = await debug(page);
    const body = game.bundle.modules[0]!.data.universes[0]!.definition.systems.find(s => s.id === initial.system)!.bodies.find(b => b.id === id)!;
    const p = generateSurface({ radius: body.radius, surface: validateSurfaceDefinition('surface' in body ? body.surface : undefined, body.radius) });
    const pad = p.pads.find(p => p.id === 'landing-area')!;
    const spin = 'rotation' in body ? body.rotation.direction * 2 * Math.PI * (initial.time / body.rotation.period % 1) : 0;
    // The paused pad camera follows the body-fixed ship; infer only its world origin
    // from that independently checked state, then query canonical remote ground.
    const origin = { x: initial.camera.center.x - initial.position.x * Math.cos(spin) + initial.position.y * Math.sin(spin),
      y: initial.camera.center.y - initial.position.x * Math.sin(spin) - initial.position.y * Math.cos(spin) };
      const remote = (arc: number) => {
        const angle = pad.angleRadians + arc / p.referenceRadius, r = querySurface(p, angle).groundRadius;
        return { angle, point: { x: origin.x + r * Math.cos(angle + spin), y: origin.y + r * Math.sin(angle + spin) } };
      };
      const first = remote(-680), second = remote(730);
      await panTo(page, first.point);
      await expect.poll(async () => { const d = (await debug(page)).successorTiles; return [d.pending, d.visibleChunks]; }).toEqual([true, 0]);
      await panTo(page, second.point); // Retire the previous target before its readiness delay finishes.
      await expect.poll(async () => (await debug(page)).successorTiles.pending).toBe(true);
      await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks, { timeout: 15000 }).toBeGreaterThan(0);
      const ready = await debug(page);
      expect(ready.position).toEqual(initial.position); expect(ready.velocity).toEqual(initial.velocity); expect(ready.tick).toBe(initial.tick);
      expect(Math.abs(ready.successorTiles.cameraAngle - second.angle)).toBeLessThan(1e-4);
      expect(ready.successorTileStore.queuedSectors).toBe(0);
      expect(ready.successorTileStore.bufferBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(ready.successorTiles.bufferBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
      expect(ready.successorTiles.visibleChunks).toBeLessThanOrEqual(200);
      await page.locator('#camera-rotate-right').click(); await page.locator('#camera-rotate-right').click();
      await page.setViewportSize({ width: 1200, height: 850 });
      await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks, { timeout: 15000 }).toBeGreaterThan(0);
      await page.screenshot({ path: info.outputPath(`${id}-remote-rotated.png`) });
      // A body-centred distant view releases the final lease and all reusable typed buffers.
      await openPanel(page, 'setup'); await page.locator('#successor-return-overview').click(); await closePanel(page);
      await expect.poll(async () => (await debug(page)).successorTiles.fineRequests).toBe(0);
      await expect.poll(async () => (await debug(page)).successorTileStore.bufferBytes).toBe(0);
      expect((await debug(page)).successorTileStore.leases).toBe(0);
      expect(errors).toEqual([]);
  });
}

test('WebGL shares CPU sectors across four local cameras and releases the last consumer on provider change', async ({ page }) => {
  test.setTimeout(180000); await page.setViewportSize({ width: 800, height: 600 }); await useLowGraphics(page);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => localStorage.setItem('space-sim:local-players:v1', JSON.stringify({ count: 4, screenMode: 'split' })));
  await page.goto('/?game=space-sim-successor'); await expect(page.locator('#status')).toHaveText('LANDED');
  await expect.poll(async () => (await debug(page)).localPlayers.count, { timeout: 30000 }).toBe(4);
  await expect.poll(async () => (await debug(page)).successorGuestTiles.filter((v: { visibleChunks: number }) => v.visibleChunks > 0).length, { timeout: 30000 }).toBe(3);
  const all = await debug(page), views = [all.successorTiles, ...all.successorGuestTiles];
  expect(all.successorTileStore.residentChunks).toBeLessThan(views.reduce((n: number, v: { residentChunks: number }) => n + v.residentChunks, 0));
  expect(all.successorTileStore.leases).toBeGreaterThanOrEqual(4);
  expect(all.successorTileStore.queuedSectors).toBe(0);
  expect(all.successorTileStore.bufferBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  await page.locator('#camera').click(); // Main overview; other cameras keep their shared content.
  // The baseline headless WebKit/DPR2 probe shows >9s gaps between
  // rendered frames with four contexts. Wait for settled ownership, not an FPS claim.
  await expect.poll(async () => (await debug(page)).successorTiles.bufferBytes, { timeout: 30000 }).toBe(0);
  const mixed = await debug(page);
  expect(mixed.successorGuestTiles.every((v: { visibleChunks: number }) => v.visibleChunks > 0)).toBe(true);
  expect(mixed.successorTileStore.bufferBytes).toBeGreaterThan(0);
  await openPanel(page, 'settings'); await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await debug(page)).renderer, { timeout: 30000 }).toBe('builtin.canvas');
  await expect.poll(async () => (await debug(page)).localPlayers.count, { timeout: 30000 }).toBe(1);
  await expect.poll(async () => (await debug(page)).successorTileStore.bufferBytes, { timeout: 30000 }).toBe(0);
  expect((await debug(page)).successorTileStore.leases).toBe(0);
  await page.locator('#renderer-toggle').click();
  await expect.poll(async () => (await debug(page)).renderer, { timeout: 30000 }).toBe('builtin.webgl');
  await expect.poll(async () => (await debug(page)).localPlayers.count, { timeout: 30000 }).toBe(4);
  await expect.poll(async () => (await debug(page)).successorGuestTiles.filter((v: { visibleChunks: number }) => v.visibleChunks > 0).length, { timeout: 30000 }).toBe(3);
  expect(errors).toEqual([]);
});

for (const fallback of [false, true]) test(`${fallback ? 'native Canvas' : 'WebGL'} terrain demand stays off-actor while the ship flies`, async ({ page }) => {
  test.setTimeout(120000); await page.setViewportSize({ width: 640, height: 480 }); await page.emulateMedia({ reducedMotion: 'reduce' });
  if (fallback) await useCanvas(page); else await useLowGraphics(page);
  await page.goto('/?game=space-sim-successor'); await expect(page.locator('#status')).toHaveText('LANDED');
  // LANDED can precede the first periodic diagnostics publication.
  await expect.poll(async () => (await debug(page)).successorTiles?.visibleChunks ?? 0).toBeGreaterThan(0);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#pause')!.click());
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.waitForTimeout(400); // Allow the periodic diagnostics to publish the paused epoch.
  const initial = await debug(page);
  // Moving the camera 80m east puts the vessel well offscreen while retaining local ground.
  await panTo(page, { x: initial.camera.center.x + 80, y: initial.camera.center.y });
  await expect.poll(async () => (await debug(page)).successorTiles.visibleChunks).toBeGreaterThan(0);
  const before = await debug(page);
  await page.evaluate(() => document.querySelector<HTMLButtonElement>('#pause')!.click());
  await page.locator('#flight-view').focus(); await page.keyboard.down('Space');
  await expect(page.locator('#status')).toHaveText('FLYING');
  await expect.poll(async () => {
    const d = await debug(page); return Math.hypot(d.position.x - before.position.x, d.position.y - before.position.y);
  }, { timeout: 15000 }).toBeGreaterThan(5);
  await page.keyboard.up('Space');
  const flying = await debug(page);
  expect(flying.camera.mode).toBe('free'); expect(flying.tick).toBeGreaterThan(before.tick);
  expect(flying.successorTiles.visibleChunks).toBeGreaterThan(0);
  expect(flying.successorTiles.cameraAngle).not.toBeCloseTo(Math.atan2(flying.position.y, flying.position.x), 3);
  expect(flying.successorTiles.bufferBytes).toBeLessThanOrEqual(2 * 1024 * 1024);
});
