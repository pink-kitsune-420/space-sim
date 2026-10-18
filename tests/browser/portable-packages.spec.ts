import { useCanvas } from '../helpers/canvas';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile, copyFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { buildPortableModule, newModule, packageContracts } from '../../packages/module-tools/package.mjs';
import { openPanel } from '../helpers/workspace';

test.describe.configure({ timeout: 90000 });
let directory: string, script: string, archive: Buffer;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'space-browser-packages-'));
  const source = join(directory, 'editable'); await newModule('local.portable-browser', source);
  await writeFile(join(source, 'src/main.ts'), '(globalThis as typeof globalThis & { portableEvaluated?: number }).portableEvaluated = 1;\nexport default () => {};\n');
  await buildPortableModule(join(source, 'module.json'), join(directory, 'editable.spacemod'), { typecheck: false });
  archive = await readFile(join(directory, 'editable.spacemod'));
  const bundle = await rolldown({ input: resolve('packages/game-library/src/tooling.ts'), platform: 'browser' });
  try { script = (await bundle.generate({ format: 'iife', name: 'PortableCodec', exports: 'named' })).output[0]!.code; }
  finally { await bundle.close(); }
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('browser and Node preserve binary hashes and ZIP bytes, including the stored fallback, at phone size', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/');
  await page.addScriptTag({ content: script });
  const result = await page.evaluate(async () => {
    const api = (globalThis as any).PortableCodec;
    const memory = () => (performance as any).memory?.usedJSHeapSize ?? null;
    const samples: (number | null)[] = [memory()];
    const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, i) => (i * 71) & 255);
    const files = new Map([['assets/bytes.bin', bytes]]);
    const digest = api.createIntegrity(files).digest;
    samples.push(memory());
    const zipped = await api.writeZip(files), restored = await api.readZip(zipped);
    samples.push(memory());
    let deflate: boolean;
    try { new CompressionStream('deflate-raw'); deflate = true; } catch { deflate = false; }
    const original = globalThis.CompressionStream;
    (globalThis as any).CompressionStream = class extends original {
      constructor(format: CompressionFormat) { if (format === 'deflate-raw') throw new Error('unsupported'); super(format); }
    };
    let stored;
    try { stored = await api.writeZip(files); } finally { globalThis.CompressionStream = original; }
    const plain = await api.readZip(stored);
    samples.push(memory());
    return { digest, restored: api.createIntegrity(restored).digest, stored: api.createIntegrity(plain).digest,
      sha256: api.sha256Bytes(bytes), packedBytes: zipped.length, storedBytes: stored.length, deflate, heapSamples: samples,
      sampledHeapMaximum: samples.every(n => n === null) ? null : Math.max(...samples.filter(n => n !== null) as number[]),
      userAgent: navigator.userAgent, viewport: [innerWidth, innerHeight] };
  });
  const kit = await packageContracts();
  const bytes = Uint8Array.from({ length: 2 * 1024 * 1024 }, (_, i) => (i * 71) & 255);
  expect(result.sha256).toBe(kit.sha256Bytes(bytes));
  expect(result.digest).toBe(kit.createIntegrity(new Map([['assets/bytes.bin', bytes]])).digest);
  expect(result.restored).toBe(result.digest); expect(result.stored).toBe(result.digest);
  const report = { ...result,
    memoryLimit: 'Sampled JS heap only where exposed; not process peak RSS, real phone qualification or steady-state gameplay profiling.' };
  const reportPath = testInfo.outputPath('package-phone-smoke.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await testInfo.attach('package-phone-smoke.json', { path: reportPath, contentType: 'application/json' });
});

