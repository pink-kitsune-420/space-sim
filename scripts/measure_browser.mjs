import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { cpus, platform, release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const names = process.argv.slice(2);
const results = [];
for (const name of names.length ? names : ['chromium', 'firefox']) {
  const type = { chromium, firefox, webkit }[name];
  if (!type) throw new Error(`Unknown browser ${name}`);
  const browser = await type.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, offline: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve('dist/space-sim-offline.html')).href);
    await page.locator('#preset').selectOption('planet-orbit');
    await page.waitForFunction(() => JSON.parse(document.querySelector('#debug').textContent || '{}').samples > 5000);
    await page.waitForTimeout(12000);
    const metrics = JSON.parse(await page.locator('#debug').textContent());
    results.push({ browser: name, version: browser.version(), viewport: '1920×1080',
      scenario: 'planet-orbit', entities: '1 vessel + 1 planet', warp: 1, horizonSeconds: 60,
      cache: 'warm; 12 s after first prediction', metrics });
    await page.screenshot({ path: `test-results/desktop-${name}.png`, fullPage: true });
  } finally { await browser.close(); }
}
const report = { measuredAt: new Date().toISOString(), platform: platform(), kernel: release(),
  cpu: cpus()[0]?.model, mode: 'headless; local standalone HTML; networking disabled',
  caveat: 'Single desktop run, not a real mobile-device or release performance qualification.', results };
await mkdir('docs/measurements', { recursive: true });
await writeFile('docs/measurements/m1-desktop.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
