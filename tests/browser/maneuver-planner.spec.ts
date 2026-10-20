import { readFile } from 'node:fs/promises';
import { packageContracts } from '../../packages/module-tools/package.mjs';
import { useLowGraphics } from '../helpers/canvas';
import { test, expect, type Page } from '@playwright/test';
import { closePanel, openPanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
test.beforeEach(async ({ page }) => useLowGraphics(page));

async function debug(page: Page) { return JSON.parse(await page.locator('#debug').textContent() || '{}'); }
async function setup(page: Page): Promise<void> {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.locator('#preset').evaluate(el => {
    (el as HTMLSelectElement).value = 'planet-orbit'; el.dispatchEvent(new Event('change'));
    document.getElementById('pause')!.click(); document.getElementById('camera')!.click();
    // Run interactions in Canvas; switching to WebGL below verifies the same layer there.
    document.getElementById('renderer-toggle')!.click();
  });
  await expect.poll(async () => (await debug(page)).predictionEnd, { timeout: 15000 }).toBe('closed');
  await closePanel(page);
  await expect.poll(async () => (await debug(page)).camera.mode).toBe('free');
}
async function coastPoint(page: Page) {
  const d = await debug(page), box = (await page.locator('#flight-view').boundingBox())!;
  const r = Math.hypot(d.position.x, d.position.y) * d.camera.scale;
  return { x: box.x + box.width/2 + r*Math.cos(2.5), y: box.y + box.height/2 - r*Math.sin(2.5) };
}
async function place(page: Page) {
  const point = await coastPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('#maneuver-window')).toBeVisible();
  await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(true);
}

test('clicking, editing, moving and removing a node previews a burn without changing live physics', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page);
  const before = await debug(page);
  await place(page);
  await page.locator('#maneuver-prograde').fill('10');
  await page.locator('#maneuver-radial').fill('5');
  await expect.poll(async () => (await debug(page)).maneuver?.samples).toBeGreaterThan(20);
  await expect(page.locator('#maneuver-summary')).toContainText('Δv 11.2 m/s');
  await page.screenshot({ path: 'test-results/maneuver-planner.png' });
  const planned = await debug(page);
  await test.info().attach('planner-profile', { contentType: 'application/json', body: JSON.stringify({
    renderer: planned.renderer, samples: planned.maneuver.samples,
    workP95Ms: planned.workP95Ms, predictionP95Ms: planned.predictionP95Ms, renderP95Ms: planned.renderP95Ms,
  }) });
  expect(planned.tick).toBe(before.tick);
  expect(planned.position).toEqual(before.position);
  expect(planned.velocity).toEqual(before.velocity);
  expect(planned.maneuver.time).toBeGreaterThan(planned.time);
  expect(planned.presentation.faults).toEqual([]);
  await page.locator('#maneuver-prograde').fill('10.25');
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBe(10.25);
  await page.locator('#maneuver-time').fill('20');
  await page.locator('#maneuver-time').press('Tab');
  await expect.poll(async () => (await debug(page)).maneuver?.time).toBeCloseTo(before.time + 20, 1);
  // A camera drag on the line must retain the existing plan.
  const point = await coastPoint(page), time = (await debug(page)).maneuver.time;
  await page.mouse.move(point.x, point.y); await page.mouse.down();
  await page.mouse.move(point.x + 80, point.y + 20, { steps: 8 }); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).camera.mode).toBe('free');
  expect((await debug(page)).maneuver.time).toBe(time);
  // The same plan survives replacing the renderer's canvas.
  await openPanel(page, 'settings');
  await page.locator('#renderer-toggle').click();
  await expect(page.locator('#renderer-toggle')).toHaveText('Renderer: WebGL');
  await expect.poll(async () => (await debug(page)).renderer, { timeout: 30000 }).toBe('builtin.webgl');
  expect((await debug(page)).maneuver.valid).toBe(true);
  await page.locator('#renderer-toggle').click();
  await closePanel(page);
  await page.locator('#maneuver-delete').click();
  await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
  expect(errors).toEqual([]);
});

test('manual warp stops before the burn and a reset clears the old plan and markers', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('10');
  await page.locator('#maneuver-time').fill('25'); await page.locator('#maneuver-time').press('Tab');
  await expect.poll(async () => (await debug(page)).maneuver?.samples).toBeGreaterThan(10);
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-warp')).toBeEnabled();
  await page.locator('#maneuver-warp').click();
  await expect.poll(async () => (await debug(page)).maneuver?.warping).toBe(true);
  await expect.poll(async () => (await debug(page)).maneuver?.warping, { timeout: 15000 }).toBe(false);
  const arrived = await debug(page);
  expect(arrived.maneuver.valid).toBe(true);
  expect(arrived.maneuver.time - arrived.time).toBeGreaterThan(5);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await page.locator('#pause').click();
  await openPanel(page, 'setup');
  await page.locator('#reset').click();
  await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
  await expect(page.locator('.maneuver-map')).toBeHidden();
  await expect(page.locator('#maneuver-nodes option')).toHaveCount(0);
});

test('an empty node can warp without arming a burn or changing throttle', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-time').fill('25'); await page.locator('#maneuver-time').press('Tab');
  const before = await debug(page);
  await expect(page.locator('#maneuver-execute')).toBeDisabled();
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-warp')).toBeEnabled();
  await page.locator('#maneuver-warp').click();
  await expect.poll(async () => (await debug(page)).maneuver?.warping).toBe(true);
  await expect.poll(async () => (await debug(page)).maneuver?.warping, { timeout: 15000 }).toBe(false);
  await page.locator('#pause').click();
  const after = await debug(page);
  expect(after.time).toBeGreaterThan(before.time + 5);
  expect(after.maneuver).toMatchObject({ valid: true, prograde: 0, radial: 0, execution: null });
  expect(after.engine).toBe(false); expect(after.throttle).toBe(before.throttle);
  expect(after.maneuver.time - after.time).toBeGreaterThan(5);
  expect(after.maneuver.time - after.time).toBeLessThan(11);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
});

test('map handles shape and move the local plan, with fine controls and drag cancellation', async ({ page }) => {
  await setup(page); await place(page);
  const before = await debug(page);
  const handle = page.getByRole('button', { name: 'Increase prograde velocity', exact: true });
  const node = page.getByRole('button', { name: 'Move maneuver node along the coast; click to open editor', exact: true });
  const center = (box: {x: number; y: number; width: number; height: number}) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const p = center((await handle.boundingBox())!), n = center((await node.boundingBox())!);
  const length = Math.hypot(p.x - n.x, p.y - n.y), dx = (p.x - n.x) / length, dy = (p.y - n.y) / length;
  await page.mouse.move(p.x, p.y); await page.mouse.down();
  await page.mouse.move(p.x + dx * 32, p.y + dy * 32, { steps: 8 }); await page.mouse.up();
  // Firefox rounds pointer positions to CSS pixels; a drag can differ by a fraction of a step.
  await expect.poll(async () => Math.abs((await debug(page)).maneuver?.prograde - 8)).toBeLessThan(.5);
  const dragged = (await debug(page)).maneuver.prograde;
  await page.locator('#maneuver-increment').selectOption('0.1');
  await handle.focus(); await page.keyboard.press('Enter');
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBeCloseTo(dragged + .1, 6);
  const latest = center((await handle.boundingBox())!);
  await page.mouse.move(latest.x, latest.y); await page.mouse.down();
  await page.mouse.move(latest.x + dx * 40, latest.y + dy * 40, { steps: 8 });
  await page.keyboard.press('Escape'); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBeCloseTo(dragged + .1, 6);
  const box = (await page.locator('#flight-view').boundingBox())!, radius = Math.hypot(n.x - box.x - box.width / 2, n.y - box.y - box.height / 2);
  const time = (await debug(page)).maneuver.time;
  await page.mouse.move(n.x, n.y); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + radius * Math.cos(2.2), box.y + box.height / 2 - radius * Math.sin(2.2), { steps: 12 }); await page.mouse.up();
  await expect.poll(async () => (await debug(page)).maneuver?.time).not.toBe(time);
  const after = await debug(page);
  expect(after.tick).toBe(before.tick); expect(after.velocity).toEqual(before.velocity); expect(after.position).toEqual(before.position);
  expect(after.camera).toEqual(before.camera); expect(after.engine).toBe(false);
  await page.screenshot({ path: 'test-results/maneuver-map-handles.png' });
  await page.locator('#maneuver-clear').click();
  await expect.poll(async () => (await debug(page)).maneuver?.prograde).toBe(0);
  await page.locator('#maneuver-delete').click();
  await expect(page.getByRole('group', { name: 'Maneuver map controls' })).toBeHidden();
});

