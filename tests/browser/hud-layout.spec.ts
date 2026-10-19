import { test, expect } from '@playwright/test';
import { openPanel, closePanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('space-sim.graphics/1', 'low');
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = new Proxy(original, { apply(target, receiver, args) {
      return String(args[0]).startsWith('webgl') ? null : Reflect.apply(target, receiver, args);
    } });
  });
});

test('default HUD and rendered navball fit the dock, chat and telemetry at desktop and phone sizes', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await closePanel(page);
  for (const size of [{ width: 1366, height: 622 }, { width: 800, height: 600 }, { width: 375, height: 812 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    await expect.poll(async () => page.evaluate(() => {
      const d = JSON.parse(document.getElementById('debug')!.textContent || '{}').hud?.navballs[0];
      if (!d || d.width !== innerWidth || d.height !== innerHeight) return false;
      const dial = { left: d.x - 79 * d.scale, right: d.x + 79 * d.scale, top: d.y - 79 * d.scale, bottom: d.y + 70.5 * d.scale + 52 };
      const elements = [...document.querySelectorAll<HTMLElement>('.hud-dock,.hud-top-left,.hud-quickbar,.view-time,.telemetry,#chat-overlay,#flight-message')];
      return elements.every(el => {
        const r = el.getBoundingClientRect();
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1
          && (dial.right <= r.left || dial.left >= r.right || dial.bottom <= r.top || dial.top >= r.bottom);
      });
    })).toBe(true);
    // The stored geometry is the visible, interactive dial: click its vector pin.
    await expect.poll(() => page.locator('#flight-view').evaluate(el => {
      const d = JSON.parse(document.getElementById('debug')!.textContent!).hud.navballs[0];
      const at = { x: d.x + 67 * d.scale * .72, y: d.y - 67 * d.scale * .72 };
      const canvas = el as HTMLCanvasElement;
      const rgb = canvas.getContext('2d')!.getImageData(Math.round(at.x * canvas.width / canvas.clientWidth), Math.round(at.y * canvas.height / canvas.clientHeight), 1, 1).data;
      return Math.max(...[56, 239, 125].map((value, i) => Math.abs(value - rgb[i]!)));
    })).toBeLessThanOrEqual(2);
    await page.screenshot({ path: info.outputPath(`hud-${size.width}.png`) });
  }
  expect(errors).toEqual([]);
});

test('HUD move handles save independent positions, survive resize/reload, and reset', async ({ page }, info) => {
  await page.goto('/'); await openPanel(page, 'settings');
  await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  await expect(page.locator('.hud-layout-toolbar')).toBeVisible();
  const fingerprint = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint);
  const status = page.locator('.hud-top-left'), before = (await status.boundingBox())!;
  const handle = page.getByRole('button', { name: 'Move status', exact: true });
  const at = (await handle.boundingBox())!;
  await page.mouse.move(at.x + 15, at.y + 8); await page.mouse.down();
  await page.mouse.move(at.x + 95, at.y + 88, { steps: 5 }); await page.mouse.up();
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(before.x + 80, 0);
  for (const label of ['flight controls', 'clock', 'dock', 'flight readings', 'flight hint']) {
    const move = page.getByRole('button', { name: `Move ${label}`, exact: true });
    await move.focus(); await page.keyboard.press('Shift+ArrowLeft');
    await page.keyboard.press('ArrowDown');
  }
  await page.screenshot({ path: info.outputPath('hud-editing.png') });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const moved = (await status.boundingBox())!;
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:hud-layout:1')!));
  expect(Object.keys(saved).sort()).toEqual(['clock', 'controls', 'dock', 'message', 'status', 'telemetry']);
  await page.reload();
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  expect((await status.boundingBox())!.y).toBeCloseTo(moved.y, 0);
  await expect(page.locator('.hud-layout-toolbar')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 500 });
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hud-movable')]
    .filter(e => e.getClientRects().length > 0).every(e => {
      const r = e.getBoundingClientRect();
      return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }))).toBe(true);
  await page.setViewportSize({ width: 1280, height: 720 });
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  const bottomHandle = (await handle.boundingBox())!;
  await page.mouse.move(bottomHandle.x + 10, bottomHandle.y + 5); await page.mouse.down();
  await page.mouse.move(bottomHandle.x + 10, 715, { steps: 5 }); await page.mouse.up();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.hud-movable')]
    .filter(e => e.getClientRects().length > 0).every(e => {
      const r = e.getBoundingClientRect();
      return r.top >= -1 && r.bottom <= innerHeight + 1;
    }))).toBe(true);
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Reset HUD layout', exact: true }).click();
  await closePanel(page);
  await expect.poll(async () => (await status.boundingBox())!.x).toBeCloseTo(12, 0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:hud-layout:1')!))).toEqual({});
  expect(await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint)).toBe(fingerprint);
  await page.screenshot({ path: info.outputPath('hud-reset.png') });
});

