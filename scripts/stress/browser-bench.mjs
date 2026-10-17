// Browser frame-time benchmark for the built offline game (dist/space-lab-offline.html).
// Loads a universe, optionally runs the in-game stress test, steps the zoom out, and
// reads the game's own profiler from the #debug panel.
//
// Usage: node scripts/stress/browser-bench.mjs [--universe=full-solar-system] [--preset=earth-orbit]
//          [--zooms=0,20,40,60,80,100] [--seconds=4] [--stress=ships:asteroids] [--burn]
//          [--renderer=webgl|canvas2d] [--browser=chromium|firefox] [--headed] [--out=file.json]
//          [--shots=dir]
import { chromium, firefox } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = new Map(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? 'true']; }));
const universe = args.get('universe') ?? 'full-solar-system';
const presetId = args.get('preset');
const zooms = (args.get('zooms') ?? '0,30,60,90').split(',').map(Number);
const seconds = Number(args.get('seconds') ?? 11);
const stress = args.get('stress');
const shots = args.get('shots');
const browserType = { chromium, firefox }[args.get('browser') ?? 'chromium'];
if (shots) mkdirSync(shots, { recursive: true });

const browser = await browserType.launch({ headless: !args.has('headed'),
  args: args.get('browser') === 'firefox' ? [] : ['--enable-gpu-rasterization', '--ignore-gpu-blocklist'] });
const results = [];
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  // --url targets a running dev server (readable function names in CPU profiles).
  await page.goto(args.get('url') ?? pathToFileURL(resolve('dist/space-lab-offline.html')).href);
  const gl = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    return c ? String(c.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : c.RENDERER)) : 'none';
  });
  if (args.get('renderer') === 'canvas2d') await page.locator('#renderer-toggle').click();
  if (universe !== 'default-universe') await page.locator('#universe-select').selectOption(universe);
  if (presetId) await page.locator('#preset').selectOption(presetId);
  if (stress) {
    const [ships, asteroids] = stress.split(':').map(Number);
    await page.evaluate(([s, a, burn]) => window.spaceSimStress?.({ ships: s, asteroids: a, burn }),
      [ships, asteroids ?? 0, args.has('burn')]);
  }
  // The profiler table only updates while its panel is open.
  await page.locator('#profiler-toggle').click();
  // Resume if the page paused itself while loading (blur/visibility).
  if ((await page.locator('#status').textContent()) === 'PAUSED') await page.locator('#pause').click();
  let pressed = 0;
  const cdp = args.get('cpuprofile') ? await context.newCDPSession(page) : undefined;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }
  for (const target of zooms) {
    // Keys only reach the game from the canvas (not from a focused button).
    await page.locator('#flight-view').focus();
    for (; pressed < target; pressed++) await page.keyboard.press('Minus');
    // The profiler keeps the last 600 frames; wait long enough to measure only this zoom.
    if (cdp) await cdp.send('Profiler.start');
    await page.waitForTimeout(seconds * 1000);
    if (cdp) {
      const { profile } = await cdp.send('Profiler.stop');
      writeFileSync(args.get('cpuprofile').replace(/(\.cpuprofile)?$/, `-zoom${pressed}.cpuprofile`), JSON.stringify(profile));
    }
    const debug = JSON.parse(await page.locator('#debug').textContent() || '{}');
    const fps = await page.locator('#profiler-fps').textContent();
    const rows = Object.fromEntries((await page.locator('#profiler-rows tr').allTextContents()).map(t => [t.split(/\d/)[0], t]));
    const row = { zoomSteps: pressed, scale: debug.camera?.scale, body: debug.body, ships: debug.ships, asleep: debug.asleep,
      fleetView: debug.fleetView, fps,
      workP50Ms: debug.workP50Ms, workP95Ms: debug.workP95Ms, workWorstMs: debug.workWorstMs,
      simulationP95Ms: debug.simulationP95Ms, predictionP95Ms: debug.predictionP95Ms, renderP95Ms: debug.renderP95Ms,
      intervalP95Ms: debug.intervalP95Ms, slowFrames: debug.slowFrames, steps: debug.steps, droppedSeconds: debug.droppedSeconds,
      sections: rows };
    results.push(row);
    console.log(JSON.stringify(row));
    if (shots) await page.screenshot({ path: `${shots}/zoom-${pressed}.png` });
  }
  const heap = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null);
  const report = { measuredAt: new Date().toISOString(), browser: browser.version(), gl, universe, presetId, stress,
    renderer: args.get('renderer') ?? 'webgl', heapMiB: heap, errors, results };
  if (args.get('out')) writeFileSync(args.get('out'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ gl, heapMiB: heap, errors }));
} finally {
  await browser.close();
}
