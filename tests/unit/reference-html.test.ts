import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error host tooling is an untyped ESM script
import { generate, check, OUTPUTS } from '../../packages/module-tools/reference.mjs';
// @ts-expect-error host tooling is an untyped ESM script
import { renderHtml } from '../../packages/module-tools/reference-html.mjs';

it('renders the same public catalog deterministically without changing Manual or text output and checks HTML drift', () => {
  const result = generate();
  expect(result.text).toBe(readFileSync(OUTPUTS.text, 'utf8'));
  expect(JSON.stringify(result.bundle, null, 2) + '\n').toBe(readFileSync(OUTPUTS.pages, 'utf8'));
  expect(result.html).toBe(readFileSync(OUTPUTS.html, 'utf8'));
  expect(renderHtml(result.bundle, result.documented, result.state.api.publicDeclarations)).toBe(result.html);
  expect(check({...result, html: result.html + '\n'}).some((error: string) => error.startsWith(OUTPUTS.html + ': stale from line '))).toBe(true);
});

it('keeps every public symbol and every emitted fragment destination reachable within the standalone file', () => {
  const { html, state } = generate();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match: RegExpMatchArray) => match[1]);
  expect(new Set(ids).size).toBe(ids.length);
  for (const item of state.api.publicDeclarations.values()) {
    expect(ids).toContain('symbol:' + item.stem + ':' + (item.namespace ? item.namespace + '.' : '') + item.name);
  }
  for (const match of html.matchAll(/href="#([^"]*)"/g)) expect(ids).toContain(decodeURIComponent(match[1]));
  expect(html).not.toMatch(/(?:src|href)="https?:/);
  expect(Buffer.byteLength(html)).toBeLessThan(3 * 1024 * 1024);
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;
  const css = /<style>([\s\S]*?)<\/style>/.exec(html)![1]!;
  expect(Buffer.byteLength(script + css)).toBeLessThan(24 * 1024);
});

it('escapes documentation as text and renders semantic JSDoc with only known local cross-references', () => {
  const declarations = new Map([['Example', {stem: 'fixture', name: 'Example'}]]);
  const page = {id: 'api-reference/game-api/fixture', title: 'Fixture <img>', summary: 'Summary', blocks: [
    {type: 'heading', text: 'Example'},
    {type: 'paragraph', text: 'Safe </script><img src=x onerror="window.pwned=1"> @param value Input <svg> @returns Frozen value @throws Invalid fields @deprecated Use replacement @see Example'},
    {type: 'code', text: 'export type Example = "<script>";'},
    {type: 'link', text: 'Outside chapter', page: 'modules'},
  ]};
  const html = renderHtml({pages: [page], provenance: '<script>private</script>'}, [], declarations);
  expect(html).toContain('&lt;/script&gt;&lt;img');
  expect(html).not.toContain('<img');
  expect(html.match(/<script>/g)).toHaveLength(1);
  expect(html).toContain('<dt>Parameter</dt><dd>value Input &lt;svg&gt;</dd>');
  expect(html).toContain('<dt>Returns</dt>');
  expect(html).toContain('<dt>Throws</dt>');
  expect(html).toContain('<strong>Deprecated:</strong>');
  expect(html).toContain('<strong>See:</strong> <a href="#symbol%3Afixture%3AExample">Example</a>');
  expect(html).toContain('in-game Manual: <code>modules</code>');
  expect(html).not.toContain('href="#modules"');
});