test('Execute burn warps, aligns, fires and cuts off autonomously', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('-10');
  await page.locator('#maneuver-radial').fill('5');
  await page.locator('#maneuver-time').fill('30'); await page.locator('#maneuver-time').press('Tab');
  await page.locator('#pause').click();
  await expect(page.locator('#maneuver-execute')).toBeEnabled();
  await page.locator('#maneuver-execute').click();
  await expect(page.locator('#maneuver-abort')).toBeVisible();
  await expect.poll(async () => (await debug(page)).maneuver?.execution).not.toBeNull();
  await expect(page.locator('#maneuver-status')).toContainText(/complete|Plan complete/, { timeout: 25000 });
  // The editor status refreshes independently of the 4-Hz diagnostic snapshot.
  await expect.poll(async () => { const done = await debug(page); return { execution: done.maneuver?.execution, engine: done.engine, valid: done.maneuver?.valid }; }).toEqual({ execution: null, engine: false, valid: false });
  const done = await debug(page);
  await expect(page.locator('#warp-factor')).toHaveText('1×');
  await expect(page.locator('#throttle-value')).toHaveText('0%');
  await expect(page.locator('#maneuver-abort')).toBeHidden();
  expect(errors).toEqual([]);
  await test.info().attach('autonomous-burn-profile', { contentType: 'application/json', body: JSON.stringify({
    workP95Ms: done.workP95Ms, simulationP95Ms: done.simulationP95Ms,
    predictionP95Ms: done.predictionP95Ms, renderP95Ms: done.renderP95Ms,
  }) });
});

