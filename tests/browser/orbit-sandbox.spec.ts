import { test, expect } from '@playwright/test';
import { useCanvas } from '../helpers/canvas';
import { openPanel } from '../helpers/workspace';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('Figure-8 scenario retains three separated bodies through accelerated live simulation', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.clock.install({ time: 0 });
  await page.goto('/?game=orbit-sandbox');
  await expect(page.locator('#btn-play-pause')).toHaveText('Pause');
  await page.clock.pauseAt(10000);
  await page.locator('#btn-play-pause').click();
  await page.locator('#btn-testing-open').click();
  await page.locator('.scenario-card').filter({ has: page.getByRole('heading', { name: 'Figure-8 3-Body Choreography', exact: true }) }).click();
  await expect(page.locator('#mode-nbody')).toHaveClass(/active/);
  await page.locator('#sandbox-warp-factor').selectOption('50');
  await page.locator('#btn-play-pause').click();
  // 400 simulated seconds exceeds the preset's 316.3 s canonical cycle.
  await page.clock.runFor(8000);
  await page.locator('#btn-play-pause').click();
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('50');
  await page.locator('#btn-export-open').click();
  await expect(page.locator('#export-summary')).toContainText('3 Bodies');
  const downloaded = page.waitForEvent('download');
  await page.locator('#btn-download-json').click();
  const download = await downloaded;
  const universe = JSON.parse(await readFile((await download.path())!, 'utf8'));
  const bodies = universe.systems[0].bodies;
  expect(bodies.map((body: { id: string }) => body.id).sort()).toEqual(['moore-1', 'moore-2', 'moore-3']);
  for (let i = 0; i < bodies.length; i++) {
    const position = bodies[i].ephemeris.position as [number, number];
    expect(Math.hypot(...position)).toBeLessThan(10000);
    for (let j = i + 1; j < bodies.length; j++) {
      const other = bodies[j].ephemeris.position as [number, number];
      expect(Math.hypot(position[0] - other[0], position[1] - other[1])).toBeGreaterThan(bodies[i].radius + bodies[j].radius);
    }
  }
  expect(errors).toEqual([]);
});