test('touch controls leave room for chat, telemetry and a movable navball', async ({ page }, info) => {
  await page.addInitScript(() => localStorage.setItem('space-sim:touch-controls:v1', 'always'));
  await page.setViewportSize({ width: 375, height: 812 }); await page.goto('/'); await closePanel(page);
  await expect(page.locator('#touch-overlay')).toBeVisible();
  await expect.poll(async () => page.evaluate(() => {
    const controls = [...document.querySelectorAll('.touch-stick-zone,.touch-actions-zone')].map(el => el.getBoundingClientRect());
    const readouts = [...document.querySelectorAll('#chat-overlay,.telemetry')].map(el => el.getBoundingClientRect());
    return readouts.every(r => controls.every(c => r.bottom + 4 <= c.top || r.right <= c.left || r.left >= c.right));
  })).toBe(true);
  await page.screenshot({ path: info.outputPath('hud-touch.png') });
});

test('touch controls can be disabled through the dock after enabling and reloading', async ({ page }, info) => {
  await page.goto('/');
  const settings = page.locator('[data-workspace="settings"]');
  const touch = page.locator('#hud-visible-touch');
  for (const size of [{ width: 1366, height: 606 }, { width: 800, height: 600 }, { width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size);
    // Real pointer clicks: openPanel bypasses hit testing and would miss an obstructed dock.
    await settings.click();
    await touch.check();
    await page.locator('#settings-window [data-window-close]').click();
    await expect(page.locator('#touch-overlay')).toBeVisible();
    await page.reload();
    await expect.poll(() => page.evaluate(() => {
      const dock = document.querySelector('.hud-dock')!.getBoundingClientRect();
      const actions = document.querySelector('.touch-actions-zone')!.getBoundingClientRect();
      return actions.right + 8 <= dock.left || actions.left >= dock.right + 8
        || actions.bottom + 8 <= dock.top || actions.top >= dock.bottom + 8;
    })).toBe(true);
    await settings.click({ timeout: 5000 });
    await expect(touch).toBeChecked();
    await touch.uncheck();
    await expect(page.locator('#touch-overlay')).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('space-sim:touch-controls:v1'))).toBe('never');
    await page.locator('#settings-window [data-window-close]').click();
  }
  await page.reload();
  await expect(page.locator('#touch-overlay')).toBeHidden();
  await page.screenshot({ path: info.outputPath('touch-disabled.png') });
});

test('edit mode moves the default pinned navball directly and preserves its pin preference', async ({ page }) => {
  await page.goto('/');
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  const handle = page.getByRole('button', { name: 'Move status', exact: true });
  await expect(handle.locator('svg')).toBeVisible();
  await expect(handle).toHaveText('');
  expect((await handle.boundingBox())!.width).toBeLessThanOrEqual(32);
  const before = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0]);
  await page.mouse.move(before.x, before.y); await page.mouse.down();
  await page.mouse.move(before.x - 120, before.y - 70, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:local-players:v1')!).slots[0].navball.anchor)).toBe('custom');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('space-sim:local-players:v1')!).slots[0].navball.pinned)).toBe(true);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect.poll(async () => (await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0])).x).toBeCloseTo(before.x - 120, 0);
  await page.reload();
  await expect.poll(async () => (await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0])).x).toBeCloseTo(before.x - 120, 0);
  await expect(page.locator('#status')).toHaveText('LANDED');
});

