import { buildModule } from '../../packages/module-tools/author.mjs';
import { rolldown } from 'rolldown';
import { test, expect } from '@playwright/test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortableModule, newModule, packageContracts } from '../../packages/module-tools/package.mjs';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';

test.describe.configure({ timeout: 90000 });
let directory: string, gameBytes: Buffer, progressGameBytes: Buffer, replacementBytes: Buffer, failureBytes: Buffer;
let providerDigest: string, lifecycleScript: string;
test.beforeAll(async () => {
  const bundle = await rolldown({ input: 'tests/helpers/module-lifecycle.ts', platform: 'browser' });
  try { lifecycleScript = (await bundle.generate({ format: 'iife', name: 'Phase2Lifecycle', exports: 'named' })).output[0]!.code; }
  finally { await bundle.close(); }
  directory = await mkdtemp(join(tmpdir(), 'phase2-acceptance-'));
  const kit = await packageContracts();
  async function build(id: string, extra: Record<string, unknown>, source: string) {
    const folder = join(directory, id); await newModule(id, folder);
    const path = join(folder, 'module.json'), descriptor = JSON.parse(await readFile(path, 'utf8'));
    const { authority: _authority, ...fields } = descriptor.manifest;
    descriptor.compatibility = { deterministic: true, multiplayer: true };
    descriptor.manifest = { ...fields, format: 'space-sim-module/2', apiVersion: 'space-sim-game-api/2', tier: 'platform', conflicts: [], ...extra };
    await writeFile(path, JSON.stringify(descriptor)); await writeFile(join(folder, 'src/main.ts'), source);
    const output = join(directory, `${id}.spacemod`); await buildPortableModule(path, output, { typecheck: false });
    const bytes = new Uint8Array(await readFile(output)), inspected = await kit.decodeModulePackage(bytes);
    return { bytes, ref: { id, version: descriptor.manifest.version, digest: inspected.integrity.digest } };
  }
  const capability = { name: 'test.seats', version: '1.0.0' };
  const provider = (name: string) => `export default function(c: any) { c.provide({ slot: 'test.seats', version: '1.0.0' }, { name: '${name}' }); }`;
  const a = await build('test.seats-a', { provides: [capability], slots: ['test.seats'] }, provider('A'));
  const b = await build('test.seats-b', { provides: [capability], slots: ['test.seats'] }, provider('B'));
  const force = await build('test.force', { tier: 'authoritative' }, `export default function(c: any) { c.contributeForce({ modelIdentity: 'phase2-force', initialState: {version: 1, value: null}, evaluate() { return {x: 0, y: 0.01}; } }); }`);
  const consumer = await build('test.consumer', { requires: [capability, { name: 'core.pilots', version: '^1.0.0' }], settings: { gain: { type: 'number', default: 2, minimum: 1, maximum: 5 } } }, `export default function(c: any) {
    const provider = c.use({ slot: 'test.seats', version: '1.0.0' });
    const pilots = c.use({ slot: 'core.pilots', version: '1.0.0' });
    const state = globalThis as any; state.phase2Live = (state.phase2Live || 0) + 1;
    const listener = () => { state.phase2Events = (state.phase2Events || 0) + 1; };
    window.addEventListener('phase2-probe', listener);
    c.own({ dispose() { state.phase2Live--; window.removeEventListener('phase2-probe', listener); } });
    c.contributeWindow({ name: 'state', title: 'Mixed game adapter', controls: [{ kind: 'text', id: 'selection', text: provider.name + ' gain ' + c.settings.gain }] });
    c.contributeInput({ name: 'pilot-probe', sample(frame: any) { state.phase2Pilot = pilots.playerId(frame.pilot); }, release() { state.phase2Release = (state.phase2Release || 0) + 1; }, dispose() {} });
  }`);
  const failure = await build('test.failure', {}, `export default function(c: any) { const s = globalThis as any; s.failedLive = (s.failedLive || 0) + 1; const listener = () => s.failedEvents = (s.failedEvents || 0) + 1; window.addEventListener('phase2-probe', listener); const timer = setInterval(() => s.failedTimer = true, 100); c.own({ dispose() { s.failedLive--; clearInterval(timer); window.removeEventListener('phase2-probe', listener); } }); throw new Error('deliberate candidate failure'); }`);
  const refs = [force, a, consumer].map(p => p.ref);
  const profile = { format: 'space-sim-profile/2', id: 'test.imported-selection', modules: refs.map(({ id, version }) => ({ id, version })), providers: { 'test.seats': 'test.seats-a' }, capabilities: { 'test.consumer': { 'test.seats': 'test.seats-a' } }, settings: { 'test.consumer': { gain: 2 } } };
  const plan = { profile, packages: refs, requiredSlots: [] };
  const node = { profile: { ...profile, modules: [force.ref].map(({ id, version }) => ({ id, version })), providers: {}, capabilities: {}, settings: {} }, packages: [force.ref], requiredSlots: [] };
  const runtime = kit.attachRuntimeFiles(kit.validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: plan, offline: plan, node } }), new Map([force, a, consumer].map(p => [`modules/${p.ref.id}.spacemod`, p.bytes])));
  const builtin = JSON.parse(await readFile('games/space-sim/game.json', 'utf8'));
  gameBytes = Buffer.from(await kit.encodePackage({ ...builtin, info: { id: 'test.mixed-game', name: 'Phase 2 mixed', description: 'Acceptance fixture' }, runtime }));
  const legacy = await buildModule('examples/modules/force/module.json', undefined, { typecheck: false });
  const data = JSON.parse(await readFile('examples/modules/gentle-flight.json', 'utf8'));
  progressGameBytes = Buffer.from(await kit.encodePackage({ ...builtin, info: { id: 'test.mixed-game', name: 'Phase 2 mixed', description: 'Mixed progress fixture' }, runtime,
    plugins: [legacy], bundle: { ...builtin.bundle, modules: [data], code: [{ id: legacy.manifest.id, version: legacy.manifest.version, digest: legacy.digest }],
      profile: { ...builtin.bundle.profile, modules: [...builtin.bundle.profile.modules, { id: legacy.manifest.id, version: legacy.manifest.version }, { id: data.manifest.id, version: data.manifest.version }] } } }));
  replacementBytes = Buffer.from(b.bytes); failureBytes = Buffer.from(failure.bytes); providerDigest = b.ref.digest;
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });

test('edits imported mixed games, replaces providers, previews reverse removals and rolls back failed activation', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('/'); await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'mixed.spacegame', mimeType: 'application/zip', buffer: gameBytes });
  await expect(page.locator('#lab-status')).toContainText('Added Phase 2 mixed');
  const card = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Phase 2 mixed', exact: true }) });
  await card.getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#lab-status')).toContainText('Playing Phase 2 mixed');
  const devices = page.locator('.device-module-settings'); await devices.locator(':scope > summary').click();
  const consumer = devices.locator('li').filter({ has: page.locator('input[data-module-id="test.consumer"]') });
  await expect(consumer.locator('input[type="checkbox"]')).toBeEnabled();
  await expect(page.locator('.module-windows')).toContainText('A gain 2');
  // A legacy base-profile edit is validated together with the v2 selection.
  await page.locator('.code-module-settings > summary').click();
  await page.locator('.code-module-settings > details > summary').click();
  await page.locator('input[data-enable="builtin.motion"]').uncheck();
  await expect(page.locator('#module-change-preview')).toContainText('motion');
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('not enabled');
  await expect(page.locator('.module-windows')).toContainText('A gain 2');
  await page.locator('input[data-enable="builtin.motion"]').check();
  await page.locator('#lab-file').setInputFiles({ name: 'replacement.spacemod', mimeType: 'application/zip', buffer: replacementBytes });
  await consumer.locator('select').last().selectOption(providerDigest);
  await devices.locator('li').filter({ has: page.locator('input[data-module-id="test.seats-b"]') }).locator('input[type="radio"]').check();
  await consumer.locator('input[type="number"]').fill('3'); await consumer.locator('input[type="number"]').dispatchEvent('change');
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
  await expect(page.locator('.module-windows')).toContainText('B gain 3');
  await expect.poll(() => page.evaluate(() => (globalThis as any).phase2Live)).toBe(1);
  // An unchecked dependency produces an explicit reverse-removal proposal.
  await devices.locator('input[data-module-id="test.seats-a"]').uncheck();
  await devices.locator('input[data-module-id="test.seats-b"]').uncheck();
  await devices.getByRole('button', { name: 'Remove dependent modules', exact: true }).click();
  await expect(devices.locator('input[data-module-id="test.consumer"]')).not.toBeChecked();
  await expect(page.locator('#device-module-status')).toContainText('test.consumer');
  // Revert pending edits by replaying the applied export; export must retain provider B/gain 3.
  const exported = page.waitForEvent('download'); await page.locator('#lab-export').click();
  const kit = await packageContracts(); const applied = await kit.decodePackage(new Uint8Array(await readFile(await (await exported).path())));
  if (applied.format !== 'space-lab-game/1') throw new Error('Expected game');
  expect(applied.runtime!.plans.browser!.profile.providers['test.seats']).toBe('test.seats-b');
  expect(applied.runtime!.plans.browser!.profile.settings['test.consumer']!.gain).toBe(3);
  await page.locator('#lab-file').setInputFiles({ name: 'applied.spacegame', mimeType: 'application/zip', buffer: Buffer.from(await kit.encodePackage(applied)) });
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: applied.info.name, exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#lab-status')).toContainText(`Playing ${applied.info.name}`);
  await expect(page.locator('.module-windows')).toContainText('B gain 3');
  await page.locator('#lab-file').setInputFiles({ name: 'failure.spacemod', mimeType: 'application/zip', buffer: failureBytes });
  await devices.locator('input[data-module-id="test.failure"]').check();
  await page.locator('#apply-device-modules').click();
  await expect(page.locator('#device-module-status')).toContainText('deliberate candidate failure');
  await expect(page.locator('.module-windows')).toContainText('B gain 3');
  expect(await page.evaluate(() => { window.dispatchEvent(new Event('phase2-probe')); return { live: (globalThis as any).phase2Live, failed: (globalThis as any).failedLive, leakedEvent: (globalThis as any).failedEvents }; })).toEqual({ live: 1, failed: 0, leakedEvent: undefined });
  for (let i = 0; i < 2; i++) {
    await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: applied.info.name, exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
    await expect(page.locator('.game-card').filter({ has: page.getByRole('heading', { name: applied.info.name, exact: true }) }).getByRole('button', { name: 'Play · new world' })).toBeEnabled();
    await expect(page.locator('.module-windows')).toHaveCount(1); await expect.poll(() => page.evaluate(() => (globalThis as any).phase2Live)).toBe(1);
  }
  expect(errors).toEqual([]);
});