test('Execute burn resumes paused flight and completes a transfer-sized departure from zero throttle', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('55.69075');
  await page.locator('#maneuver-radial').fill('0');
  await page.locator('#maneuver-time').fill('30'); await page.locator('#maneuver-time').press('Tab');
  await page.locator('#throttle').evaluate(el => {
    (el as HTMLInputElement).value='0';el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  await expect(page.locator('#throttle-value')).toHaveText('0%');
  await expect(page.locator('#pause')).toHaveText('Resume');
  await expect(page.locator('#maneuver-execute')).toBeEnabled();
  await page.locator('#maneuver-execute').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await expect(page.locator('#maneuver-status')).toContainText(/complete|Plan complete/,{timeout:30000});
  await expect.poll(async()=>{const d=await debug(page);return {engine:d.engine,execution:d.maneuver?.execution};}).toEqual({engine:false,execution:null});
  const done=await debug(page);
  expect(done.engine).toBe(false);expect(done.maneuver.execution).toBeNull();
  expect(done.time).toBeGreaterThanOrEqual(done.maneuver.time);
});

test('automatic alignment speed is a validated module setting and changing it leaves the paused flight intact',async({page})=>{
 await setup(page);const before=await debug(page);await openPanel(page,'library');
 if(!await page.locator('.presentation-settings').evaluate(el=>(el as HTMLDetailsElement).open))await page.locator('.presentation-settings > summary').click();
 const setting=page.getByLabel('Automatic alignment warp (×)',{exact:true});
 await expect(setting).toHaveValue('4');await expect(setting).toHaveAttribute('min','1');await expect(setting).toHaveAttribute('max','4');
 await setting.fill('1');await setting.press('Tab');await expect(page.locator('#presentation-status')).toContainText('settings applied');
 await expect(setting).toHaveValue('1');
 await setting.fill('3.5');await setting.press('Tab');await expect(page.locator('#presentation-status')).toContainText('allowed range and increment');
 await setting.fill('4');await setting.press('Tab');await expect(page.locator('#presentation-status')).toContainText('settings applied');
 const after=await debug(page);expect(after.world).toBe(before.world);expect(after.tick).toBe(before.tick);expect(after.position).toEqual(before.position);
});

test('Execute burn crosses a two-hour parking-orbit wait promptly and returns the clock after cutoff',async({page})=>{
 await setup(page);await place(page);
 await page.locator('#maneuver-prograde').fill('4');await page.locator('#maneuver-radial').fill('2');
 await page.locator('#maneuver-time').fill('7761.1');await page.locator('#maneuver-time').press('Tab');
 await expect(page.locator('#maneuver-execute')).toBeEnabled();
 const before=await debug(page);await expect(page.locator('#pause')).toHaveText('Resume');
 await page.locator('#maneuver-execute').click();
 await expect(page.locator('#maneuver-status')).toContainText(/complete|Plan complete/,{timeout:20000});
 await expect.poll(async()=>{const d=await debug(page);return {engine:d.engine,execution:d.maneuver?.execution};}).toEqual({engine:false,execution:null});
 const done=await debug(page);expect(done.time-before.time).toBeGreaterThanOrEqual(7761);
 await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#throttle-value')).toHaveText('0%');
});

test('Abort burn releases thrust during a finite burn and requires replanning', async ({ page }) => {
  await setup(page); await place(page);
  await page.locator('#maneuver-prograde').fill('400');
  await page.locator('#maneuver-time').fill('25'); await page.locator('#maneuver-time').press('Tab');
  if ((await page.locator('#pause').textContent()) === 'Resume') await page.locator('#pause').click();
  await expect(page.locator('#pause')).toHaveText('Pause');
  await expect(page.locator('#maneuver-execute')).toBeEnabled();
  await page.locator('#maneuver-execute').click();
  await expect.poll(async () => (await debug(page)).maneuver?.execution, { timeout: 25000 }).toBe('burning');
  const burning = await debug(page);
  await test.info().attach('finite-burn-profile', { contentType: 'application/json', body: JSON.stringify({
    workP95Ms: burning.workP95Ms, simulationP95Ms: burning.simulationP95Ms,
    predictionP95Ms: burning.predictionP95Ms, renderP95Ms: burning.renderP95Ms,
  }) });
  await page.locator('#maneuver-abort').click();
  await expect.poll(async () => (await debug(page)).maneuver?.execution).toBeNull();
  await expect.poll(async () => (await debug(page)).engine).toBe(false);
  await expect(page.locator('#maneuver-status')).toContainText('aborted');
  expect((await debug(page)).maneuver.valid).toBe(false);
});

for (const cancellation of ['manual steering', 'pause', 'reset'] as const) {
  test(`${cancellation} cancels armed execution`, async ({ page }) => {
    // Each cancellation starts with a fresh future node: steering can leave the
    // previous node too close for another safe automatic alignment.
    await setup(page); await place(page);
    await page.locator('#maneuver-prograde').fill('10');
    await page.locator('#maneuver-time').fill('10'); await page.locator('#maneuver-time').press('Tab');
    await page.locator('#pause').click();
    await page.locator('#maneuver-execute').click();
    if (cancellation === 'manual steering') {
      await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
      await page.keyboard.down('ArrowLeft');
    } else if (cancellation === 'pause') await page.locator('#pause').click();
    else {
      await openPanel(page, 'setup');
      await page.locator('#reset').click();
    }
    await expect.poll(async () => (await debug(page)).maneuver?.execution??null).toBeNull();
    if (cancellation === 'manual steering') await page.keyboard.up('ArrowLeft');
    if (cancellation === 'reset') await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
  });
}

test.describe('touch planning', () => {
  test.use({ hasTouch: true });
  test('a tap places a node; a pinch or cancelled gesture does not', async ({ page }) => {
    await setup(page);
    const point = await coastPoint(page);
    await page.touchscreen.tap(point.x, point.y);
    await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(true);
    await page.locator('#maneuver-delete').click();
    await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
    const canvas = page.locator('#flight-view');
    await canvas.dispatchEvent('pointerdown', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    await canvas.dispatchEvent('pointerdown', { pointerId: 42, pointerType: 'touch', isPrimary: false, button: 0, clientX: point.x+20, clientY: point.y });
    await canvas.dispatchEvent('pointerup', { pointerId: 42, pointerType: 'touch', isPrimary: false, button: 0, clientX: point.x+20, clientY: point.y });
    await canvas.dispatchEvent('pointerup', { pointerId: 41, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    expect((await debug(page)).maneuver).toBeNull();
    await canvas.dispatchEvent('pointerdown', { pointerId: 43, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    await canvas.dispatchEvent('pointercancel', { pointerId: 43, pointerType: 'touch', isPrimary: true, button: 0, clientX: point.x, clientY: point.y });
    expect((await debug(page)).maneuver).toBeNull();
  });
});

test('shared plans export inert nodes and survive portable universe saves with review required', async ({ page }, info) => {
  await setup(page); await place(page);
  await expect(page.locator('#maneuver-plan-controls')).toBeVisible();
  await page.locator('#maneuver-time').fill('20'); await page.locator('#maneuver-time').press('Tab');
  await page.locator('#maneuver-prograde').fill('10'); await page.locator('#maneuver-plan-actions > summary').click(); await page.locator('#maneuver-add').click();
  await page.locator('#maneuver-prograde').fill('2');
  await expect.poll(async () => (await debug(page)).maneuver?.nodes).toBe(2);
  await expect(page.locator('#maneuver-status')).toContainText('Earlier burn pending');
  await expect(page.locator('#maneuver-execute')).toBeDisabled();
  const exported = page.waitForEvent('download'); await page.locator('#maneuver-export').click();
  const plan = JSON.parse(await readFile(await (await exported).path(), 'utf8'));
  expect(plan.plans[0].nodes).toHaveLength(2); expect(JSON.stringify(plan)).not.toMatch(/armed|engine|execution/);
  await page.screenshot({ path: info.outputPath('shared-plan.png') });
  await openPanel(page, 'fleet'); const pending = page.waitForEvent('download'); await page.locator('#save-world').click();
  const bytes = await readFile(await (await pending).path()), kit = await packageContracts();
  const saved = await kit.decodeUniverseSave(new Uint8Array(bytes)) as any;
  expect(saved.flightPlans.plans[0].nodes).toHaveLength(2);
  await page.locator('#world-file').setInputFiles({ name: 'plan.spaceuniverse', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(false);
  expect((await debug(page)).maneuver.nodes).toBe(2); expect((await debug(page)).maneuver.execution).toBeNull();
  await closePanel(page);
  await page.locator('#maneuver-review').click();
  await expect.poll(async () => (await debug(page)).maneuver?.valid).toBe(true);
  const old = { ...saved }; delete old.flightPlans;
  await page.locator('#world-file').setInputFiles({ name: 'old.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect.poll(async () => (await debug(page)).maneuver).toBeNull();
});

test('transfer window compares efficient/faster options, creates editable nodes and accepts deeper relationships',async({page},info)=>{
 await setup(page);await place(page);const before=await debug(page);
 await page.locator('#maneuver-transfers-tab').click();
 await page.locator('#maneuver-transfer-low').fill('768');await page.locator('#maneuver-transfer-find').click();
 await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible();await expect(page.locator('#maneuver-transfer-use-faster')).toBeVisible();
 await expect(page.locator('#maneuver-transfer-choices')).toContainText(/Wait.*Travel.*Δv/);
 const calculated=await debug(page);expect(calculated.tick).toBe(before.tick);expect(calculated.velocity).toEqual(before.velocity);expect(calculated.maneuver.execution).toBeNull();
 await page.locator('#maneuver-transfer-use-efficient').click();
 await expect.poll(async()=>(await debug(page)).maneuver?.nodes).toBe(2);await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);
 expect((await debug(page)).maneuver.execution).toBeNull();await expect(page.locator('#maneuver-prograde')).toBeEnabled();
 await page.screenshot({path:info.outputPath('transfer-window.png')});
 await page.locator('#maneuver-transfers-tab').click();
 await page.locator('#maneuver-transfer-circular').uncheck();await page.locator('#maneuver-transfer-low').fill('256');await page.locator('#maneuver-transfer-high').fill('1024');
 await expect(page.locator('#maneuver-transfer-use-efficient')).toHaveCount(0);await page.locator('#maneuver-transfer-find').click();await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible();
 // Searching collapses the chooser; reopen it before browsing a deeper destination.
 await page.locator('#maneuver-transfer-change').click();await page.locator('#maneuver-transfer-browser summary').click();await page.locator('#maneuver-transfer-query').fill('Nix');await page.locator('#maneuver-transfer-matches [data-destination="nix"]').click();await expect(page.locator('#maneuver-transfer-find')).toBeEnabled();
 await expect(page.locator('#maneuver-transfer-support')).toContainText('accepts this relationship');await expect(page.locator('#maneuver-transfer-use-efficient')).toHaveCount(0);
 expect((await debug(page)).position).toEqual(before.position);
});

test('a manual node alarm stops ordinary warp and optionally pauses without arming engines',async({page},info)=>{
 await setup(page);await place(page);
 await page.locator('#maneuver-time').fill('30');await page.locator('#maneuver-time').press('Tab');await page.locator('#maneuver-prograde').fill('10');
 await page.locator('#maneuver-alarms summary').click();
 await page.locator('#maneuver-alarms [data-alarm="lead"]').fill('20');await page.locator('#maneuver-alarms [data-alarm="lead"]').press('Tab');
 await page.locator('#maneuver-alarms [data-alarm="pause"]').check();
 await page.locator('#alarms-toast').click();await expect(page.locator('#alarms-window')).toBeVisible();await expect(page.locator('#alarms-window output')).toHaveText('1 pending · 0 delivered');await page.locator('#alarms-toast').click();
 const before=await debug(page);await page.locator('#pause').click();
 // Ordinary player warp, without Warp to node or Execute burn.
 await page.locator('#warp-up').evaluate(el=>{for(let i=0;i<5;i++)(el as HTMLButtonElement).click();});
 await expect(page.locator('#pause')).toHaveText('Resume',{timeout:20000});
 await expect(page.locator('#maneuver-alarms [data-alarm="status"]')).toHaveText('Reminder delivered.');
 const after=await debug(page);expect(after.time).toBeGreaterThan(before.time);expect(after.time).toBeLessThan(after.maneuver.time-19);
 expect(after.maneuver.execution).toBeNull();expect(after.engine).toBe(false);expect(after.throttle).toBe(before.throttle);await expect(page.locator('#warp-factor')).toHaveText('1×');
 await page.locator('#alarms-toast').click();await expect(page.locator('#alarms-window output')).toHaveText('0 pending · 1 delivered');
 await page.screenshot({path:info.outputPath('manual-burn-alarm.png')});
});

test('dragging the maneuver diamond captures the pointer and projects far-away motion onto the coast',async({page})=>{
 await setup(page);await place(page);const before=await debug(page),node=page.getByRole('button',{name:'Move maneuver node along the coast; click to open editor',exact:true});
 const box=(await page.locator('#flight-view').boundingBox())!,n=(await node.boundingBox())!,cx=box.x+box.width/2,cy=box.y+box.height/2,r=Math.hypot(n.x+n.width/2-cx,n.y+n.height/2-cy);
 await node.evaluate(el=>el.addEventListener('gotpointercapture',event=>{(el as HTMLElement).dataset.captured=String((event as PointerEvent).pointerId);}));
 const target={x:cx+(r+100)*Math.cos(.8),y:cy-(r+100)*Math.sin(.8)};
 await page.mouse.move(n.x+n.width/2,n.y+n.height/2);await page.mouse.down();await page.mouse.move(target.x,target.y,{steps:15});
 await expect.poll(()=>node.evaluate(el=>el.hasPointerCapture(Number((el as HTMLElement).dataset.captured)))).toBe(true);
 await expect.poll(async()=>(await debug(page)).maneuver.time).not.toBe(before.maneuver.time);
 const moved=(await node.boundingBox())!;expect(Math.hypot(moved.x+moved.width/2-target.x,moved.y+moved.height/2-target.y)).toBeGreaterThan(60);
 expect(Math.abs(Math.hypot(moved.x+moved.width/2-cx,moved.y+moved.height/2-cy)-r)).toBeLessThan(3);await page.mouse.up();
 const after=await debug(page);expect(after.camera).toEqual(before.camera);expect(after.position).toEqual(before.position);expect(after.maneuver.execution).toBeNull();
 // Read the exact final intent, rather than the diagnostics panel's 4 Hz
 // snapshot, which may still describe a point partway through the first drag.
 const exported=page.waitForEvent('download');await page.locator('#maneuver-export').evaluate(el=>(el as HTMLButtonElement).click());
 const archive=JSON.parse(await readFile(await (await exported).path(),'utf8'));
 const saved=archive.plans[0].nodes[0].time,current=(await node.boundingBox())!;
  await page.mouse.move(current.x+current.width/2,current.y+current.height/2);await page.mouse.down();await page.mouse.move(cx+(r+100)*Math.cos(.3),cy-(r+100)*Math.sin(.3),{steps:10});
  await node.evaluate(el=>(el as HTMLButtonElement).blur()); // capture still owns the gesture after focus loss
  await page.keyboard.press('Escape');await page.mouse.up();
 await expect.poll(async()=>(await debug(page)).maneuver.time).toBeCloseTo(saved,6);
});

test('offers a validated moon plan while the remaining search is still running',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-local [data-destination="moon"]').click();await page.locator('#maneuver-transfer-low').fill('512');
 // Observe publication order: a fast solver can publish and finish in one task,
 // before a Playwright round trip or even the next browser paint.
 await page.evaluate(()=>{
  (window as any).sawProgressiveTransfer=false;
  const choices=document.getElementById('maneuver-transfer-choices')!,cancel=document.getElementById('maneuver-transfer-cancel')!;
  let published=false;
  const observer=new MutationObserver(records=>{
   for(const record of records){
    if(record.target===choices&&[...record.addedNodes].some(node=>node instanceof HTMLElement&&node.matches('.transfer-option')))published=true;
    // Adding hidden ends the search. Its old value is null while searching.
    if(published&&record.target===cancel&&record.type==='attributes'&&record.oldValue===null)(window as any).sawProgressiveTransfer=true;
   }
   if(published&&!cancel.hidden)(window as any).sawProgressiveTransfer=true;
   if((window as any).sawProgressiveTransfer)observer.disconnect();
  });
  observer.observe(document.getElementById('maneuver-transfers')!,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden'],attributeOldValue:true});
 });
 const before=await debug(page);await page.locator('#maneuver-transfer-find').click();
 const use=page.locator('#maneuver-transfer-use-efficient');await expect(use).toBeEnabled({timeout:60000});
 await expect.poll(()=>page.evaluate(()=>(window as any).sawProgressiveTransfer)).toBe(true);
 await use.click();await expect(page.locator('#maneuver-transfer-cancel')).toBeHidden();
 await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);
 expect((await debug(page)).tick).toBe(before.tick);
 await expect(page.locator('#maneuver-nodes option')).toHaveCount(2);
});

test('moon transfers show both burn indicators, editable arrival and current-throttle duration in the production app',async({page},info)=>{
 // Search uses bounded 1 ms foreground and background slices. Software
 // renderers sharing a runner can need many wall-clock seconds for the same work.
 test.setTimeout(180000);
 await setup(page);await place(page);const before=await debug(page);
 await page.locator('#maneuver-transfers-tab').click();await page.locator('#maneuver-transfer-local [data-destination="moon"]').click();await page.locator('#maneuver-transfer-low').fill('100');
 await expect(page.locator('#maneuver-transfer-find')).toBeEnabled();await page.locator('#maneuver-transfer-find').click();
 await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible({timeout:120000});await expect(page.locator('#maneuver-transfer-choices')).toContainText('At 50% throttle');
 await page.locator('#maneuver-transfer-use-efficient').click();await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);
 await page.locator('#flight-view').evaluate(el=>{for(let i=0;i<4;i++)el.dispatchEvent(new WheelEvent('wheel',{deltaY:500,bubbles:true,cancelable:true}));});
 await page.screenshot({path:info.outputPath('moon-transfer-burns-canvas.png')});
 await page.locator('#maneuver-nodes').selectOption('arrival');await expect(page.locator('#maneuver-summary')).toContainText('Parvus');await expect(page.locator('#maneuver-summary')).toContainText('50% throttle');
 await expect(page.locator('#maneuver-execute')).toBeDisabled();
 await expect.poll(async()=>(await debug(page)).maneuver?.end,{timeout:15000}).toMatch(/horizon|impact|closed|escape/);
 await expect.poll(async()=>(await debug(page)).maneuver?.selected).toBe('arrival');
 const originalTime=(await debug(page)).maneuver.time,diamond=page.locator('.maneuver-map [data-map-control="node"]'),box=(await diamond.boundingBox())!;
 // Drag back along the approach to a capture that still validates. The arc start is the SOI entry, which has no
 // time to align, and an invalid drag snaps back once its evaluation finishes, so require a settled valid move.
 await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2-30,box.y+box.height/2,{steps:4});
 await expect.poll(async()=>{const m=(await debug(page)).maneuver;return m.time!==originalTime&&m.valid;}).toBe(true);
 await page.keyboard.press('Escape');await page.mouse.up();await expect.poll(async()=>(await debug(page)).maneuver.time).toBe(originalTime);
 await expect.poll(async()=>(await debug(page)).maneuver.valid).toBe(true);
 await page.locator('#maneuver-radial').fill('1');await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);
 await page.locator('#throttle').evaluate(el=>{(el as HTMLInputElement).value='25';el.dispatchEvent(new Event('input',{bubbles:true}));});await expect(page.locator('#maneuver-summary')).toContainText('25% throttle');
 await page.screenshot({path:info.outputPath('moon-transfer-arrival-canvas.png')});
 await page.locator('#renderer-toggle').evaluate(el=>(el as HTMLButtonElement).click());await expect.poll(async()=>(await debug(page)).renderer,{timeout:15000}).toBe('builtin.webgl');
 await page.screenshot({path:info.outputPath('moon-transfer-burns-webgl.png')});
 const after=await debug(page);expect(after.tick).toBe(before.tick);expect(after.velocity).toEqual(before.velocity);expect(after.maneuver.execution).toBeNull();
});

test('raises a small orbit into a larger circle by flying both generated finite burns',async({page},info)=>{
 test.setTimeout(90000);
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-low').fill('1536');await page.locator('#maneuver-transfer-find').click();
 await page.locator('#maneuver-transfer-use-efficient').click();
 await expect(page.locator('#maneuver-execute')).toBeEnabled();await page.locator('#maneuver-execute').click();
 await expect(page.locator('#maneuver-nodes option').first()).toContainText('flown',{timeout:30000});
 await expect(page.locator('#maneuver-nodes')).toHaveValue('arrival');
 await expect(page.locator('#pause')).toHaveText('Pause');await expect(page.locator('#warp-factor')).toHaveText('1×');
 await expect(page.locator('#maneuver-continue')).toBeEnabled();await page.locator('#maneuver-continue').click();
 await expect(page.locator('#maneuver-nodes')).toHaveValue('arrival');
 await expect(page.locator('#maneuver-status')).toContainText(/complete|Plan complete/,{timeout:30000});
 await expect.poll(async()=>{const d=await debug(page);return {engine:d.engine,execution:d.maneuver.execution};}).toEqual({engine:false,execution:null});
 const done=await debug(page);expect(done.engine).toBe(false);expect(done.orbit.kind).toBe('elliptic');
 expect(Math.abs(done.orbit.periapsis-2048)).toBeLessThan(20);expect(Math.abs(done.orbit.apoapsis-2048)).toBeLessThan(20);
 await page.screenshot({path:info.outputPath('two-burn-raised-circle.png')});
});

test('Transfers is discoverable without a node and the compact burn editor keeps core controls visible',async({page},info)=>{
 await setup(page);const before=await debug(page);expect(before.maneuver).toBeNull();
 await page.getByRole('button',{name:'Transfers',exact:true}).click();await expect(page.locator('#maneuver-window')).toBeVisible();
 await expect(page.getByRole('tab',{name:'Transfer window',exact:true})).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#maneuver-node-view')).toBeHidden();await expect(page.locator('#maneuver-transfer-cancel')).toBeHidden();await expect(page.locator('#maneuver-transfer-high')).toBeHidden();
 await page.locator('#maneuver-transfer-low').fill('768');await page.getByRole('button',{name:'Find transfer windows',exact:true}).click();
 await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible();await expect(page.locator('.transfer-option .transfer-metrics').first()).toContainText(/Wait.*Travel.*Δv/);
 await page.screenshot({path:info.outputPath('transfer-window-clean.png')});
 await page.locator('#maneuver-transfer-use-efficient').click();await expect(page.getByRole('tab',{name:'Burn editor',exact:true})).toHaveAttribute('aria-selected','true');
 await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);await expect(page.locator('#maneuver-plan-actions')).not.toHaveAttribute('open');
 const geometry=await page.locator('#maneuver-window').evaluate(window=>{const execute=window.querySelector('#maneuver-execute')!,body=window.querySelector('.flight-window-body')!;return{execute:execute.getBoundingClientRect().bottom,body:body.getBoundingClientRect().bottom,horizontal:body.scrollWidth-body.clientWidth};});
 expect(geometry.execute).toBeLessThanOrEqual(geometry.body);expect(geometry.horizontal).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('burn-editor-clean.png')});
 await page.setViewportSize({width:390,height:844});await expect(page.locator('#maneuver-execute')).toBeVisible();
 const small=await page.locator('#maneuver-window').evaluate(window=>({width:window.getBoundingClientRect().width,overflow:window.scrollWidth-window.clientWidth}));expect(small.width).toBeLessThanOrEqual(390);expect(small.overflow).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('burn-editor-small.png')});
 const after=await debug(page);expect(after.tick).toBe(before.tick);expect(after.velocity).toEqual(before.velocity);expect(after.maneuver.execution).toBeNull();
});


