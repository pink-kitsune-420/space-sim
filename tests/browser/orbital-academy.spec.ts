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
  await page.locator('.game-card:not([data-game^="builtin"])').filter({ has: page.getByRole('heading', { name: 'Orbital Academy', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
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
  await page.locator('.game-card:not([data-game^="builtin"])').filter({ has: page.getByRole('heading', { name: 'Orbital Academy', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(academy(page).locator('.academy-summary')).toContainText('1 / 24');
  await openPanel(page, 'library');
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Space Sim Classic', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
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
  // Drive the ordinary key bindings in the page so CI protocol latency cannot
  // leave a steering pulse or thrust held past its physical cutoff.
  const result = await page.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>('#flight-view')!, output = document.querySelector('#debug')!;
    const held = new Set<string>();
    const key = (code: string, down: boolean) => {
      if (held.has(code) === down) return;
      if (down) held.add(code); else held.delete(code);
      viewport.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }));
    };
    let captured = false, safe = false, turnUntil = 0, previousTime = -1, state: any;
    const until = performance.now() + 30000;
    try {
      key('Space', true);
      while (performance.now() < until) {
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        if (now >= turnUntil) { key('ArrowLeft', false); key('ArrowRight', false); }
        state = JSON.parse(output.textContent || '{}');
        if (state.time === previousTime) continue;
        previousTime = state.time;
        if (!captured && state.orbit?.kind === 'elliptic' && state.orbit.periapsis > 535 && state.orbit.apoapsis > 652 && state.orbit.apoapsis < 40000) {
          captured = true; key('Space', false); key('ArrowLeft', false); key('ArrowRight', false);
        }
        // A safe coast may be established before the climb checkpoint. Let it
        // climb engine-off instead of continuing to accelerate toward escape.
        if (captured) { if (state.groundClearance >= 120) { safe = true; break; } continue; }
        if (state.groundClearance >= 20 && now >= turnUntil) {
          const p = state.position, target = Math.atan2(p.y, p.x) - Math.PI / 2 + .15,
            error = Math.atan2(Math.sin(target - state.heading), Math.cos(target - state.heading));
          if (Math.abs(error) > .08) {
            key(error > 0 ? 'ArrowLeft' : 'ArrowRight', true);
            turnUntil = now + Math.min(100, Math.abs(error) / state.vehicle.turnRate * 1000);
          }
        }
      }
      return { safe, state };
    } finally { for (const code of [...held]) key(code, false); }
  });
  expect(result.safe, JSON.stringify(result.state)).toBe(true);
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