test('restores progress without its game, requires consent, and preserves the active world on invalid identities or missing/tampered installed code', async ({ page }) => {
  await page.goto('/'); await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'mixed.spacegame', mimeType: 'application/zip', buffer: progressGameBytes });
  await expect(page.locator('#lab-status')).toContainText('Added Phase 2 mixed');
  await page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Phase 2 mixed', exact: true }) }).getByRole('button', { name: 'Play · new world' }).click();
  await expect(page.locator('#lab-status')).toContainText('Playing Phase 2 mixed');
  await openPanel(page, 'fleet');
  const download = page.waitForEvent('download'); await page.locator('#save-world').click();
  const savedBytes = await readFile(await (await download).path());
  const kit = await packageContracts(), saved = await kit.decodeUniverseSave(new Uint8Array(savedBytes)) as any;
  expect(saved.configuration.code).toHaveLength(1); expect(saved.configuration.data).toHaveLength(1);
  expect(saved.configuration.runtime.plans.browser.profile.capabilities['test.consumer']['test.seats']).toBe('test.seats-a');
  await page.reload(); await openPanel(page, 'fleet'); await expect(page.locator('#status')).toHaveText('LANDED');
  await expect(page.locator('.module-windows')).toHaveCount(0);
  const currentWorld = async () => JSON.parse(await page.locator('#debug').textContent() || '{}').world;
  await expect.poll(currentWorld).toBeTruthy();
  const builtinWorld = await currentWorld();
  const load = async (bytes: Buffer, accept: boolean, error?: RegExp) => {
    const dialogs: string[] = [];
    const listener = async (dialog: import('@playwright/test').Dialog) => {
      dialogs.push(dialog.message());
      if (dialog.type() === 'confirm' && !accept) await dialog.dismiss(); else await dialog.accept();
    };
    page.on('dialog', listener);
    try {
      await page.locator('#world-file').setInputFiles({ name: 'progress.spaceuniverse', mimeType: 'application/zip', buffer: bytes });
      if (error) await expect.poll(() => dialogs.join('\n')).toMatch(error);
      else await expect(page.locator('#flight-message')).toContainText('Universe loaded');
      return dialogs;
    } finally { page.off('dialog', listener); }
  };
  await load(savedBytes, false, /cancelled/); expect(await currentWorld()).toBe(builtinWorld);
  const dialogs = await load(savedBytes, true); expect(dialogs.join('\n')).toContain('full access');
  await expect(page.locator('.module-windows')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (globalThis as any).phase2Live)).toBe(1);
  const active = await currentWorld();
  for (const invalid of [{ ...saved, simulationFingerprint: '0'.repeat(64) }, { ...saved, lock: { ...saved.lock, profileId: 'test.incorrect-lock' } }]) {
    await load(Buffer.from(await kit.encodeUniverseSave(invalid)), true, /differ/);
    expect(await currentWorld()).toBe(active); await expect(page.locator('.module-windows')).toHaveCount(1);
  }
  const ref = saved.configuration.runtime.plans.browser.packages.find((p: any) => p.id === 'test.force');
  async function damage(tamper: boolean) {
    await page.evaluate(async ({ digest, tamper }) => {
      // Use the app-created schema; join-pack support can upgrade the database version.
      const db = await new Promise<IDBDatabase>((resolve, reject) => { const r = indexedDB.open('space-lab-modules'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction('packages', 'readwrite'), store = tx.objectStore('packages');
        if (!tamper) store.delete(digest);
        else { const request = store.get(digest); request.onsuccess = () => { const record = request.result; record.bytes[40] ^= 1; store.put(record); }; }
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error);
      }); db.close();
    }, { digest: ref.digest, tamper });
  }
  await damage(false); await load(savedBytes, true, /Install exact package test.force/); expect(await currentWorld()).toBe(active);
  const original = await kit.decodePackage(new Uint8Array(gameBytes));
  if (original.format !== 'space-lab-game/1') throw new Error('Expected game');
  const forceBytes = kit.runtimeSelectionFiles(original.runtime!).get('modules/test.force.spacemod')!;
  await openPanel(page, 'library');
  await page.locator('#lab-file').setInputFiles({ name: 'force.spacemod', mimeType: 'application/zip', buffer: Buffer.from(forceBytes) });
  await expect(page.locator('#lab-status')).toContainText('Code has not run');
  await damage(true); await openPanel(page, 'fleet'); await load(savedBytes, true, /Installed progress package test.force could not be verified/);
  expect(await currentWorld()).toBe(active); expect(await page.evaluate(() => (globalThis as any).phase2Live)).toBe(1);
});


test('browser candidate cancellation and supersession retain applied selection and release replaced sessions', async ({ page }) => {
  await page.goto('/'); await page.addScriptTag({ content: lifecycleScript });
  const result = await page.evaluate(bytes => (globalThis as any).Phase2Lifecycle.replacementLifecycle(bytes), [...gameBytes]);
  expect(result).toEqual({ cancelledRejected: true, cancellationPreserved: true, supersededRejected: true, latestPreserved: true, published: 2, live: 1 });
  expect(await page.evaluate(() => (globalThis as any).phase2Live)).toBe(0);
  expect(await page.evaluate(() => (globalThis as any).Phase2Lifecycle.rendererGate())).toContain('require the renderer adapter');
  expect(await page.evaluate(() => (globalThis as any).Phase2Lifecycle.themePublicationRollback())).toBe(true);
});