for(const kind of ['efficient','faster'])test(`Auto warp adopts the ${kind} transfer, resumes flight and completes both burns`,async({page},info)=>{
 test.setTimeout(180000);
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-low').fill('1536');await page.locator('#maneuver-transfer-find').click();
 const use=page.locator(`#maneuver-transfer-use-${kind}`),automatic=page.locator(`#maneuver-transfer-auto-warp-${kind}`);
 await expect(automatic).toBeEnabled();await automatic.scrollIntoViewIfNeeded();
 const useBox=(await use.boundingBox())!,autoBox=(await automatic.boundingBox())!;
 // Auto warp sits beside Use plan on the same row.
 expect(autoBox.x).toBeGreaterThanOrEqual(useBox.x+useBox.width);expect(Math.abs(autoBox.y+autoBox.height/2-useBox.y-useBox.height/2)).toBeLessThanOrEqual(1);
 await page.screenshot({path:info.outputPath('auto-warp-transfer.png')});
 await automatic.click();
 await expect(page.locator('#maneuver-automatic')).toBeChecked();await expect(page.locator('#maneuver-auto-warp')).toBeChecked();
 await expect(page.locator('#pause')).toHaveText('Pause');
 await expect(page.locator('#maneuver-nodes option').first()).toContainText('flown',{timeout:60000});
 await expect(page.locator('#maneuver-nodes option').last()).toContainText('flown',{timeout:90000});
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();await expect(page.locator('#warp-factor')).toHaveText('1×');
 // #debug refreshes at 4 Hz, so wait for the snapshot to show the cut-off rather than sampling a stale one.
 await expect.poll(async()=>(await debug(page)).engine).toBe(false);
 const done=await debug(page);expect(done.engine).toBe(false);expect(done.maneuver.completed).toBe(true);
 expect(Math.abs(done.orbit.periapsis-2048)).toBeLessThan(20);expect(Math.abs(done.orbit.apoapsis-2048)).toBeLessThan(20);
});