test('throttle and navball move independently, retain positions on reload and reset through the HUD tool', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'settings');
  await page.getByRole('button', { name: 'Edit HUD layout', exact: true }).click();
  const lever = page.locator('.throttle-lever[data-slot="0"]');
  const before = (await lever.boundingBox())!;
  const navball = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0]);
  const grip = page.getByRole('button', { name: 'Move Player 1 throttle', exact: true });
  await grip.focus(); await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(async () => (await lever.boundingBox())!.x).toBeCloseTo(before.x - 32, 0);
  await expect.poll(() => page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0].x)).toBeCloseTo(navball.x, 0);
  const moved = (await lever.boundingBox())!;
  await page.mouse.move(navball.x, navball.y); await page.mouse.down();
  await page.mouse.move(navball.x - 100, navball.y - 60, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).hud.navballs[0].x)).toBeCloseTo(navball.x - 100, 0);
  await expect.poll(async () => (await lever.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload(); await closePanel(page);
  await expect.poll(async () => (await lever.boundingBox())!.x).toBeCloseTo(moved.x, 0);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'settings'); await page.getByRole('button', { name: 'Reset HUD layout', exact: true }).click(); await closePanel(page);
  await expect.poll(async () => (await lever.boundingBox())!.x).toBeCloseTo(before.x, 0);
});

test('HUD switches persist, leave the dock reachable, and restore existing instrument controls', async ({ page }, info) => {
  await page.goto('/');
  const fingerprint = await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint);
  await openPanel(page, 'settings');
  for (const id of ['status', 'controls', 'clock', 'telemetry', 'message', 'terrain', 'throw', 'players', 'chat', 'scale', 'labels', 'navball']) {
    await page.locator(`#hud-visible-${id}`).uncheck();
  }
  await page.locator('#hud-visible-touch').check();
  await expect(page.locator('#touch-overlay')).toBeVisible();
  await page.locator('#hud-visible-touch').uncheck();
  await page.locator('#hud-visible-profiler').check();
  await expect(page.locator('#profiler')).toBeVisible();
  await page.locator('#hud-visible-profiler').uncheck();
  await closePanel(page);
  for (const selector of ['.hud-top-left', '.hud-quickbar', '.view-time.hud-movable', '.telemetry.hud-movable', '#flight-message', '#terrain-notice', '#chat-overlay', '#touch-overlay', '#profiler']) {
    await expect(page.locator(selector)).toBeHidden();
  }
  await expect(page.getByRole('navigation', { name: 'Windows', exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('minimal-hud.png') });
  await page.reload(); await openPanel(page, 'settings');
  for (const id of ['status', 'controls', 'clock', 'telemetry', 'message', 'terrain', 'throw', 'players', 'chat', 'scale', 'labels', 'navball', 'touch', 'profiler']) {
    await expect(page.locator(`#hud-visible-${id}`)).not.toBeChecked();
  }
  // Instruments and Settings operate on the same navball choice.
  await openPanel(page, 'data');
  const navball = page.locator('#instruments').getByRole('button', { name: 'Navball', exact: true });
  await expect(navball).toHaveAttribute('aria-pressed', 'false'); await navball.click();
  await openPanel(page, 'settings'); await expect(page.locator('#hud-visible-navball')).toBeChecked();
  await page.getByRole('button', { name: 'Restore HUD visibility', exact: true }).click();
  await closePanel(page);
  for (const selector of ['.hud-top-left', '.hud-quickbar', '.view-time.hud-movable', '.telemetry.hud-movable', '#flight-message', '#chat-overlay']) {
    await expect(page.locator(selector)).toBeVisible();
  }
  expect(await page.locator('#debug').evaluate(el => JSON.parse(el.textContent!).fingerprint)).toBe(fingerprint);
  // An explicit dock/keyboard action can reopen chat after it was hidden.
  await openPanel(page, 'settings'); await page.locator('#hud-visible-chat').uncheck(); await closePanel(page);
  await page.locator('#flight-view').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#chat-input')).toBeVisible();
});

