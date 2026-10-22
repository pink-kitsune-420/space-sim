#!/usr/bin/env node
/** Local production rendering evidence. See --help; no runtime game dependencies. */
import { chromium, firefox, webkit, expect } from '@playwright/test';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpus, platform, release, loadavg, freemem } from 'node:os';
import { validateProtocol, validateWindow, validateBackend, artifactManifest, verifyServed, exportedSections, distribution, validateBuildProof, MAX_SAMPLES } from './lib/render-performance.mjs';
import { installRenderProbe, gpuDrawSpans } from './lib/render-probe.mjs';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const match = /^--(protocol|out|cases|resume|probe-only|help)(?:=(.*))?$/.exec(arg);
  if (!match || args.has(match[1])) throw Error(`Unknown/duplicate argument: ${arg}`);
  if (['protocol', 'out', 'cases'].includes(match[1]) ? !match[2] : match[2] !== undefined) throw Error(`Invalid argument value: ${arg}`);
  args.set(match[1], match[2] ?? true);
}
if (args.has('help')) {
  console.log('node scripts/measure_render_performance.mjs --protocol=PATH [--out=private-docs/measurements/render-performance] [--cases=id,id] [--resume] [--probe-only]\nProtocol schema space-sim.render-protocol/1; two >=30s bare windows. Probe-only is instrumented smoke evidence, never cadence qualification. Local HTTP production server required.');
  process.exit(0);
}
if (typeof args.get('protocol') !== 'string') throw Error('--protocol=PATH is required');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const protocolPath = resolve(args.get('protocol')), rawProtocol = await readFile(protocolPath);
const protocol = validateProtocol(JSON.parse(rawProtocol)), out = resolve(args.get('out') || 'private-docs/measurements/render-performance');
const only = args.has('cases') ? new Set(String(args.get('cases')).split(',')) : undefined;
const cases = protocol.cases.filter(c => !only || only.has(c.id));
if (!cases.length || only && cases.length !== only.size) throw Error('Requested case ID is missing');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = await artifactManifest(resolve(root, protocol.distDir));
await verifyServed(artifacts, protocol.baseURL);
const source = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  trackedDiffSha256: hash(execFileSync('git', ['diff', '--binary', 'HEAD'], { cwd: root })), files: {} };
const changedPaths = new Set([...execFileSync('git', ['diff', '--name-only', '-z', 'HEAD'], { cwd: root, encoding: 'utf8' }).split('\0'),
  ...execFileSync('git', ['ls-files', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' }).split('\0')].filter(Boolean));
for (const path of changedPaths) {
  try { source.files[path] = hash(await readFile(join(root, path))); }
  catch (error) { if (error.code !== 'ENOENT') throw error; source.files[path] = null; }
}
source.runtimeCouplingVerified = protocol.buildProof ? validateBuildProof(JSON.parse(await readFile(resolve(root, protocol.buildProof), 'utf8')), source, artifacts) : false;
source.scope = source.runtimeCouplingVerified ? 'Production artifact/source coupling verified against build proof' : 'Worktree snapshot only; artifact/source coupling is not verified';
const harness = {};
for (const path of ['scripts/measure_render_performance.mjs', 'scripts/lib/render-performance.mjs', 'scripts/lib/render-probe.mjs']) harness[path] = hash(await readFile(join(root, path)));
const identity = hash(JSON.stringify({ protocol: hash(rawProtocol), cases: cases.map(c => c.id), artifacts, harness, probeOnly: args.has('probe-only') }));
await mkdir(out, { recursive: true });
const reportPath = join(out, 'measurements.json');
let report = { schema: 'space-sim.render-evidence/1', identity, protocol, protocolSha256: hash(rawProtocol), source, artifacts, harness,
  startedAt: new Date().toISOString(), host: { cpu: cpus()[0]?.model, os: `${platform()} ${release()}` },
  kind: args.has('probe-only') ? 'instrumented-smoke-only' : 'bare-and-separate-probes', rows: [] };
if (args.has('resume')) {
  report = JSON.parse(await readFile(reportPath));
  if (report.identity !== identity) throw Error('Resume identity differs: preserve earlier evidence and use another output directory');
}
async function save() { const temp = reportPath + '.tmp'; await writeFile(temp, JSON.stringify(report, null, 2) + '\n'); await rename(temp, reportPath); }
const debug = async page => JSON.parse(await page.locator('#debug').textContent() || '{}');
const metadata = () => ({ utc: new Date().toISOString(), load: loadavg(), freeBytes: freemem() });
async function contextFor(browser, c, instrumented) {
  const context = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: c.dpr, acceptDownloads: true });
  if (instrumented) await context.addInitScript(installRenderProbe, { ablation: c.diagnostic });
  await context.addInitScript(c => {
    localStorage.setItem('space-sim.graphics/1', c.graphics);
    localStorage.setItem('space-sim:theme:v5', JSON.stringify({ backdropStyle: 'void', starsVisible: false, nebulaVisible: false,
      galaxiesVisible: false, gridEnabled: false, shaderSeed: 123456 }));
    localStorage.setItem('space-sim:local-players:v1', JSON.stringify({ count: c.views, screenMode: 'split' }));
    if (c.backend === 'canvas') { const fn = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = new Proxy(fn, { apply(target, self, a) { return String(a[0]).startsWith('webgl') ? null : Reflect.apply(target, self, a); } }); }
  }, c);
  const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message)); page.setDefaultTimeout(30000);
  await page.goto(`${protocol.baseURL}/?game=${c.game === 'classic' ? 'space-sim' : 'space-sim-successor'}`);
  await expect(page.locator('#status')).toHaveText('LANDED');
  await page.evaluate(c => {
    const set = (id, value) => { const e = document.getElementById(id); if (!e) throw Error(`Missing control ${id}`); e.value = String(value); e.dispatchEvent(new Event('change', { bubbles: true })); };
    set('preset', c.preset);
    if (c.game === 'successor') { set('successor-tile-size', c.tiles); set('successor-air-mode', c.air); }
    for (const button of document.querySelectorAll('.panel-window:not([hidden]) [data-window-close]')) button.click();
    document.getElementById('pause').click();
  }, c);
  await expect(page.locator('#status')).toHaveText('PAUSED'); await page.waitForTimeout(350);
  if (c.camera === 'overview') await page.locator('#camera').click();
  for (let i = 0; i < Math.abs(c.zoomSteps); i++) await page.locator(c.zoomSteps > 0 ? '#zoom-in' : '#zoom-out').click();
  for (let i = 0; i < Math.abs(c.rotationSteps); i++) await page.locator(c.rotationSteps > 0 ? '#camera-rotate-right' : '#camera-rotate-left').click();
  if (c.panXMetres || c.panYMetres || c.camera === 'motion') {
    await page.locator('#flight-view').evaluate((canvas, c) => {
      const d = JSON.parse(document.querySelector('#debug').textContent), r = canvas.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      const a = { pointerId: 47, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, bubbles: true };
      canvas.dispatchEvent(new PointerEvent('pointerdown', { ...a, clientX: x, clientY: y }));
      canvas.dispatchEvent(new PointerEvent('pointermove', { ...a, clientX: x - (c.panXMetres || .1) * d.camera.scale, clientY: y + c.panYMetres * d.camera.scale }));
      canvas.dispatchEvent(new PointerEvent('pointercancel', { ...a, clientX: x, clientY: y, buttons: 0 }));
    }, c);
  }
  if (c.camera === 'motion') await page.evaluate(() => { let sign = 1; window.__renderMotion = setInterval(() => {
    document.querySelector(sign > 0 ? '#camera-rotate-right' : '#camera-rotate-left').click(); sign *= -1;
  }, 2000); });
  await page.waitForTimeout(protocol.warmupMs);
  const diagnostics = await debug(page);
  const actual = await page.evaluate(() => {
    const d = JSON.parse(document.querySelector('#debug').textContent), canvas = document.querySelector('#flight-view');
    const gl = d.renderer === 'builtin.webgl' ? canvas.getContext('webgl2') : null, ext = gl?.getExtension('WEBGL_debug_renderer_info');
    return { renderer: d.renderer, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null,
      userAgent: navigator.userAgent, dpr: window.devicePixelRatio, canvas: [canvas.clientWidth, canvas.clientHeight] };
  });
  validateBackend(c.backend, actual);
  if (c.camera === 'overview' && c.game === 'successor' && diagnostics.successorTiles.fineRequests !== 0) throw Error('Overview requested fine terrain');
  if (c.game === 'successor' && c.tiles && c.camera !== 'overview' && !c.panXMetres && !c.panYMetres && diagnostics.successorTiles.visibleChunks <= 0) throw Error('Expected complete local fine coverage');
  if (!c.preset.includes('orbit') && Math.abs(diagnostics.groundClearance) > 1e-6) throw Error('Physical contact changed in the measurement fixture');
  if (errors.length) throw Error(errors.join('\n'));
  return { context, page, errors, diagnostics, actual };
}
async function exportSections(page, path, windows) {
  const pending = page.waitForEvent('download');
  await page.evaluate(() => document.getElementById('export-log').click());
  const download = await pending; await download.saveAs(path);
  const log = JSON.parse(await readFile(path, 'utf8'));
  return exportedSections(log, windows[0].startMs, windows.at(-1).endMs);
}
async function bareWindow(page) {
  return page.evaluate(({ duration, cap }) => new Promise((done, reject) => {
    const intervals = []; let start, previous;
    function frame(t) {
      start ??= t; if (previous !== undefined) intervals.push(t - previous); previous = t;
      if (intervals.length > cap) { reject(Error('Cadence sample limit exceeded')); return; }
      if (t - start >= duration) done({ startMs: start, endMs: t, frames: intervals.length, intervals });
      else requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }), { duration: protocol.windowMs, cap: MAX_SAMPLES });
}
for (const c of cases) {
  if (report.rows.some(r => r.id === c.id && r.status === 'passed')) continue;
  const before = metadata(), launch = c.backend === 'hardware' ? { args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist'] }
    : c.backend === 'software' ? { args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] } : {};
  let browser;
  const row = { id: c.id, case: c, launch, before, windows: [], status: 'running' };
  try {
    browser = await ({ chromium, firefox, webkit }[c.browser]).launch({ headless: true, ...launch }); row.browserVersion = browser.version();
    if (!args.has('probe-only')) {
      const view = await contextFor(browser, c, false);
      row.bareActual = view.actual; row.bareDiagnostics = view.diagnostics;
      for (let i = 0; i < 2; i++) {
        const window = await bareWindow(view.page), summary = validateWindow(window, protocol.windowMs);
        await writeFile(join(out, `${c.id}-window${i}.json`), JSON.stringify(window) + '\n'); row.windows.push(summary);
        console.log(JSON.stringify({ event: 'bare-window', id: c.id, index: i, ...summary }));
      }
      row.sections = await exportSections(view.page, join(out, `${c.id}-sections.json`), row.windows);
      if (view.errors.length) throw Error(view.errors.join('\n')); await view.context.close();
    }
    const view = await contextFor(browser, c, true); row.probeActual = view.actual;
    const cdp = c.browser === 'chromium' ? await view.context.newCDPSession(view.page) : undefined;
    if (cdp) await cdp.send('Performance.enable');
    const layoutBefore = cdp ? await cdp.send('Performance.getMetrics') : undefined;
    await view.page.evaluate(() => window.__spaceSimRenderProbe.start());
    await view.page.waitForTimeout(protocol.probeMs);
    row.counters = await view.page.evaluate(() => window.__spaceSimRenderProbe.stop());
    const layoutAfter = cdp ? await cdp.send('Performance.getMetrics') : undefined;
    row.layoutMetrics = layoutBefore ? Object.fromEntries(['LayoutCount', 'RecalcStyleCount', 'LayoutDuration', 'RecalcStyleDuration', 'ScriptDuration', 'TaskDuration'].map(name => [name,
      layoutAfter.metrics.find(m => m.name === name)?.value - layoutBefore.metrics.find(m => m.name === name)?.value])) : null;
    if (row.counters.overflow) throw Error('Instrumentation resource limit exceeded');
    const end = await view.page.evaluate(() => performance.now());
    row.probeSections = await exportSections(view.page, join(out, `${c.id}-probe-sections.json`), [{ startMs: end - row.counters.durationMs, endMs: end }]);
    if (c.backend !== 'canvas') {
      await view.page.evaluate(() => window.__spaceSimRenderProbe.start());
      row.gpu = await view.page.evaluate(gpuDrawSpans, protocol.probeMs);
      await view.page.evaluate(() => window.__spaceSimRenderProbe.stop());
      row.gpuSummary = row.gpu.samples.length ? distribution(row.gpu.samples) : null;
    } else row.gpu = { supported: false, reason: 'Canvas GPU queue timing is not exposed by this harness' };
    if (cdp) {
      await view.page.evaluate(() => window.__spaceSimRenderProbe.start());
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); await view.page.waitForTimeout(protocol.probeMs);
      const profile = (await cdp.send('Profiler.stop')).profile; await cdp.send('Profiler.disable');
      await view.page.evaluate(() => window.__spaceSimRenderProbe.stop());
      await writeFile(join(out, `${c.id}-cpu.json`), JSON.stringify(profile) + '\n');
      await cdp.send('HeapProfiler.collectGarbage'); row.heapAfterGC = await cdp.send('Runtime.getHeapUsage'); await cdp.detach();
    }
    row.diagnostics = await debug(view.page); row.errors = view.errors;
    if (view.errors.length) throw Error(view.errors.join('\n'));
    await view.page.screenshot({ path: join(out, `${c.id}.png`) });
    await view.page.evaluate(() => window.__spaceSimRenderProbe.restore()); await view.context.close();
    row.status = 'passed'; row.evidenceScope = c.diagnostic === 'none' ? 'Measured control; target budgets assessed separately' : 'Instrumented visual ablation only; not pixel or release qualification';
  } catch (error) {
    row.status = /identity unavailable|Requested .*observed|not active|Executable doesn't exist|browserType.launch|Failed to launch/i.test(error.message) ? 'unavailable' : 'failed'; row.error = error.stack ?? String(error);
  } finally { await browser?.close(); }
  row.after = metadata(); report.rows = report.rows.filter(r => r.id !== c.id); report.rows.push(row); await save();
  console.log(JSON.stringify({ event: 'case', id: c.id, status: row.status, complete: report.rows.length, error: row.error }));
}
report.finishedAt = new Date().toISOString(); report.complete = report.rows.length === cases.length;
report.collectionValidated = report.complete && report.rows.every(r => r.status === 'passed') && !args.has('probe-only');
report.releaseQualified = false; report.acceptance = 'Evidence collection only; owning target budgets and release acceptance are separate gates';
await save(); process.exitCode = report.rows.every(r => r.status === 'passed') ? 0 : 1;