test('an explicitly enabled ship follows the clock and completes its prepared two-burn plan',async({page})=>{
 test.setTimeout(180000);
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-low').fill('1536');await page.locator('#maneuver-transfer-find').click();
 await page.locator('#maneuver-transfer-use-efficient').click();
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
 await page.locator('#maneuver-automatic').check();await expect.poll(async()=>(await debug(page)).maneuver?.automatic).toBe(true);
 await expect(page.locator('#pause')).toHaveText('Resume');
 await page.locator('#pause').click();
 // Enabling a background plan never fast-forwards the game by itself.
 await page.waitForTimeout(300);await expect(page.locator('#warp-factor')).toHaveText('1×');
 await page.locator('#warp-up').evaluate(el=>{for(let i=0;i<5;i++)(el as HTMLButtonElement).click();});
 await expect(page.locator('#maneuver-nodes option').first()).toContainText('flown',{timeout:60000});
 await expect(page.locator('#pause')).toHaveText('Pause');await expect(page.locator('#warp-factor')).toHaveText('1×');
 await page.locator('#warp-up').evaluate(el=>{for(let i=0;i<5;i++)(el as HTMLButtonElement).click();});
 await expect(page.locator('#maneuver-nodes option').last()).toContainText('flown',{timeout:90000});
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
 await expect.poll(async()=>(await debug(page)).engine).toBe(false);
 const done=await debug(page);expect(done.engine).toBe(false);expect(Math.abs(done.orbit.periapsis-2048)).toBeLessThan(20);expect(Math.abs(done.orbit.apoapsis-2048)).toBeLessThan(20);
});

test('host approval gates automatic fleet warp changes and declining leaves the shared clock alone',async({page})=>{
 await setup(page);await place(page);await page.locator('#maneuver-prograde').fill('4');
 await page.locator('#maneuver-time').fill('60');await page.locator('#maneuver-time').press('Tab');
 await openPanel(page,'tools');await page.locator('#local-multiplayer summary').click();await page.locator('#debug-host-game').click();
 await expect(page.locator('.connection')).toContainText('HOSTING');await closePanel(page);
 await page.locator('#maneuver-automatic').check();if(await page.locator('#pause').textContent()==='Resume')await page.locator('#pause').click();
 await page.locator('#warp-up').evaluate(el=>{for(let i=0;i<5;i++)(el as HTMLButtonElement).click();});
 await expect(page.locator('#warp-approval')).toBeVisible({timeout:20000});
 const pending=await debug(page);expect(pending.engine).toBe(false);await expect(page.locator('#warp-factor')).not.toHaveText('1×');
 await page.locator('#warp-approval [data-warp-deny]').click();
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();await expect(page.locator('#warp-approval')).toBeHidden();
 await expect(page.locator('#warp-factor')).not.toHaveText('1×');expect((await debug(page)).engine).toBe(false);
});

test('the host can approve a fleet request for real time without granting automatic fast-forward',async({page})=>{
 await setup(page);await place(page);await page.locator('#maneuver-prograde').fill('4');
 await page.locator('#maneuver-time').fill('60');await page.locator('#maneuver-time').press('Tab');
 await openPanel(page,'tools');await page.locator('#local-multiplayer summary').click();await page.locator('#debug-host-game').click();await closePanel(page);
 await page.locator('#maneuver-automatic').check();if(await page.locator('#pause').textContent()==='Resume')await page.locator('#pause').click();
 await page.locator('#warp-up').evaluate(el=>{for(let i=0;i<5;i++)(el as HTMLButtonElement).click();});
 await expect(page.locator('#warp-approval')).toBeVisible({timeout:20000});await page.locator('#warp-approval [data-warp-approve]').click();
 await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#maneuver-automatic')).toBeChecked();
 await page.locator('#maneuver-abort').click();await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
 expect((await debug(page)).engine).toBe(false);await expect(page.locator('#pause')).toHaveText('Pause');
});


test('pilot warp keys cancel an automatic approach and its reminder without fighting the requested factor',async({page})=>{
 await setup(page);await place(page);await page.locator('#maneuver-prograde').fill('10');
 await page.locator('#maneuver-time').fill('60');await page.locator('#maneuver-time').press('Tab');
 await page.locator('#maneuver-execute').click();
 await expect.poll(async()=>(await debug(page)).maneuver?.execution).not.toBeNull();
 await page.keyboard.press('Comma');
 await expect.poll(async()=>(await debug(page)).maneuver?.execution).toBeNull();
 const chosen=await page.locator('#warp-factor').textContent();await page.waitForTimeout(500);await expect(page.locator('#warp-factor')).toHaveText(chosen!);
 await page.locator('#maneuver-alarms summary').click();await expect(page.locator('#maneuver-alarms [data-alarm="status"]')).toContainText('suspended by manual warp');
 const before=await debug(page);expect(before.engine).toBe(false);expect(before.maneuver.warping).toBe(false);
 await page.keyboard.press('Period');await expect(page.locator('#warp-factor')).not.toHaveText(chosen!);
 await page.waitForTimeout(300);expect((await debug(page)).maneuver.execution).toBeNull();expect((await debug(page)).engine).toBe(false);
});


test('optional auto-warp flies both prepared burns and releases the clock at completion',async({page})=>{
 test.setTimeout(90000);
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-low').fill('1536');await page.locator('#maneuver-transfer-find').click();await page.locator('#maneuver-transfer-use-efficient').click();
 await expect(page.locator('#maneuver-auto-warp')).not.toBeChecked();await expect(page.locator('#maneuver-auto-warp')).toBeDisabled();
 await page.locator('#maneuver-automatic').check();await page.locator('#maneuver-auto-warp').check();
 await page.locator('#pause').click();
 await expect(page.locator('#warp-factor')).not.toHaveText('1×');
 await expect(page.locator('#maneuver-nodes option').last()).toContainText('flown',{timeout:60000});
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();await expect(page.locator('#maneuver-auto-warp')).not.toBeChecked();
 await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#pause')).toHaveText('Pause');
 await expect.poll(async()=>(await debug(page)).engine).toBe(false);
 const done=await debug(page);expect(Math.abs(done.orbit.periapsis-2048)).toBeLessThan(20);expect(Math.abs(done.orbit.apoapsis-2048)).toBeLessThan(20);
});
test('pilot warp overrides optional auto-warp and leaves the chosen clock alone',async({page})=>{
 await setup(page);await place(page);await page.locator('#maneuver-prograde').fill('4');await page.locator('#maneuver-time').fill('120');await page.locator('#maneuver-time').press('Tab');
 await page.locator('#maneuver-automatic').check();await page.locator('#maneuver-auto-warp').check();await page.locator('#pause').click();
 await expect(page.locator('#warp-factor')).not.toHaveText('1×');await page.keyboard.press('Comma');
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();const chosen=await page.locator('#warp-factor').textContent();
 await page.waitForTimeout(500);await expect(page.locator('#warp-factor')).toHaveText(chosen!);expect((await debug(page)).engine).toBe(false);
 await expect(page.locator('#maneuver-automatic-status')).toContainText('Manual warp took over');
 await page.locator('#maneuver-review').click();
 // The pilot clock can pass the node; either review outcome retains the stop reason.
 await expect(page.locator('#maneuver-automatic-status')).toContainText('Manual warp took over');
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
});
test('host approval permits a whole automatic plan without changing warp merely on approval',async({page})=>{
 await setup(page);await place(page);await page.locator('#maneuver-prograde').fill('4');await page.locator('#maneuver-time').fill('120');await page.locator('#maneuver-time').press('Tab');
 await openPanel(page,'tools');await page.locator('#local-multiplayer summary').click();await page.locator('#debug-host-game').click();await closePanel(page);
 await page.locator('#maneuver-automatic').check();await page.locator('#maneuver-auto-warp').check();
 if(await page.locator('#pause').textContent()==='Resume')await page.locator('#pause').click();
 await expect(page.locator('#warp-approval')).toContainText('remaining prepared burns');await expect(page.locator('#warp-factor')).toHaveText('1×');
 await expect(page.locator('#warp-approval')).toContainText('validated arrival corrections');
 // Both operations run in one task: granting permission itself has no clock effect.
 await page.locator('#warp-approval [data-warp-approve]').evaluate(el=>{(el as HTMLButtonElement).click();if(document.querySelector('#warp-factor')!.textContent!=='1×')throw new Error('Approval changed the clock synchronously');});
 await expect(page.locator('#warp-factor')).not.toHaveText('1×');await expect(page.locator('#warp-approval')).toBeHidden();
 await page.keyboard.press('Comma');await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
});

