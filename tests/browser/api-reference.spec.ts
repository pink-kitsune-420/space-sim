import { test, expect } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { disableNetwork } from '../helpers/offline';
// @ts-expect-error host generator is an untyped ESM script
import { renderHtml } from '../../packages/module-tools/reference-html.mjs';

const reference = pathToFileURL(resolve('modules/API-REFERENCE.html')).href;
let directory: string, fixture: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'reference-html-'));
  fixture = pathToFileURL(join(directory, 'reference.html')).href;
  const page = { id: 'api-reference/game-api/fixture', title: 'Fixture', summary: 'Safe guide', blocks: [
    {type: 'heading', text: 'Example'},
    {type: 'paragraph', text: 'Literal </script><img src=https://example.invalid/x onerror="window.pwned=1"> @param value Input <svg> @returns Frozen value @deprecated Prefer replacement @see Example'},
    {type: 'code', text: 'export type Example = "<script>";'},
  ] };
  await writeFile(join(directory, 'reference.html'), renderHtml({pages: [page], provenance: 'Fixture'}, [], new Map([['Example', {stem: 'fixture', name: 'Example'}]])));
});
test.afterAll(async () => { await rm(directory, {recursive: true, force: true}); });

test('standalone file searches public declarations, keeps deep links and back navigation, and makes no network requests', async ({page, context}) => {
  await disableNetwork(context);
  const requests: string[] = [], errors: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(reference);
  await expect(page.getByRole('heading', {name: 'Spacelab module API reference', exact: true})).toBeVisible();
  const search = page.getByRole('searchbox', {name: 'Search declarations and guides'});
  await expect(search).toBeEnabled();
  const count = await page.locator('article[data-entry]').count(); expect(count).toBeGreaterThanOrEqual(610);
  const broken = await page.locator('a[href^="#"]').evaluateAll(links => links.filter(link => !document.getElementById(decodeURIComponent(link.getAttribute('href')!.slice(1)))).map(link => link.getAttribute('href')));
  expect(broken).toEqual([]);
  await search.fill('validateShaderDefinition');
  const entry = page.locator('article[data-entry]:visible');
  await expect(entry).toHaveCount(1);
  await expect(entry.locator('h3')).toContainText('validateShaderDefinition');
  await expect(entry.locator('dt')).toHaveText(['Parameter', 'Parameter', 'Returns', 'Throws']);
  await expect(entry.locator('pre')).toContainText('value: unknown, defaults: ShaderPack');
  await search.focus(); await page.keyboard.press('Tab');
  await expect(page.getByRole('button', {name: 'Clear search'})).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(search).toHaveValue('');
  await expect(page.locator('article[data-entry]:visible')).toHaveCount(count);
  const first = 'symbol:shader-format:validateShaderDefinition';
  const second = 'symbol:manual:ManualService';
  await page.locator('h3[id="' + first + '"] a').click();
  await expect(page).toHaveURL(reference + '#' + encodeURIComponent(first));
  await search.fill('no_such_symbol_or_guide_123');
  await expect(page.getByRole('status')).toHaveText('No matches. Clear search to show all topics.');
  // A real fragment change reveals a hidden destination and clears stale filtering.
  await page.evaluate(id => { location.hash = encodeURIComponent(id); }, second);
  await expect(search).toHaveValue('');
  await expect(page.locator('h3[id="' + second + '"]')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(reference + '#' + encodeURIComponent(first));
  await page.reload();
  await expect(page.locator('h3[id="' + first + '"]')).toBeFocused();
  await search.fill('missing_again'); await search.press('Escape');
  await expect(search).toHaveValue('');
  expect(requests).toEqual([]); expect(errors).toEqual([]);
});

test('source-like HTML remains inert and semantic cross-references stay local', async ({page, context}) => {
  await disableNetwork(context); const requests: string[] = [];
  page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
  await page.goto(fixture);
  await expect(page.locator('article')).toContainText('</script><img');
  await expect(page.locator('img,svg,iframe')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as {pwned?: number}).pwned)).toBeUndefined();
  await expect(page.locator('article dt')).toHaveText(['Parameter', 'Returns']);
  await expect(page.locator('.deprecated')).toContainText('Deprecated: Prefer replacement');
  await page.locator('article p a').click();
  await expect(page).toHaveURL(fixture + '#symbol%3Afixture%3AExample');
  expect(requests).toEqual([]);
});

test('offline reference remains readable without JavaScript at a narrow viewport', async ({browser}) => {
  const context = await browser.newContext({javaScriptEnabled: false, viewport: {width: 390, height: 700}});
  try {
    await disableNetwork(context); const page = await context.newPage(); await page.goto(reference);
    await expect(page.locator('noscript p')).toContainText('All reference content is available');
    await expect(page.getByRole('searchbox')).toBeDisabled();
    expect(await page.locator('article[data-entry]').count()).toBeGreaterThanOrEqual(610);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('nav a[href="#page%3Aapi-reference%2Fgame-api%2Fmanual"]').click();
    await expect(page.locator('section[id="page:api-reference/game-api/manual"]')).toBeInViewport();
  } finally { await context.close(); }
});
