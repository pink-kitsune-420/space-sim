import { test, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { useCanvas } from '../helpers/canvas';
import { openPanel } from '../helpers/workspace';

let archive: Buffer;
test.describe.configure({ timeout: 60000 });
test.beforeAll(async () => { archive = await readFile('dist/orbital-academy.spacegame'); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });
const academy = (page: Page) => page.locator('#academy-window');
async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function load(page: Page, offline = false) {
  await page.goto(offline ? `file://${resolve('dist/space-lab-offline.html')}` : '/');
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'orbital-academy.spacegame', mimeType: 'application/zip', buffer: archive });
  await expect(page.locator('#lab-status')).toContainText('Added Orbital Academy');
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Orbital Academy', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#lab-status')).toContainText('Playing Orbital Academy');
  await expect(academy(page)).toBeVisible();
}
async function practice(page: Page, id: string) {
  await academy(page).getByLabel('Choose a lesson').selectOption(id);
  await academy(page).getByRole('button', { name: 'Load practice setup', exact: true }).click();
  await expect(academy(page).getByRole('button', { name: 'Restart practice', exact: true })).toBeVisible();
  await expect(academy(page).locator('.academy-telemetry')).toContainText('Paused');
}
async function fly(page: Page) {
  await academy(page).getByRole('button', { name: 'Close orbital academy window' }).click();
  await page.locator('#flight-view').focus(); await page.keyboard.press('KeyP');
}

test('imports the real complete course and changes the world only on explicit practice actions', async ({ page }) => {
  await load(page);
  await expect(academy(page).locator('option')).toHaveCount(24);
  await practice(page, 'coasting');
  const before = await debug(page);
  await academy(page).getByLabel('Choose a lesson').selectOption('escape');
  await academy(page).getByRole('button', { name: 'Guide my current flight' }).click();
  const after = await debug(page);
  expect(after.position).toEqual(before.position); expect(after.velocity).toEqual(before.velocity);
  await expect(academy(page).locator('.academy-objective')).toContainText('Create an escape trajectory');
  await academy(page).getByText('Go deeper', { exact: true }).click();
  await expect(academy(page).locator('details[open]')).toContainText('Specific two-body energy');
  await academy(page).getByRole('button', { name: 'Stop guidance' }).click();
  await expect(page.locator('.academy-hud')).toBeHidden();
});

test('completes a lesson with real engine-off orbit flight, checks knowledge and restores local progress', async ({ page }) => {
  await load(page); await practice(page, 'coasting');
  await fly(page);
  await expect(page.locator('.academy-hud')).toContainText('What provides the turn?', { timeout: 15000 });
  await page.locator('.academy-hud').click();
  await academy(page).getByRole('button', { name: 'An orbit needs a hidden engine.', exact: true }).click();
  await expect(academy(page).locator('.academy-feedback')).toContainText('Try again');
  await academy(page).getByRole('button', { name: 'Gravity continually changes its velocity.', exact: true }).click();
  await expect(academy(page).locator('.academy-summary')).toContainText('1 / 24');
  await page.reload(); await openPanel(page, 'library');
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Orbital Academy', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(academy(page).locator('.academy-summary')).toContainText('1 / 24');
  await openPanel(page, 'library');
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Space Sim', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(academy(page)).toHaveCount(0); await expect(page.locator('.academy-hud')).toHaveCount(0);
});

test('launches through normal controls and detects lift-off and engine-off coasting', async ({ page }) => {
  await load(page); await practice(page, 'launch'); await fly(page);
  await page.keyboard.down('Space');
  await expect(page.locator('.academy-hud')).toContainText('Switch the engine off', { timeout: 10000 });
  await page.keyboard.up('Space');
  await expect(page.locator('.academy-hud')).toContainText('What keeps moving?', { timeout: 5000 });
  await page.locator('.academy-hud').click();
  await academy(page).getByRole('button', { name: 'It keeps moving while gravity bends its path.', exact: true }).click();
  await expect(academy(page).locator('.academy-summary')).toContainText('1 / 24');
});

