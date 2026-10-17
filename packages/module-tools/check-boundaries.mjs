// Static authoring boundary check. Not a trusted-code security sandbox.
import { parseSync } from 'rolldown/utils';
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const publicEntry = 'packages/game-api/src/index';
// These are composition/validation/platform bridges, not player-authored modules.
// Keep exceptions exact so a new private dependency requires an explicit review.
const bridges = {
  'packages/modules/src/index.ts': [
    'packages/game-runtime/src/index', 'packages/game-runtime/src/validation',
    'packages/sim-core/src/services', 'packages/sim-core/src/universe', 'packages/sim-core/src/world', 'packages/sim-core/src/save',
  ],
  'packages/modules/src/data.ts': [
    'packages/game-runtime/src/index', 'packages/game-runtime/src/validation', 'packages/sim-core/src/universe',
  ],
  'packages/modules/src/profile.ts': ['packages/game-runtime/src/index', 'packages/game-runtime/src/validation'],
  'packages/modules/src/browser.ts': ['packages/game-runtime/src/index', 'packages/game-runtime/src/validation'],
  'packages/modules/src/base/content.ts': ['packages/scenarios/builtin'],
  'packages/modules/src/base/motion.ts': ['packages/sim-core/src/context', 'packages/sim-core/src/services'],
  'packages/modules/src/base/renderers.ts': ['packages/render-2d/src/index'],
};
/** Folders whose modules are written exactly like player modules: public API and siblings only. */
const publicRoots = ['examples/modules/', 'packages/modules/src/base/toolset/'];
export function checkSource(source, path) {
  const errors = [];
  const parsed = parseSync(path, source);
  if (parsed.errors.length) return parsed.errors.map(error => `${path}: ${error.message}`);
  const tree = parsed.program;
  function check(specifier) {
    if (!specifier || specifier.type !== 'Literal' || typeof specifier.value !== 'string') { errors.push(`${path}: computed module imports are unsupported`); return; }
    const raw = specifier.value;
    const target = relative(root, resolve(root, dirname(path), raw)).replaceAll('\\', '/').replace(/\.(ts|js|mjs)$/, '');
    const localRoot = publicRoots.find(root => path.startsWith(root)) ?? `${path.split('/').slice(0, 3).join('/')}/`;
    const allowed = raw === '@space-sim/game-api' || raw.startsWith('.') && (target === publicEntry
      || (target.startsWith(localRoot) && target !== localRoot.slice(0, -1))
      || bridges[path]?.includes(target));
    if (!allowed) errors.push(`${path}: unsupported import ${raw}; use the public game-api entry point`);
  }
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) && node.source) check(node.source);
    if (node.type === 'TSImportEqualsDeclaration') errors.push(`${path}: import assignments are unsupported`);
    if (node.type === 'TSImportType' || node.type === 'ImportExpression') check(node.source);
    if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0]);
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') visit(value);
    }
  }
  visit(tree);
  return errors;
}
async function collect(path) {
  const files = [];
  for (const entry of await readdir(resolve(root, path), { withFileTypes: true })) {
    const child = `${path}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await collect(child));
    else if (/\.(ts|mjs)$/.test(entry.name)) files.push(child);
  }
  return files;
}
export async function checkBoundaries() {
  const files = (await Promise.all(['packages/game-api/src', 'packages/game-runtime/src', 'packages/modules/src', 'examples/modules'].map(collect))).flat();
  const errors = (await Promise.all(files.map(async path => checkSource(await readFile(resolve(root, path), 'utf8'), path)))).flat();
  if (errors.length) throw new Error(errors.join('\n'));
  return files.length;
}
/** Project files a runtime import of `entry` loads: static relative imports and re-exports,
 * excluding type-only ones, which compile away. Used to keep headless graphs free of
 * renderer, browser and presentation code. */
export async function reachable(entry) {
  const seen = new Set();
  const candidates = target => [target, `${target}.ts`, `${target}/index.ts`, `${target}.mjs`];
  async function visit(path) {
    if (seen.has(path)) return;
    seen.add(path);
    if (!/\.(ts|mjs)$/.test(path)) return;
    const parsed = parseSync(path, await readFile(resolve(root, path), 'utf8'));
    const specifiers = [];
    for (const node of parsed.program.body) {
      if (node.type === 'ImportDeclaration' && node.importKind !== 'type') specifiers.push(node.source.value);
      if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source && node.exportKind !== 'type') specifiers.push(node.source.value);
    }
    for (const raw of specifiers) {
      if (typeof raw !== 'string' || !raw.startsWith('.')) continue;
      const target = relative(root, resolve(root, dirname(path), raw.replace(/\?.*$/, ''))).replaceAll('\\', '/');
      let found;
      for (const candidate of candidates(target)) {
        if ((await stat(resolve(root, candidate)).catch(() => undefined))?.isFile()) { found = candidate; break; }
      }
      if (!found) throw new Error(`${path}: cannot resolve ${raw}`);
      await visit(found);
    }
  }
  await visit(entry);
  return seen;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(`Module import boundaries: ${await checkBoundaries()} sources passed`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
