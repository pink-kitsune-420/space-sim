// License gate. Code that ships in the game must be first-party or
// MIT-style permissive and credited in CREDITS.md; build/test tools may use any
// commercial-friendly license but never copyleft-on-distribution, non-commercial or
// unknown terms. Reads installed package metadata only; no network access.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Licenses allowed in anything bundled into the shipped game. */
const SHIPPABLE = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD', 'Zlib', 'CC0-1.0', 'Unlicense']);
/** Additionally allowed for development tools that never ship with the game. */
const TOOLING = new Set([...SHIPPABLE, 'Apache-2.0', 'MPL-2.0', 'BlueOak-1.0.0', 'Python-2.0', 'CC-BY-4.0']);
/** Reviewed exceptions: 'name@version' -> reason. Add only after reading the license. */
const REVIEWED = {};

const root = new URL('..', import.meta.url).pathname;
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const packages = new Map(); // name@version -> { name, version, license, dir, dependencies }

function read(dir) {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return;
  const json = JSON.parse(readFileSync(file, 'utf8'));
  if (!json.name || !json.version) return;
  const license = typeof json.license === 'string' ? json.license
    : json.license?.type ?? (Array.isArray(json.licenses) ? json.licenses.map(l => l.type ?? l).join(' OR ') : 'UNKNOWN');
  packages.set(`${json.name}@${json.version}`, { name: json.name, version: json.version, license, dir,
    dependencies: Object.keys({ ...json.dependencies, ...json.optionalDependencies }) });
}
function walk(modules) {
  if (!existsSync(modules)) return;
  for (const entry of readdirSync(modules)) {
    if (entry.startsWith('.')) continue;
    const dir = join(modules, entry);
    if (entry.startsWith('@')) { for (const scoped of readdirSync(dir)) visit(join(dir, scoped)); } else visit(dir);
  }
}
function visit(dir) { read(dir); walk(join(dir, 'node_modules')); }
walk(join(root, 'node_modules'));

/** SPDX check: OR needs one allowed alternative, AND needs every term allowed. */
function allowed(expression, set) {
  const text = expression.replace(/[()]/g, ' ').trim();
  if (/\bOR\b/.test(text)) return text.split(/\bOR\b/).some(part => allowed(part, set));
  return text.split(/\bAND\b/).every(part => set.has(part.trim().replace(/\+$/, '')));
}
function find(name, fromDir) {
  for (let dir = fromDir; dir.startsWith(root); dir = join(dir, '..')) {
    const candidate = join(dir, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      const json = JSON.parse(readFileSync(candidate, 'utf8'));
      return packages.get(`${json.name}@${json.version}`);
    }
    if (dir === root) break;
  }
  return undefined;
}

const problems = [];
// Runtime closure: everything reachable from "dependencies" can end up in the bundle.
const shipped = new Map();
const queue = Object.keys(manifest.dependencies ?? {}).map(name => [name, root]);
while (queue.length) {
  const [name, from] = queue.shift();
  const pkg = find(name, from);
  if (!pkg) { problems.push(`runtime dependency ${name} is not installed (run npm ci)`); continue; }
  const id = `${pkg.name}@${pkg.version}`;
  if (shipped.has(id)) continue;
  shipped.set(id, pkg);
  for (const dep of pkg.dependencies) queue.push([dep, pkg.dir]);
}
const credits = existsSync(join(root, 'CREDITS.md')) ? readFileSync(join(root, 'CREDITS.md'), 'utf8') : '';
for (const [id, pkg] of shipped) {
  if (!allowed(pkg.license, SHIPPABLE) && !REVIEWED[id]) problems.push(`shipped ${id}: license "${pkg.license}" is not MIT-style permissive`);
  if (!credits.includes(pkg.name)) problems.push(`shipped ${id}: missing from CREDITS.md`);
}
for (const [id, pkg] of packages) {
  if (shipped.has(id) || REVIEWED[id]) continue;
  if (!allowed(pkg.license, TOOLING)) problems.push(`tool ${id}: license "${pkg.license}" is not on the tooling allowlist`);
}

const tally = {};
for (const pkg of packages.values()) tally[pkg.license] = (tally[pkg.license] ?? 0) + 1;
console.log(`Licenses: ${packages.size} installed packages (${shipped.size} reachable from runtime dependencies).`);
console.log(Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([license, n]) => `  ${license}: ${n}`).join('\n'));
if (problems.length) {
  console.error(`\nFAIL: ${problems.length} license problem(s):\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log(shipped.size ? 'PASS: shipped packages are permissive and credited; tools are commercial-friendly.'
  : 'PASS: no runtime dependencies, so the game ships first-party code only; tools are commercial-friendly.');

// Explicitly supplied imported artifacts are distribution inputs too. Inspection never runs code.
const moduleFiles = process.argv.slice(2).map(arg => {
  if (!arg.startsWith('--module=')) throw new Error(`Unknown license option ${arg}; use --module=artifact.module.json`);
  return arg.slice('--module='.length);
});
if (moduleFiles.length) {
  const { authorContracts } = await import('../packages/module-tools/author.mjs');
  const { parseCodeArtifact } = await authorContracts();
  for (const file of moduleFiles) {
    const artifact = parseCodeArtifact(readFileSync(file, 'utf8'));
    console.log(`Module ${artifact.manifest.id}: ${artifact.inputs.length} permissive/first-party inputs, attribution embedded (${artifact.digest})`);
  }
}