test('reaches a safe engine-off first orbit using ordinary launch and steering keys', async ({ page }) => {
  test.setTimeout(90000);
  await load(page); await practice(page, 'first-orbit'); await fly(page);
  await page.keyboard.down('Space');
  let safe = false;
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    const state = await debug(page), p = state.position;
    let pulsed = false;
    if (state.groundClearance >= 20) {
      const target = Math.atan2(p.y, p.x) - Math.PI / 2, error = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
      if (Math.abs(error) > .08) {
        // Short physical key pulses avoid browser protocol latency leaving a turn held.
        await page.keyboard.press(error > 0 ? 'ArrowLeft' : 'ArrowRight', { delay: Math.min(150, Math.abs(error) / state.vehicle.turnRate * 1000) });
        pulsed = true;
      }
    }
    // The lesson first requires a 100 m climb. A lower safe orbit alone can
    // remain below that checkpoint forever, so leave some clearance margin.
    if (state.groundClearance >= 120 && state.orbit?.kind === 'elliptic' && state.orbit.periapsis > 535 && state.orbit.apoapsis < 40000) { safe = true; break; }
    if (!pulsed) await page.waitForTimeout(50);
  }
  await page.keyboard.up('Space');
  expect(safe, JSON.stringify(await debug(page))).toBe(true);
  await expect(page.locator('.academy-hud')).toContainText('Lesson complete', { timeout: 8000 });
  expect((await debug(page)).engine).toBe(false);
});

test('fits the course and expanded explanations on a phone and renders the target orbit', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 }); await load(page); await practice(page, 'circularize');
  await expect(academy(page).getByRole('img', { name: 'Suggested orbit compared with current coast' })).toBeVisible();
  await expect(academy(page).locator('.academy-diagram polyline[stroke="#7edbd0"]')).toHaveAttribute('points', /,/);
  await academy(page).locator('.academy-diagram').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `test-results/academy-phone-diagram-${test.info().project.name}.png` });
  await academy(page).getByText('Go deeper', { exact: true }).click();
  expect(await academy(page).evaluate(root => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
  await academy(page).getByRole('button', { name: 'Close orbital academy window' }).click();
  await page.screenshot({ path: `test-results/academy-phone-target-${test.info().project.name}.png` });
  await expect(page.locator('.academy-hud')).toBeVisible();
  await page.locator('.academy-hud').click();
  await expect(academy(page).getByLabel('Choose a lesson')).toBeVisible();
  await page.screenshot({ path: `test-results/academy-phone-course-${test.info().project.name}.png` });
});

test('recognizes a generated two-node transfer while flight remains paused', async ({ page }) => {
  await load(page); await practice(page, 'transfer-options');
  await academy(page).getByRole('button', { name: 'Close orbital academy window' }).click();
  const d = await debug(page), box = (await page.locator('#flight-view').boundingBox())!;
  const r = Math.hypot(d.position.x, d.position.y), angle = Math.atan2(d.position.y, d.position.x) - Math.min(.5, 150 / (r * d.camera.scale));
  const dx = r * Math.cos(angle) - d.position.x, dy = r * Math.sin(angle) - d.position.y, c = Math.cos(d.camera.rotation), s = Math.sin(d.camera.rotation);
  await page.mouse.click(box.x + box.width / 2 + (c * dx - s * dy) * d.camera.scale, box.y + box.height / 2 - (s * dx + c * dy) * d.camera.scale);
  await expect(page.locator('#maneuver-window')).toBeVisible();
  await page.locator('#maneuver-transfers-tab').click();
  await page.locator('#maneuver-transfer-low').fill('1536'); await page.locator('#maneuver-transfer-find').click();
  await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible();
  await page.locator('#maneuver-transfer-use-efficient').click();
  await expect(page.locator('.academy-hud')).toContainText('Review each real burn');
  expect((await debug(page)).time).toBe(d.time); expect((await debug(page)).engine).toBe(false);
});

test('loads the same portable archive into the standalone offline application', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Standalone file delivery qualification uses Chromium.');
  await load(page, true); await practice(page, 'capture');
  await expect(academy(page).locator('.academy-telemetry')).toContainText('Parvus');
  await expect(academy(page).locator('.academy-objective')).toContainText('Capture safely');
});