test('scale, ship and planet label switches remove actual Canvas annotations and persist independently', async ({ page }) => {
  await page.addInitScript(() => {
    const state = window as unknown as { hudAnnotationTexts: string[] };
    state.hudAnnotationTexts = [];
    const transform = CanvasRenderingContext2D.prototype.setTransform;
    CanvasRenderingContext2D.prototype.setTransform = new Proxy(transform, { apply(target, receiver, args) {
      if ((receiver as CanvasRenderingContext2D).canvas.id === 'flight-view') state.hudAnnotationTexts = [];
      return Reflect.apply(target, receiver, args);
    } });
    const text = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = new Proxy(text, { apply(target, receiver, args) {
      if ((receiver as CanvasRenderingContext2D).canvas.id === 'flight-view') state.hudAnnotationTexts.push(String(args[0]));
      return Reflect.apply(target, receiver, args);
    } });
  });
  await page.goto('/');
  await page.locator('#camera').click();
  const annotations = () => page.evaluate(() => {
    const texts = (window as unknown as { hudAnnotationTexts: string[] }).hudAnnotationTexts;
    return { ship: texts.some(text => text.startsWith('VESSEL')), scale: texts.some(text => /^\d+ m$/.test(text)), planet: texts.includes('PRIMUS') };
  });
  await expect.poll(annotations).toEqual({ ship: true, scale: true, planet: true });
  await openPanel(page, 'settings');
  await page.locator('#hud-visible-orbits').uncheck();
  await expect(page.locator('#hud-visible-planets')).toBeChecked();
  await page.locator('#hud-visible-planets').uncheck();
  await expect.poll(annotations).toEqual({ ship: true, scale: true, planet: false });
  await page.locator('#hud-visible-labels').uncheck(); await page.locator('#hud-visible-scale').uncheck();
  await expect.poll(annotations).toEqual({ ship: false, scale: false, planet: false });
  await page.reload(); await openPanel(page, 'settings');
  await expect(page.locator('#hud-visible-planets')).not.toBeChecked();
  await expect(page.locator('#hud-visible-orbits')).not.toBeChecked();
  await page.getByRole('button', { name: 'Restore HUD visibility', exact: true }).click();
  await expect(page.locator('#hud-visible-planets')).toBeChecked();
  await expect(page.locator('#hud-visible-orbits')).toBeChecked();
});

test('camera rotation buttons turn the view without turning the ship, and reset to north up', async ({ page }) => {
  await page.goto('/'); await closePanel(page);
  await page.locator('#pause').click(); await page.locator('#camera').click();
  const debug = () => page.locator('#debug').evaluate(el => JSON.parse(el.textContent!));
  await expect.poll(async () => (await debug()).camera.rotation).toBe(0);
  const before = await debug();
  await page.getByRole('button', { name: 'Rotate camera left', exact: true }).click();
  await expect.poll(async () => (await debug()).camera.rotation).toBeCloseTo(-Math.PI / 12, 4);
  await page.getByRole('button', { name: 'Rotate camera right', exact: true }).click({ modifiers: ['Shift'] });
  await expect.poll(async () => (await debug()).camera.rotation).toBeCloseTo(-14 * Math.PI / 180, 4);
  const after = await debug();
  expect(after.tick).toBe(before.tick); expect(after.heading).toBe(before.heading); expect(after.velocity).toEqual(before.velocity);
  await page.getByRole('button', { name: 'Reset camera to north up', exact: true }).click();
  await expect.poll(async () => (await debug()).camera.rotation).toBe(0);
});
