// npm run build && npm run measure:modules -- [--out=test-results/module-baseline.json] [--browsers=chromium,firefox,webkit]
// Reuses production World/ghost, the seeded fleet generator and existing browser profiler.
import { build } from 'rolldown';
import { chromium, firefox, webkit } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, totalmem } from 'node:os';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const options = new Map(process.argv.slice(2).map(arg => {
  const at = arg.indexOf('=');
  if (at < 0 || !['--out', '--browsers'].includes(arg.slice(0, at))) throw new Error(`Unknown option: ${arg}`);
  return [arg.slice(0, at), arg.slice(at + 1)];
}));
const names = (options.get('--browsers') ?? 'chromium,firefox,webkit').split(',');
for (const name of names) if (!({ chromium, firefox, webkit })[name]) throw new Error(`Unknown browser: ${name}`);
const out = options.get('--out') ?? 'test-results/module-baseline.json';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const artifact = resolve('dist/space-lab-offline.html');
const artifactSha256 = sha(await readFile(artifact)); // require an explicit production build first
const inputPaths = [];
async function collect(path) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const next = `${path}/${entry.name}`;
    if (entry.isDirectory()) await collect(next);
    else if (entry.isFile()) inputPaths.push(next);
  }
}
for (const dir of ['apps', 'packages', 'games', 'examples', 'scripts', 'tests', 'modules']) await collect(dir);
inputPaths.push('package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'vite.server.config.ts');
const inputs = [];
for (const path of inputPaths.sort()) inputs.push({ path, sha256: sha(await readFile(path)) });
const metadata = {
  measuredAt: new Date().toISOString(), revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  workingTree: execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim(),
  sourceInputsSha256: sha(JSON.stringify(inputs)), inputs, artifactSha256,
  node: process.version, platform: platform(), kernel: release(), cpu: cpus()[0]?.model,
  logicalCpus: cpus().length, totalMemoryBytes: totalmem(),
};
const file = resolve('test-results/stress-build/module-baseline.mjs');
await build({ input: resolve('scripts/stress/module-baseline.ts'), platform: 'node', logLevel: 'warn',
  output: { file, format: 'esm' } });
const headless = JSON.parse(execFileSync(process.execPath, ['--expose-gc', file], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }));
const motionFile = resolve('test-results/stress-build/motion-providers.mjs');
await build({ input: resolve('scripts/stress/motion-providers.ts'), platform: 'node', logLevel: 'warn',
  output: { file: motionFile, format: 'esm' } });
const motionProviders = JSON.parse(execFileSync(process.execPath, ['--expose-gc', motionFile], { encoding: 'utf8' }));
const browsers = [];
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
for (const name of names) {
  let browser;
  try { browser = await ({ chromium, firefox, webkit })[name].launch(); }
  catch (error) { browsers.push({ browser: name, status: 'unavailable', error: String(error) }); continue; }
  try {
    const coldLoadMs = [], errors = [], networkRequests = [];
    let metrics, gl, traceMs;
    for (let trial = 0; trial < 3; trial++) {
      const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, offline: true });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(15000);
        page.setDefaultNavigationTimeout(15000);
        page.on('pageerror', error => errors.push(String(error)));
        page.on('request', request => { if (/^https?:/.test(request.url())) networkRequests.push(request.url()); });
        const start = performance.now();
        await page.goto(pathToFileURL(artifact).href);
        await page.waitForFunction(() => document.querySelector('#status')?.textContent === 'LANDED');
        coldLoadMs.push(performance.now() - start);
        if (trial !== 2) continue;
        gl = await page.evaluate(() => {
          const context = document.createElement('canvas').getContext('webgl2');
          const ext = context?.getExtension('WEBGL_debug_renderer_info');
          return context ? String(context.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : context.RENDERER)) : 'none';
        });
        await page.locator('[data-workspace="setup"]').click();
        const traceStart = performance.now();
        await page.locator('#preset').selectOption('planet-orbit');
        await page.waitForFunction(() => JSON.parse(document.querySelector('#debug').textContent || '{}').predictionEnd === 'closed');
        traceMs = performance.now() - traceStart;
        await page.locator('#setup-window [data-window-close]').click();
        // The existing profiler keeps 600 frames. Same 12-second observation as measure_browser.mjs.
        await page.waitForTimeout(12000);
        metrics = JSON.parse(await page.locator('#debug').textContent());
      } finally { await context.close(); }
    }
    if (errors.length || networkRequests.length) throw new Error(JSON.stringify({ errors, networkRequests }));
    browsers.push({ browser: name, status: 'measured', version: browser.version(), gl,
      viewport: '1920x1080', dpr: 1, scenario: 'default pad cold load, then planet-orbit at warp 1',
      coldLoadMs: { trials: coldLoadMs, median: percentile(coldLoadMs, .5) },
      firstClosedPredictionWallMs: traceMs, metrics, errors, networkRequests });
  } catch (error) { browsers.push({ browser: name, status: 'failed', error: String(error) }); }
  finally { await browser.close(); }
}
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify({ ...metadata,
  caveat: 'Local desktop headless baseline, not release qualification. Fresh browser contexts with a warm OS file cache; automation overhead included in cold-load/first-trace wall times. Missing engines are recorded, not passed.',
  headless, motionProviders, browsers }, null, 2) + '\n');
console.log(`Wrote ${out}; browsers: ${browsers.map(b => `${b.browser}=${b.status}`).join(', ')}`);
if (browsers.some(b => b.status !== 'measured')) process.exitCode = 1;
