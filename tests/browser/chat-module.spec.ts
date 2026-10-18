import { test, expect } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';

let directory: string, source: string;
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'portable-chat-browser-'));
  const folder = join(directory, 'source'); await cp(resolve('modules/chat-console'), folder, { recursive: true });
  const built = await buildPortableModule(join(folder, 'module.json'), join(directory, 'chat.spacemod'), { typecheck: false });
  source = built.codeV2!.source;
});
test.afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

test('the real chat package mounts through public ports and disposes without stale handlers or controls', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // The isolated document has no Space Sim session, renderer, HUD, or window implementation.
  await page.goto('about:blank');
  await page.setContent('<div id="viewport" style="position:relative;width:800px;height:600px"><div id="root"></div></div><button id="toggle">Chat</button>');
  const result = await page.evaluate(bundle => {
    const initialize = new Function(`"use strict";\n${bundle}\n;return SpaceSimModule.default;`)();
    const owned: { dispose(): void }[] = [], submits: string[] = [];
    let factory: any;
    initialize({ settings:{}, contributeGuide() {}, provide(_key: unknown, value: unknown) { factory = value; }, own(value: { dispose(): void }) { owned.push(value); return value; } });
    const root = document.getElementById('root')!, viewport = document.getElementById('viewport')!, toggle = document.getElementById('toggle')!;
    let raises = 0, releases = 0, resizes = 0;
    const options = { root, viewport, toggle, submit: (text: string) => submits.push(text), windows: {
      raise() { raises++; }, release() { releases++; }, resize() { resizes++; return { dispose() { resizes--; } }; }
    } };
    const first = factory.create(options);
    first.log('chat', '<script>bad()</script>', 'Survey');
    const escaped = root.querySelector('script') === null && root.textContent!.includes('<script>bad()</script>');
    for (let index = 0; index < 70; index++) first.log('system', `message-${index}`);
    const bounded = root.querySelector('#chat-messages')!.children.length;
    first.minimize(true); first.show({ from: 'surveyor-a', name: 'Ada', text: 'hello' }, 'surveyor-a');
    const unread = !(root.querySelector('#chat-unread-dot') as HTMLElement).hidden;
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', cancelable: true }));
    const input = root.querySelector<HTMLInputElement>('#chat-input')!;
    const focused = document.activeElement === input; input.value = 'observation';
    root.querySelector<HTMLFormElement>('#chat-form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    first.dispose(); first.dispose();
    const stale = new KeyboardEvent('keydown', { code: 'Slash', cancelable: true }); window.dispatchEvent(stale);
    const disposed = !stale.defaultPrevented && root.childElementCount === 0 && resizes === 0 && releases === 1;
    const second = factory.create(options); second.log('success', 'new console');
    const oneInstance = root.querySelectorAll('#chat-form').length === 1 && resizes === 1;
    owned.forEach(resource => resource.dispose());
    let rejected = false; try { factory.create(options); } catch { rejected = true; }
    return { escaped, bounded, unread, focused, submits, disposed, oneInstance, rejected, empty: root.childElementCount === 0, resizes, releases, raises };
  }, source);
  expect(result).toEqual({ escaped: true, bounded: 60, unread: true, focused: true, submits: ['observation'], disposed: true,
    oneInstance: true, rejected: true, empty: true, resizes: 0, releases: 2, raises: 0 });
  expect(errors).toEqual([]);
});
