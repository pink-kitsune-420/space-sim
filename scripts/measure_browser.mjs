import { chromium, firefox, webkit } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { cpus, platform, release } from 'node:os';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

// Usage: node scripts/measure_browser.mjs [--out=private-docs/measurements/<name>.json] [chromium|firefox|webkit ...]
const out = process.argv.find(arg => arg.startsWith('--out='))?.slice(6) ?? 'private-docs/measurements/m2-desktop.json';
const names = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const results = [];
for (const name of names.length ? names : ['chromium', 'firefox']) {
  const type = { chromium, firefox, webkit }[name];
  if (!type) throw new Error(`Unknown browser ${name}`);
  const browser = await type.launch();
  try {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, offline: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(resolve('dist/space-lab-offline.html')).href);
    await page.locator('[data-workspace="setup"]').click();
    await page.locator('#preset').selectOption('planet-orbit');
    await page.locator('#setup-window [data-window-close]').click();
    await page.waitForFunction(() => JSON.parse(document.querySelector('#debug').textContent || '{}').predictionEnd === 'closed');
    await page.waitForTimeout(12000);
    const metrics = JSON.parse(await page.locator('#debug').textContent());
    results.push({ browser: name, version: browser.version(), viewport: '1920×1080',
      scenario: 'planet-orbit', entities: '1 vessel + 1 planet', warp: 1, prediction: 'ghost, one revolution',
      cache: 'warm; 12 s after the first completed trace', metrics });
    await page.screenshot({ path: `test-results/desktop-${name}.png`, fullPage: true });
  } finally { await browser.close(); }
}
const report = { measuredAt: new Date().toISOString(), platform: platform(), kernel: release(),
  artifactSha256: createHash('sha256').update(await readFile('dist/space-lab-offline.html')).digest('hex'),
  cpu: cpus()[0]?.model, mode: 'headless; local standalone HTML; networking disabled',
  caveat: 'Single desktop run, not a real mobile-device or release performance qualification.', results };
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