test('filters excessive shortcuts for a tiny orbit change and cancels background search tasks cleanly',async({page})=>{
 await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();const before=await debug(page);
 await page.locator('#maneuver-transfer-low').fill('129');await page.locator('#maneuver-transfer-find').click();
 await expect(page.locator('#maneuver-transfer-cancel')).toBeHidden();await expect(page.locator('#maneuver-transfer-use-efficient')).toBeVisible();await expect(page.locator('#maneuver-transfer-use-faster')).toHaveCount(0);
 await expect(page.locator('#maneuver-transfer-chooser')).toBeHidden();
 await page.locator('#maneuver-transfer-change').click();await page.locator('#maneuver-transfer-local [data-destination="moon"]').click();await page.locator('#maneuver-transfer-find').click();await page.locator('#maneuver-transfer-cancel').click();
 await expect(page.locator('#maneuver-transfer-status')).toHaveText('Search cancelled.');await page.waitForTimeout(200);
 await expect(page.locator('#maneuver-transfer-choices')).toBeEmpty();await expect(page.locator('#maneuver-transfer-status')).toHaveText('Search cancelled.');
 await page.locator('#maneuver-transfer-change').click();await page.locator('#maneuver-transfer-local [data-destination="planet"]').click();await page.locator('#maneuver-transfer-low').fill('768');await page.locator('#maneuver-transfer-find').click();
 await expect(page.locator('#maneuver-transfer-use-efficient')).toBeEnabled();await expect(page.locator('#maneuver-transfer-use-faster')).toBeEnabled();
 expect((await debug(page)).tick).toBe(before.tick);expect((await debug(page)).engine).toBe(false);
});

