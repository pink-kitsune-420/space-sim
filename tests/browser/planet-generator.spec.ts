import { test, expect } from '@playwright/test';
import { build } from 'vite';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { buildPortableModule, packModule } from '../../packages/module-tools/package.mjs';
import golden from '../fixtures/planet-field-v2.json' with { type: 'json' };

let script: string;
test.beforeAll(async () => {
  const temp = await mkdtemp(join(tmpdir(), 'space-sim-planet-archive-'));
  const source = join(temp, 'generator'); await cp(resolve('modules/planet-generator'), source, { recursive: true });
  // Build an isolated source copy: the production source/manifest remains fixed.
  await buildPortableModule(join(source, 'module.json'));
  const archive = join(temp, 'planet-generator.spacemod'); await packModule(source, archive, { compression: 'store' });
  const pkg = await readFile(archive);
  const result = await build({ configFile: false, logLevel: 'error',
    define: { __PLANET_PACKAGE_BASE64__: JSON.stringify(pkg.toString('base64')) },
    resolve: { alias: { '@space-sim/game-api': resolve('packages/game-api/src/index.ts') } },
    build: { write: false, lib: { entry: resolve('tests/browser/fixtures/planet-generator.ts'), formats: ['iife'], name: 'PlanetGeneratorProof' } } });
  const bundle = Array.isArray(result) ? result[0]! : result;
  if (!('output' in bundle)) throw Error('Expected production fixture bundle');
  script = bundle.output.filter(x => x.type === 'chunk').map(x => x.code).join('\n');
});

for (const environment of ['browser', 'offline'] as const) test('independent archive generator boot and lifetime (' + environment + ')', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  if (environment === 'offline') {
    const path = info.outputPath('generator-offline.html');
    await writeFile(path, '<!doctype html><meta charset="utf-8"><title>Offline generator proof</title><script>' + script.replaceAll('</script', '<\\/script') + '</script>');
    await page.goto(pathToFileURL(path).href);
  } else {
    await page.route('**/planet-generator-proof.html', r => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Generator proof</title>' }));
    await page.goto('/planet-generator-proof.html'); await page.addScriptTag({ content: script });
  }
  const result = await page.evaluate(async environment => {
    const proof = (window as unknown as { PlanetGeneratorProof: { run(e: string): Promise<Record<string, unknown>> } }).PlanetGeneratorProof;
    return proof.run(environment);
  }, environment);
  for (const name of ['absent', 'transferred', 'rollback', 'cancelled', 'disposed', 'fresh', 'denied']) expect(result[name], name).toBe(true);
  const expected = golden.rows.find(r => r.definition.recipe === 'oceanic' && r.definition.seed === 741)!.values[0]!;
  expect(result.values).toEqual(expected); expect(result.afterDisposeValues).toEqual(expected);
  expect(result.paddedValues).toEqual([24, 0, 0, 0, ...expected.slice(4)]);
  expect(result.paddedFirstEquator).toBe(24); expect(result.paddedFieldBytes).toBe(80);
  expect(result.equatorSamples).toBe(128); expect(result.mapSamples).toBe(512); expect(errors).toEqual([]);
  await writeFile(info.outputPath('generator-proof.json'), JSON.stringify(result, null, 2));
});