for (const offline of [false, true]) test(`${offline ? 'offline HTML' : 'hosted'} imports source inertly, plays it and exports editable source`, async ({ page, context }, testInfo) => {
  const requests: string[] = [], errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  if (offline) {
    const path = testInfo.outputPath('portable-offline.html'); await copyFile(resolve('dist/space-lab-offline.html'), path);
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await context.setOffline(true); await page.goto(pathToFileURL(path).href);
  } else await page.goto('/');
  await expect(page.locator('#status')).toHaveText('LANDED');
  const before = await page.locator('#debug').textContent();
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'editable.spacemod', mimeType: 'application/zip', buffer: archive });
  await expect(page.locator('#lab-status')).toContainText('Installed local.portable-browser');
  expect(await page.evaluate(() => (globalThis as any).portableEvaluated)).toBeUndefined();
  expect(JSON.parse(await page.locator('#debug').textContent() || '{}').world).toBe(JSON.parse(before!).world);
  await page.locator('.code-module-settings > details > summary').click();
  await page.locator('#authoritative-module-list input[data-enable="local.portable-browser"]').check();
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
  expect(await page.evaluate(() => (globalThis as any).portableEvaluated)).toBe(1);
  await page.locator('#game-name').fill('Editable flight');
  await page.locator('#lab-save').click();
  const card = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Editable flight', exact: true }) });
  await expect(card).toBeVisible();
  if (!offline) {
    await page.reload(); await openPanel(page, 'library');
    await expect(card).toBeVisible(); expect(await page.evaluate(() => (globalThis as any).portableEvaluated)).toBeUndefined();
  }
  const pending = page.waitForEvent('download'); await card.getByRole('button', { name: 'Export game', exact: true }).click();
  const bytes = new Uint8Array(await readFile(await (await pending).path()));
  const kit = await packageContracts(), game = await kit.decodeGamePackage(bytes, kit.validatePackage);
  expect(game.modules[0]!.descriptor.sourceStatus).toBe('included');
  expect(new TextDecoder().decode(game.modules[0]!.files.get('src/main.ts'))).toContain('portableEvaluated');
  // Tampering is rejected before replacing the active game or saved Library entry.
  const files = await kit.readZip(bytes); files.set('game.lock.json', kit.textBytes('{}'));
  const bad = Buffer.from(await kit.writeZip(files));
  await page.locator('#lab-file').setInputFiles({ name: 'tampered.spacegame', mimeType: 'application/zip', buffer: bad });
  await expect(page.locator('#lab-status')).toContainText('digest mismatch');
  await expect(card).toBeVisible();
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('Save universe writes progress separately from reusable definitions and loads legacy JSON too', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('LANDED');
  await openPanel(page, 'fleet');
  await expect(page.locator('#save-world')).toHaveText('Save universe');
  const pending = page.waitForEvent('download'); await page.locator('#save-world').click();
  const saveDownload = await pending; expect(saveDownload.suggestedFilename()).toMatch(/\.spaceuniverse$/);
  const savedBytes = await readFile(await saveDownload.path()), kit = await packageContracts();
  const save = await kit.decodeUniverseSave(new Uint8Array(savedBytes)) as any;
  const files = await kit.readZip(new Uint8Array(savedBytes));
  expect(files.has('save.json')).toBe(true); expect(files.has('data/universe.json')).toBe(true);
  await page.locator('#world-file').setInputFiles({ name: 'flight.spaceuniverse', mimeType: 'application/zip', buffer: savedBytes });
  await expect(page.locator('#status')).toHaveText('PAUSED');
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  expect(JSON.parse(await page.locator('#debug').textContent() || '{}').world).toBe(save.worldId);
  await page.locator('#world-file').setInputFiles({ name: 'old-save.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(save)) });
  await expect(page.locator('#flight-message')).toContainText('Universe loaded');
  await openPanel(page, 'setup');
  const dataPending = page.waitForEvent('download'); await page.locator('#export-universe').click();
  const dataDownload = await dataPending; expect(dataDownload.suggestedFilename()).toMatch(/\.spacedata$/);
  const dataBytes = new Uint8Array(await readFile(await dataDownload.path()));
  const definitions = await kit.decodeDataFile(dataBytes, 'universe') as any;
  expect(definitions.id).toBe(save.universe.id);
  const definitionFiles = await kit.readZip(dataBytes);
  expect([...definitionFiles.keys()].sort()).toEqual(['data.json', 'data/universe.json', 'integrity.json']);
  await page.locator('#universe-file').setInputFiles({ name: 'progress.spaceuniverse', mimeType: 'application/zip', buffer: savedBytes });
  await expect(page.locator('#universe-status')).toContainText('saved progress');
  expect(JSON.parse(await page.locator('#debug').textContent() || '{}').world).toBe(save.worldId);
});