for(const action of ['Continue','Execute'] as const)test(`${action} coasts to a future planet SOI, retimes an overdue arrival and completes only its validated capture`,async({page})=>{
 await setup(page);const before=await debug(page);await openPanel(page,'fleet');
 const downloading=page.waitForEvent('download');await page.locator('#save-world').click();
 const kit=await packageContracts(),saved=await kit.decodeUniverseSave(new Uint8Array(await readFile(await(await downloading).path()))) as any;
 const system=saved.universe.systems.find((s:any)=>s.id===saved.systemId),destination=system.bodies.find((b:any)=>b.id==='ignis'),star=system.bodies.find((b:any)=>b.id==='star'),
  radius=destination.ephemeris.radius,phase=destination.ephemeris.phaseRadiansAtEpoch,omega=(destination.ephemeris.direction??1)*Math.sqrt(star.mu/(radius*radius*radius)),
  position=[radius*Math.cos(phase)-3000,radius*Math.sin(phase)+400],velocity=[-Math.sin(phase)*omega*radius+80,Math.cos(phase)*omega*radius];
 saved.tick=0;saved.time=0;saved.paused=true;
 const ship=saved.ships[0];Object.assign(ship,{bodyId:'star',position,velocity,heading:0,throttle:0,status:'flying',revision:0});delete ship.coast;
 saved.flightPlans={format:'space-sim-flight-plans/1',plans:[{shipId:ship.id,universeId:saved.universe.id,systemId:saved.systemId,fingerprint:before.fingerprint,motionIdentity:before.modelIdentity,bodyId:'star',epoch:{time:0,position:{x:position[0],y:position[1]},velocity:{x:velocity[0],y:velocity[1]},heading:0},nodes:[
  {id:'departure',label:'Departure',bodyId:'planet',time:0,prograde:50,radial:0,completed:true},
  {id:'arrival',label:'Arrival · Ignis',bodyId:'ignis',time:.1,prograde:-60,radial:6,targetOrbit:{periapsisAltitude:512,apoapsisAltitude:512}}]}]};
 await page.locator('#world-file').setInputFiles({name:'arrival-follow.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await expect(page.locator('#flight-message')).toContainText('Universe loaded');await closePanel(page);
 await expect.poll(async()=>(await debug(page)).body).toBe('star');
 await page.getByRole('button',{name:'Transfers',exact:true}).click();await page.locator('#maneuver-node-tab').click();
 if(action==='Execute')await page.locator('#maneuver-nodes').selectOption('arrival');
 const control=page.locator(action==='Continue'?'#maneuver-continue':'#maneuver-execute');
 await expect(control).toBeEnabled();if(action==='Execute')await expect(control).toHaveText('Coast to arrival and execute');await control.click();
 await expect.poll(async()=>(await debug(page)).body,{timeout:20000}).toBe('ignis');
 await expect(page.locator('#maneuver-status')).toContainText('Plan complete',{timeout:30000});
 await expect.poll(async()=>{const d=await debug(page);return {body:d.body,engine:d.engine,automatic:d.maneuver?.automatic,completed:d.maneuver?.completed};}).toEqual({body:'ignis',engine:false,automatic:false,completed:true});
 const done=await debug(page);expect(done.maneuver.time).toBeGreaterThan(.1);expect(done.orbit.kind).toBe('elliptic');
 await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#throttle-value')).toHaveText('0%');
});

test('a reverse-direction Moon transfer raises the orbit instead of wasting delta-v on a reversal',async({page})=>{
 await setup(page);await openPanel(page,'fleet');
 const downloading=page.waitForEvent('download');await page.locator('#save-world').click();
 const kit=await packageContracts(),saved=await kit.decodeUniverseSave(new Uint8Array(await readFile(await (await downloading).path()))) as any;
 saved.tick=7100;saved.time=71;
 for(const ship of saved.ships){ship.bodyId='planet';ship.position=[0,1024];ship.velocity=[-Math.sqrt(13107200/1024),0];ship.heading=Math.PI;ship.throttle=0;ship.status='flying';ship.revision=0;}
 delete saved.flightPlans;
 await page.locator('#world-file').setInputFiles({name:'reverse-orbit.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await expect(page.locator('#flight-message')).toContainText('Universe loaded');await closePanel(page);
 await expect.poll(async()=>{const d=await debug(page);return {tick:d.tick,alt:d.groundClearance,reverse:d.velocity.x<0};}).toEqual({tick:7100,alt:512,reverse:true});
 await page.getByRole('button',{name:'Transfers',exact:true}).click();await page.locator('#maneuver-transfer-local [data-destination="moon"]').click();await page.locator('#maneuver-transfer-low').fill('512');
 await page.locator('#maneuver-transfer-find').click();await expect(page.locator('#maneuver-transfer-use-efficient')).toBeEnabled({timeout:60000});
 await expect(page.locator('#maneuver-transfer-cancel')).toBeHidden({timeout:60000});
 const metrics=await page.locator('.transfer-option .transfer-metrics').first().textContent();expect(Number(/Δv ([\d.]+)/.exec(metrics!)![1])).toBeLessThan(100);
 await page.locator('#maneuver-transfer-use-efficient').click();await expect.poll(async()=>(await debug(page)).maneuver?.valid).toBe(true);
 expect(Number(await page.locator('#maneuver-prograde').inputValue())).toBeGreaterThan(0);
 expect((await debug(page)).tick).toBe(7100);expect((await debug(page)).engine).toBe(false);
});

for(const destinationId of ['moon','velum'] as const)for(const automatic of [false,true])test(`${destinationId} arrival correction and capture with automatic plan ${automatic}`,async({page})=>{
 await setup(page);const before=await debug(page);await openPanel(page,'fleet');
 const downloading=page.waitForEvent('download');await page.locator('#save-world').click();
 const kit=await packageContracts(),saved=await kit.decodeUniverseSave(new Uint8Array(await readFile(await(await downloading).path()))) as any;
 const system=saved.universe.systems.find((s:any)=>s.id===saved.systemId),destination=system.bodies.find((b:any)=>b.id===destinationId),parent=system.bodies.find((b:any)=>b.id===destination.parentId),
  radius=destination.ephemeris.radius,phase=destination.ephemeris.phaseRadiansAtEpoch,omega=(destination.ephemeris.direction??1)*Math.sqrt(parent.mu/(radius*radius*radius)),
  position=[radius*Math.cos(phase)-(destinationId==='moon'?3000:15000),radius*Math.sin(phase)+(destinationId==='moon'?600:3000)],
  velocity=[-Math.sin(phase)*omega*radius+80,Math.cos(phase)*omega*radius],altitude=destinationId==='moon'?100:512;
 saved.tick=0;saved.time=0;saved.paused=true;
 const ship=saved.ships[0];Object.assign(ship,{bodyId:parent.id,position,velocity,heading:0,throttle:0,status:'flying',revision:0});delete ship.coast;
 saved.flightPlans={format:'space-sim-flight-plans/1',plans:[{shipId:ship.id,universeId:saved.universe.id,systemId:saved.systemId,fingerprint:before.fingerprint,motionIdentity:before.modelIdentity,bodyId:parent.id,epoch:{time:0,position:{x:position[0],y:position[1]},velocity:{x:velocity[0],y:velocity[1]},heading:0},nodes:[
  {id:'departure',label:'Departure',bodyId:parent.id,time:0,prograde:50,radial:0,completed:true},
  {id:'arrival',label:`Arrival · ${destination.name}`,bodyId:destinationId,time:.1,prograde:-60,radial:6,targetOrbit:{periapsisAltitude:altitude,apoapsisAltitude:altitude}}]}]};
 await page.locator('#world-file').setInputFiles({name:'arrival-correction.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(saved))});
 await expect(page.locator('#flight-message')).toContainText('Universe loaded');await closePanel(page);
 await page.getByRole('button',{name:'Transfers',exact:true}).click();await page.locator('#maneuver-node-tab').click();
 await expect(page.locator('#maneuver-clear-plan')).toBeHidden();
 if(automatic){
  await page.locator('#maneuver-automatic').check();await page.locator('#maneuver-auto-warp').check();await page.locator('#pause').click();
 }else{
  await page.locator('#maneuver-continue').click();
  await expect(page.locator('#maneuver-nodes option:checked')).toContainText(`Correction · ${destination.name}`,{timeout:20000});
  await expect.poll(async()=>{const d=await debug(page);return {body:d.body,engine:d.engine,automatic:d.maneuver?.automatic,nodes:d.maneuver?.nodes};}).toEqual({body:destinationId,engine:false,automatic:false,nodes:3});
  await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
  await expect(page.locator('#maneuver-execute')).toBeEnabled();
  // The asynchronous review must retain the explanation for the handoff.
  await expect(page.locator('#maneuver-automatic-status')).toContainText('execute the correction separately');
  // Burn alarms can replace the transient toast; the explanation stays beside Auto.
  await page.locator('#maneuver-execute').click();
  await expect.poll(async()=>{const d=await debug(page);return d.maneuver?.selected==='arrival'&&!d.engine&&!d.maneuver.execution;},{timeout:20000}).toBe(true);
  expect((await debug(page)).maneuver.completed).toBe(false);await page.locator('#maneuver-continue').click();
 }
 await expect(page.locator('#maneuver-status')).toContainText('Plan complete',{timeout:30000});
 await expect.poll(async()=>{const d=await debug(page);return {body:d.body,engine:d.engine,orbit:d.orbit?.kind,nodes:d.maneuver?.nodes,completed:d.maneuver?.completed};}).toEqual({body:destinationId,engine:false,orbit:'elliptic',nodes:3,completed:true});
 await expect(page.locator('#warp-factor')).toHaveText('1×');await expect(page.locator('#throttle-value')).toHaveText('0%');
 await expect(page.locator('#maneuver-automatic')).not.toBeChecked();
 await expect(page.locator('#maneuver-nodes option')).toHaveText([/flown/,new RegExp(`Correction · ${destination.name}.*flown`),/flown/]);
 await expect(page.getByRole('button',{name:'Clear completed plan',exact:true})).toBeEnabled();
 if(await page.locator('#pause').textContent()==='Pause'){await page.locator('#pause').click();}
 await expect(page.locator('#status')).toHaveText('PAUSED');
 await page.waitForTimeout(100);
 const beforeClear=await debug(page);
 await page.getByRole('button',{name:'Clear completed plan',exact:true}).click();
 await expect.poll(async()=>(await debug(page)).maneuver).toBeNull();
 const afterClear=await debug(page);expect(afterClear.tick).toBe(beforeClear.tick);expect(afterClear.position).toEqual(beforeClear.position);expect(afterClear.velocity).toEqual(beforeClear.velocity);
 await expect(page.locator('#maneuver-clear-plan')).toBeHidden();await expect(page.locator('#maneuver-nodes option')).toHaveCount(0);
});

test('the production Transfer picker searches collapsed Solar System moons and keeps the destination visible in a short panel',async({page},info)=>{
 await setup(page);await openPanel(page,'setup');
 await page.locator('#universe-file').setInputFiles('games/space-sim/universes/astronomy/full-solar-system/universe.json');
 await page.locator('#preset').selectOption('earth-orbit');await closePanel(page);
 await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await expect(page.locator('#maneuver-transfer-context')).toContainText('Current body: Earth · parent: Sun');
 await page.locator('#maneuver-transfer-local [data-destination="moon"]').click();
 await expect(page.locator('#maneuver-transfer-picker details > summary')).toHaveText(['Local maneuvers','Interplanetary','Star']);
 await page.screenshot({path:info.outputPath('destination-local-earth.png')});
 await page.locator('#maneuver-transfer-change').click();
 await page.locator('#maneuver-transfer-browser summary').click();
 await page.locator('#maneuver-transfer-results [data-browse="jupiter"]').click();
 await page.locator('#maneuver-transfer-results [data-destination="europa"]').click();
 await expect(page.locator('#maneuver-transfer-destination')).toHaveText('Europa · Jupiter · Sun');
 await page.screenshot({path:info.outputPath('destination-system-browser.png')});
 await page.setViewportSize({width:390,height:560});
 await page.locator('#maneuver-transfer-change').click();
 await page.locator('#maneuver-transfer-query').fill('titan');
 await page.locator('#maneuver-transfer-matches [data-destination="titan"]').click();
 await expect(page.locator('#maneuver-transfer-destination')).toHaveText('Titan · Saturn · Sun');
 const geometry=await page.locator('#maneuver-window').evaluate(el=>{const panel=el.getBoundingClientRect(),body=el.querySelector('.flight-window-body')!.getBoundingClientRect(),selected=el.querySelector('#maneuver-transfer-destination')!.getBoundingClientRect();return{width:panel.width,overflow:el.scrollWidth-el.clientWidth,selectedTop:selected.top,bodyTop:body.top,selectedBottom:selected.bottom,bodyBottom:body.bottom};});
 expect(geometry.width).toBeLessThanOrEqual(390);expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.selectedTop).toBeGreaterThanOrEqual(geometry.bodyTop);expect(geometry.selectedBottom).toBeLessThanOrEqual(geometry.bodyBottom);
 await page.screenshot({path:info.outputPath('destination-search-narrow.png')});
 await page.locator('#maneuver-transfer-find').scrollIntoViewIfNeeded();await expect(page.locator('#maneuver-transfer-find')).toBeEnabled();
 await expect(page.locator('#maneuver-transfer-support')).toContainText('accepts this relationship');
});

test('Transfer layout fits narrow and wide panels with long names, expanded fields, validation and results',async({page},info)=>{
 await setup(page);await openPanel(page,'setup');
 const universe=JSON.parse(await readFile('games/space-sim/universes/sandbox/default/universe.json','utf8'));
 const longName='Primus with an exceptionally long destination name';
 universe.systems[0].bodies.find((body:any)=>body.id==='planet').name=longName;
 await page.locator('#universe-file').setInputFiles({name:'long-names.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(universe))});
 await page.locator('#preset').selectOption('planet-orbit');await closePanel(page);
 if(await page.locator('#pause').textContent()==='Pause')await page.locator('#pause').click();
 await page.getByRole('button',{name:'Transfers',exact:true}).click();
 const panel=page.locator('#maneuver-window'),chooser=page.locator('#maneuver-transfer-chooser'),change=page.locator('#maneuver-transfer-change');
 const fit=async()=>{
  const geometry=await panel.evaluate(el=>({overflow:el.scrollWidth-el.clientWidth,bodyOverflow:el.querySelector('.flight-window-body')!.scrollWidth-el.querySelector('.flight-window-body')!.clientWidth,inputs:[...el.querySelectorAll<HTMLInputElement>('#maneuver-transfers input:not([type="checkbox"])')].filter(input=>input.getClientRects().length).map(input=>({width:input.getBoundingClientRect().width,height:input.getBoundingClientRect().height}))}));
  expect(geometry.overflow).toBeLessThanOrEqual(1);expect(geometry.bodyOverflow).toBeLessThanOrEqual(1);
  for(const input of geometry.inputs){expect(input.width).toBeGreaterThan(60);expect(input.height).toBeGreaterThanOrEqual(32);}
 };
 for(const width of [310,520]){
  await page.setViewportSize({width:width===310?390:1100,height:width===310?660:900});
  const bounds=(await panel.boundingBox())!;
  await page.mouse.move(bounds.x+bounds.width-3,bounds.y+bounds.height/2);await page.mouse.down();
  await page.mouse.move(bounds.x+width-3,bounds.y+bounds.height/2);await page.mouse.up();
  await expect.poll(async()=>(await panel.boundingBox())!.width).toBe(width);
  if(await change.getAttribute('aria-expanded')==='false')await change.click();
  await page.locator('#maneuver-transfer-browser summary').evaluate(el=>{(el.parentElement as HTMLDetailsElement).open=true;});
  await fit();await page.screenshot({path:info.outputPath(`transfer-${width}-browse.png`)});
  await page.locator('#maneuver-transfer-local [data-destination="planet"]').click();
  await expect(chooser).toBeHidden();await expect(change).toBeFocused();
  await expect(page.locator('#maneuver-transfer-destination')).toContainText(`${longName} · Lumen`);
  await page.locator('.flight-window-body').filter({has:page.locator('#maneuver-transfers')}).evaluate(el=>{el.scrollTop=0;});
  await page.screenshot({path:info.outputPath(`transfer-${width}-selected.png`)});
  await page.locator('#maneuver-transfer-circular').uncheck();
  await page.locator('#maneuver-transfer-low').fill('768');await page.locator('#maneuver-transfer-high').fill('1024');
  await page.getByText('About target altitude',{exact:true}).click();await page.getByText('How timing affects search',{exact:true}).click();
  await fit();await page.screenshot({path:info.outputPath(`transfer-${width}-expanded.png`)});
  await page.getByText('About target altitude',{exact:true}).click();await page.getByText('How timing affects search',{exact:true}).click();
  const searchFits=await panel.evaluate(el=>{
   const body=el.querySelector('.flight-window-body')!;body.scrollTop=0;
   return el.querySelector('#maneuver-transfer-find')!.getBoundingClientRect().bottom<=body.getBoundingClientRect().bottom;
  });
  expect(searchFits).toBe(true);
  await page.locator('#maneuver-transfer-years').fill('101');await page.locator('#maneuver-transfer-find').click();
  await expect(page.locator('#maneuver-transfer-status')).toContainText('100 Julian years');await fit();
  await page.screenshot({path:info.outputPath(`transfer-${width}-validation.png`)});
  await page.locator('#maneuver-transfer-years').fill('50');await page.locator('#maneuver-transfer-find').click();
  await expect(page.locator('#maneuver-transfer-use-efficient')).toBeEnabled();
  await expect(page.locator('.transfer-option').first()).toContainText('Δv');
  await page.locator('.transfer-option details summary').first().click();await fit();
  await page.locator('.transfer-option').first().scrollIntoViewIfNeeded();
  await page.screenshot({path:info.outputPath(`transfer-${width}-results.png`)});
  await page.locator('#maneuver-transfer-years').fill('20');await expect(page.locator('.transfer-option')).toHaveCount(0);
 }
 // Escape dismisses browsing without discarding orbit or timing edits.
 await change.click();await page.locator('#maneuver-transfer-query').press('Escape');await expect(chooser).toBeHidden();await expect(change).toBeFocused();
 await expect(page.locator('#maneuver-transfer-low')).toHaveValue('768');await expect(page.locator('#maneuver-transfer-high')).toHaveValue('1024');await expect(page.locator('#maneuver-transfer-years')).toHaveValue('20');
 expect((await debug(page)).engine).toBe(false);
});

for(const follow of [false,true])test(`a background ship alarm ${follow?'selects and follows its ship when enabled':'leaves selection and camera alone by default'}`,async({page},info)=>{
 await setup(page);await place(page);const first=(await debug(page)).ship;
 await page.locator('#maneuver-time').fill('30');await page.locator('#maneuver-time').press('Tab');await page.locator('#maneuver-prograde').fill('1');
 await page.locator('#maneuver-alarms summary').click();const focus=page.locator('#maneuver-alarms [data-alarm="focus"]');await expect(focus).not.toBeChecked();if(follow)await focus.check();
 await page.locator('#maneuver-alarms [data-alarm="pause"]').check();
 await openPanel(page,'fleet');await page.getByRole('button',{name:'Launch another',exact:true}).click();await expect.poll(async()=>(await debug(page)).ship).not.toBe(first);
 const second=(await debug(page)).ship;await closePanel(page);
 // A background alarm must actively restore follow mode, not merely retain a
 // camera that was already following the alarm's ship.
 if((await debug(page)).camera.mode!=='free')await page.locator('#camera').click();
 await expect.poll(async()=>(await debug(page)).camera.mode).toBe('free');
 if((await page.locator('#pause').textContent())==='Resume')await page.locator('#pause').click();
 await expect(page.locator('#pause')).toHaveText('Pause');
 // The warp button stays disabled until the host UI syncs after resuming (slow in WebKit), and a click on a disabled button is dropped.
 for(let i=0;i<5;i++){const up=page.locator('#warp-up');await expect(up).toBeEnabled();await up.click();}
 await expect(page.locator('#pause')).toHaveText('Resume',{timeout:20000});
 await expect.poll(async()=>(await debug(page)).ship).toBe(follow?first:second);
 const after=await debug(page);expect(after.camera.mode).toBe(follow?'follow':'free');expect(after.engine).toBe(false);expect(after.maneuver?.execution??null).toBeNull();
 if(follow){
  await expect(page.locator('#maneuver-alarms [data-alarm="focus"]')).toBeChecked();
  await page.screenshot({path:info.outputPath('alarm-select-follow.png')});
 }
});


test('a distant moon route exposes every stop and burn; mission-time edits discard adoptable results in a narrow panel',async({page},info)=>{
 // Four sequential Nix searches share frames with software painting, which scales with canvas area: run the
 // whole test in the narrow panel (about 3.5x faster first search in headless Chromium) and allow loaded runners.
 test.setTimeout(480000);await page.setViewportSize({width:390,height:560});await setup(page);await page.getByRole('button',{name:'Transfers',exact:true}).click();
 await page.locator('#maneuver-transfer-query').fill('Nix');await page.locator('#maneuver-transfer-matches [data-destination="nix"]').focus();await page.keyboard.press('Enter');
 await page.locator('#maneuver-transfer-low').fill('100');await page.locator('#maneuver-transfer-find').click();
 const use=page.locator('#maneuver-transfer-use-efficient');await expect(use).toBeEnabled({timeout:180000});
 const before=await debug(page),stale=await use.elementHandle();
 await expect(page.locator('.transfer-route').first()).toContainText('Nix');await expect(page.locator('.transfer-option').first()).toContainText(/burns/);
 await page.locator('.transfer-option').first().evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('end-to-end-route-narrow.png')});
 await page.locator('.transfer-option details summary').first().click();await expect(page.locator('.transfer-option details').first()).toContainText('Capture · Nix');
 await page.locator('.transfer-option').first().evaluate(el=>el.scrollIntoView({block:'start'}));await page.screenshot({path:info.outputPath('end-to-end-burns-narrow.png')});
 await page.locator('#maneuver-transfer-years').fill('20');await expect(use).toHaveCount(0);
 await stale!.evaluate(el=>(el as HTMLButtonElement).click());expect((await debug(page)).maneuver).toBeNull();expect((await debug(page)).tick).toBe(before.tick);
 const parking=page.locator('#maneuver-transfer-high-parking');await expect(parking).toBeChecked();
 await page.locator('#maneuver-transfer-find').click();await expect(use).toBeEnabled({timeout:180000});
 // Parking choice is a search input: changing it discards results, both settings search.
 await parking.uncheck();await expect(use).toHaveCount(0);await expect(page.locator('#maneuver-transfer-status')).toContainText('Parking stops changed');
 await page.locator('#maneuver-transfer-find').click();await expect(use).toBeEnabled({timeout:180000});
 await parking.check();await expect(use).toHaveCount(0);
 await page.locator('#maneuver-transfer-find').click();await expect(use).toBeEnabled({timeout:180000});await use.click();
 await expect.poll(async()=>(await debug(page)).maneuver?.valid,{timeout:30000}).toBe(true);
 await expect(page.locator('#maneuver-nodes option').last()).toContainText('Capture · Nix');expect((await debug(page)).engine).toBe(false);
 await page.screenshot({path:info.outputPath('end-to-end-adopted.png')});
});
