// Inline the single Vite entry and stylesheet. The artifact opens directly via file://.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

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
html = html.replace(/<link\b[^>]*\brel="(?:manifest|icon)"[^>]*>\s*/gi, '');
if (/<(?:script|link)\b[^>]*(?:src|href)="[^#]/i.test(html)) throw new Error('External build asset remains');
const output = resolve(root, 'space-lab-offline.html');
await writeFile(output, html);
await writeFile(resolve(root, 'space-sim-offline.html'), html);
const game = JSON.parse(await readFile(new URL('../games/space-sim/game.json', import.meta.url), 'utf8'));
await writeFile(resolve(root, 'space-sim.spacegame'), gzipSync(JSON.stringify(game), { level: 9 }));
const universe = JSON.parse(await readFile(new URL('../games/space-sim/universes/sandbox/default/universe.json', import.meta.url), 'utf8'));
await writeFile(resolve(root, 'space-sim.spaceuniverse'), gzipSync(JSON.stringify(universe), { level: 9 }));
// Mirror authored organization so every universe is editable and independently shareable.
const universeRoot = fileURLToPath(new URL('../games/space-sim/universes/', import.meta.url));
const catalog = JSON.parse(await readFile(resolve(universeRoot, 'catalog.json'), 'utf8'));
if (catalog.format !== 'space-lab-universe-catalog/1' || !Array.isArray(catalog.universes)
  || new Set(catalog.universes.map(u => u.id)).size !== catalog.universes.length
  || new Set(catalog.universes.map(u => u.alias)).size !== catalog.universes.length) throw new Error('Invalid universe catalog or duplicate IDs/aliases');
const exported = [];
for (const entry of catalog.universes) {
  const source = resolve(universeRoot, entry.file);
  if (!source.startsWith(universeRoot) || !/^[a-z0-9-]+\/[a-z0-9-]+\/universe\.json$/.test(entry.file)) throw new Error(`Invalid catalog path: ${entry.file}`);
  const raw = JSON.parse(await readFile(source, 'utf8'));
  if (raw.id !== entry.id) throw new Error(`Catalog ID differs from universe: ${entry.file}`);
  const destination = resolve(root, 'universes', entry.file), packed = entry.file.replace(/\.json$/, '.spaceuniverse');
  await mkdir(dirname(destination), { recursive: true });
  const json = JSON.stringify(raw), bytes = gzipSync(json, { level: 9 });
  await writeFile(destination, `${JSON.stringify(raw, null, 2)}\n`);
  await writeFile(resolve(root, 'universes', packed), bytes);
  exported.push({ ...entry, file: packed, json: entry.file, bytes: bytes.length, expandedBytes: Buffer.byteLength(json) });
}
await writeFile(resolve(root, 'universes', 'catalog.json'), `${JSON.stringify({ ...catalog, universes: exported }, null, 2)}\n`);
await writeFile(resolve(root, 'universes', 'universe.schema.json'), await readFile(resolve(universeRoot, 'universe.schema.json')));
console.log(`Offline game: ${output} (${Buffer.byteLength(html)} bytes). Double-click to play.`);