test('sandbox warp and pause shortcuts stay in the active game and titles follow the loaded game', async ({ page }) => {
  test.setTimeout(60000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/?game=orbit-sandbox');
  await expect(page).toHaveTitle('Spacelab · Orbit Sandbox');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('1');
  await page.locator('#sandbox-warp-reset').click();
  await page.keyboard.press('BracketRight');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('2');
  await page.keyboard.press('Period');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('3');
  await page.keyboard.press('Comma');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('2');
  await page.keyboard.press('Slash');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('1');
  await page.keyboard.press('KeyP');
  await expect(page.locator('#btn-play-pause')).toHaveText('Resume');
  await expect(page.locator('#btn-play-pause')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await page.locator('#orbit-canvas').focus();
  await page.keyboard.press('Space');
  await expect(page.locator('#btn-play-pause')).toHaveText('Pause');
  await page.locator('#btn-play-pause').click();
  // Paused selection can reach the maximum without triggering automatic CPU reduction.
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#sandbox-warp-up').isDisabled()) break;
    await page.locator('#sandbox-warp-up').click();
  }
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('100000');
  await expect(page.locator('#sandbox-warp-up')).toBeDisabled();
  await page.locator('#sandbox-warp-factor').selectOption('0.2');
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('0.2');
  await expect(page.locator('#sandbox-warp-down')).toBeDisabled();
  await page.locator('#sandbox-warp-reset').click();
  await page.locator('#btn-testing-open').click();
  await page.locator('#sandbox-disable-limiter').check();
  await expect(page.locator('#sandbox-warp-status')).toHaveText('CPU limiter off (debug)');
  await page.locator('#btn-close-testing').click();
  await expect(page.locator('#btn-toggle-orbits')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#btn-toggle-orbits').click();
  await expect(page.locator('#btn-toggle-orbits')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#sandbox-labels').click();
  await expect(page.locator('#sandbox-labels')).toHaveAttribute('aria-pressed', 'false');
  await page.reload();
  await expect(page.locator('#sandbox-disable-limiter')).not.toBeChecked();
  await expect(page.locator('#btn-toggle-orbits')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#btn-reset').click();
  await expect(page.locator('#btn-toggle-orbits')).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('KeyO');
  await expect(page.locator('#btn-toggle-orbits')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sandbox-labels')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#btn-sandbox-menu').click();
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Space Sim', exact: true }) })
    .getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page).toHaveTitle('Spacelab · Space Sim');
  await expect(page.locator('#orbit-sandbox-workspace')).toBeHidden();
  await expect(page.locator('#flight-console #pause')).toHaveText('Pause');
  expect(errors).toEqual([]);
});

test('sustained CPU overload warns and reduces sandbox warp automatically', async ({ page }) => {
  await page.goto('/?game=orbit-sandbox');
  await page.locator('#btn-play-pause').click();
  for (let i = 0; i < 20; i++) {
    if (await page.locator('#sandbox-warp-up').isDisabled()) break;
    await page.locator('#sandbox-warp-up').click();
  }
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('100000');
  await page.locator('#btn-play-pause').click();
  await expect.poll(async () => Number(await page.locator('#sandbox-warp-factor').inputValue()), { timeout: 15000 }).toBeLessThan(100000);
  await expect(page.locator('#sandbox-warp-status')).toContainText('CPU limited');
  await expect(page.locator('#sandbox-disable-limiter')).not.toBeChecked();
});

test('new-world play, R and Reset restore the default system and Sandbox dock opens its own tools', async ({ page }) => {
  await page.goto('/?game=orbit-sandbox');
  const dock = page.getByRole('navigation', { name: 'Orbit Sandbox tools' });
  await expect(dock).toBeVisible();
  await dock.getByRole('button', { name: 'Manual', exact: true }).click();
  await expect(page.locator('#manual-window')).toBeVisible();
  await page.locator('#manual-search').fill('Orbit Sandbox');
  await page.locator('#manual-close').click();
  await dock.getByRole('button', { name: 'Physics', exact: true }).click();
  await expect(page.locator('#modal-fullbody')).toBeVisible();
  await page.locator('#btn-close-fullbody').click();
  await page.locator('#btn-play-pause').click();
  const canvas = (await page.locator('#orbit-canvas').boundingBox())!;
  const star = { x: canvas.width / 2 - 90, y: canvas.height / 2 };
  await page.locator('#orbit-canvas').click({ position: star });
  await page.locator('#inp-body-name').fill('Changed star');
  await page.locator('#sandbox-inspector-close').click();
  await page.locator('#sandbox-warp-factor').selectOption('50');
  await page.locator('#mode-kepler').click();
  await dock.getByRole('button', { name: 'Load Game', exact: true }).click();
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Orbit Sandbox', exact: true }) }).getByRole('button', { name: 'Play · new world', exact: true }).click();
  await expect(page.locator('#sandbox-warp-factor')).toHaveValue('1');
  await expect(page.locator('#btn-play-pause')).toHaveText('Pause');
  await expect(page.locator('#mode-fullbody')).toHaveClass(/active/);
  await page.locator('#orbit-canvas').click({ position: star });
  await expect(page.locator('#inp-body-name')).toHaveValue('Lumen (Star)');
  await page.locator('#inp-body-name').fill('Keyboard reset');
  await page.locator('#sandbox-inspector-close').click();
  await page.keyboard.press('KeyR');
  await page.locator('#orbit-canvas').click({ position: star });
  await expect(page.locator('#inp-body-name')).toHaveValue('Lumen (Star)');
  await page.locator('#inp-body-name').fill('Button reset');
  await page.locator('#btn-reset').click();
  await page.locator('#orbit-canvas').click({ position: star });
  await expect(page.locator('#inp-body-name')).toHaveValue('Lumen (Star)');
});

test('sandbox planet inspector uses shared window controls and palette fits a phone', async ({ page }, info) => {
  await page.goto('/?game=orbit-sandbox');
  await page.locator('#btn-play-pause').click();
  // The fixed star is at the world origin, 90 screen pixels left of the initial view center.
  const canvas = (await page.locator('#orbit-canvas').boundingBox())!;
  await page.locator('#orbit-canvas').click({ position: { x: canvas.width / 2 - 90, y: canvas.height / 2 } });
  await expect(page.locator('#sandbox-inspector-window')).toBeVisible();
  await expect(page.locator('#inp-body-name')).toBeVisible();
  await page.locator('#sandbox-inspector-maximize').click();
  await expect(page.locator('#sandbox-inspector-window')).toHaveClass(/maximized/);
  await page.locator('#sandbox-inspector-maximize').click();
  await page.locator('#sandbox-inspector-minimize').click();
  await expect(page.locator('#inp-body-name')).toBeHidden();
  await page.locator('#sandbox-inspector-minimize').click();
  await page.locator('#orbit-canvas').focus(); await page.keyboard.press('Escape');
  await expect(page.locator('#sandbox-inspector-window')).toBeHidden();
  await expect(page.locator('#library-window')).toBeHidden();
  await page.setViewportSize({ width: 390, height: 844 });
  for (const selector of ['.sandbox-header', '.palette-container', '#sandbox-warp-up']) {
    const box = (await page.locator(selector).boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(390);
  }
  await page.locator('.palette-card').last().focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.palette-card').last()).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('sandbox-phone.png') });
  await openPanel(page, 'library');
  await expect(page.locator('#library-window')).toBeVisible();
});
