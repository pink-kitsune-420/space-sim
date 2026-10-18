import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { buildModule } from '../../packages/module-tools/author.mjs';
import { openPanel } from '../helpers/workspace';
import { useCanvas } from '../helpers/canvas';
import type { CodeArtifact } from '../../packages/game-runtime/src/artifact';
import { packageContracts } from '../../packages/module-tools/package.mjs';
import builtin from '../../games/space-sim/game.json' with { type: 'json' };

test.skip(process.env.SPACE_SIM_ALLOW_RUNTIME_CODE !== 'false', 'Run against an explicitly code-disabled production build');
let artifact: CodeArtifact;
test.beforeAll(async () => { artifact = await buildModule(resolve('examples/modules/force/module.json'), undefined, { typecheck: false }); });
test.beforeEach(async ({ page }) => { await useCanvas(page); });
test('code-disabled distribution runs builtins and rejects imported code before installation', async ({ page }) => {
  await page.goto('/'); await expect(page.locator('#status')).toHaveText('LANDED'); await openPanel(page, 'library');
  await page.locator('.code-module-settings > summary').click();
  await page.locator('#code-module-file').setInputFiles({ name: 'module.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(artifact)) });
  await expect(page.locator('#code-module-status')).toContainText('does not allow imported code');
  await expect(page.locator('#installed-code-modules li')).toHaveCount(0);
  const kit = await packageContracts(), moduleBytes = await kit.encodeModuleFiles(kit.wrapLegacyCode(artifact));
  const inspected = await kit.decodeModulePackage(moduleBytes);
  const ref = { id: artifact.manifest.id, version: artifact.manifest.version, digest: inspected.integrity.digest };
  const runtime = kit.attachRuntimeFiles(kit.validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans: { browser: {
    profile: { format: 'space-sim-profile/2', id: 'test.disabled', modules: [{ id: ref.id, version: ref.version }], providers: {}, capabilities: {}, settings: {} },
    packages: [ref], requiredSlots: [],
  } } }), new Map([[`modules/${ref.id}.spacemod`, moduleBytes]]));
  const game = await kit.encodePackage(kit.validatePackage({ ...builtin, runtime }));
  await page.locator('#lab-file').setInputFiles({ name: 'nested-code.spacegame', mimeType: 'application/zip', buffer: Buffer.from(game) });
  await expect(page.locator('#lab-status')).toContainText('does not allow imported code');
  await page.locator('#lab-file').setInputFiles(resolve('examples/modules/gentle-flight.json'));
  await expect(page.locator('#lab-status')).toContainText('Installed');
  await expect(page.locator('#installed-code-modules')).toContainText('Gentle');
  const original = JSON.parse(await page.locator('#debug').textContent() || '{}').fingerprint;
  await page.locator('.code-module-settings > details > summary').click();
  await page.locator('input[data-enable="example.gentle-flight"]').check();
  await page.locator('#apply-code-modules').click();
  await expect(page.locator('#code-module-status')).toContainText('Profile enabled');
  await expect.poll(async () => JSON.parse(await page.locator('#debug').textContent() || '{}').fingerprint).not.toBe(original);
  await expect(page.locator('#save-world')).toBeEnabled();
});
