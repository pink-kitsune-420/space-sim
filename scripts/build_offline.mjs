// Inline the single Vite entry and stylesheet. The artifact opens directly via file://.
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
let html = await readFile(resolve(root, 'index.html'), 'utf8');
async function asset(url) {
  const path = resolve(root, url);
  if (!path.startsWith(root + sep)) throw new Error(`Asset outside build: ${url}`);
  return readFile(path, 'utf8');
}
const scripts = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/g)];
if (scripts.length !== 1) throw new Error('Offline build expects exactly one bundled script');
for (const match of scripts) {
  const js = await asset(match[1]);
  if (/\bimport\s*\(/.test(js)) throw new Error('Offline build cannot contain dynamic imports');
  html = html.replace(match[0], () => `<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>`);
}
const styles = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)];
if (styles.length !== 1) throw new Error('Offline build expects one bundled stylesheet');
for (const match of styles) {
  const css = await asset(match[1]);
  html = html.replace(match[0], () => `<style>${css.replace(/<\/style/gi, '<\\/style')}</style>`);
}
// Navigation must remain in this file, including after copying/renaming the artifact.
html = html.replace('href="./"', 'href="#app"');
html = html.replace('LOCAL FLIGHT', 'OFFLINE FLIGHT');
if (/<(?:script|link)\b[^>]*(?:src|href)="[^#]/i.test(html)) throw new Error('External build asset remains');
const output = resolve(root, 'space-sim-offline.html');
await writeFile(output, html);
console.log(`Offline game: ${output} (${Buffer.byteLength(html)} bytes). Double-click to play.`);
