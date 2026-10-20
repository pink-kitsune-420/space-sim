// Generated Creators API reference. Reads manifests, Creators guides, examples and the
// public game-api declarations they use; writes a Manual page bundle and a plain-text copy.
// Usage: node packages/module-tools/reference.mjs [--check]
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync } from 'rolldown/utils';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const OUTPUTS = { pages: 'apps/web/src/api-reference.json', text: 'modules/API-REFERENCE.txt' };
/** Section headings of a templated docs/creators/usage.json, in order. */
export const TEMPLATE = ['What it does', 'Provides and requires', 'Settings', 'Lifecycle', 'Remove or replace', 'Stability', 'Example', 'Related'];
const GAME_API = 'packages/game-api/src';
const PAGE_LIMIT = { bytes: 65536, blocks: 256 };
const SERVICE = /\b([a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+)@([\^~]?\d+\.\d+\.\d+)/g;

const read = path => readFileSync(join(ROOT, path), 'utf8');
const json = path => JSON.parse(read(path));
const list = path => readdirSync(join(ROOT, path), { withFileTypes: true });
const parse = (path, source) => {
  const parsed = parseSync(path, source);
  if (parsed.errors.length) throw new Error(`${path}: ${parsed.errors[0].message}`);
  return parsed;
};

/** Exported top-level declarations of game-api, with leading JSDoc and the public name set. */
function gameApi() {
  const declarations = new Map(), files = new Map();
  for (const entry of list(GAME_API).filter(entry => entry.name.endsWith('.ts')).sort((a, b) => a.name.localeCompare(b.name))) {
    const path = `${GAME_API}/${entry.name}`, source = read(path), parsed = parse(path, source), stem = entry.name.slice(0, -3);
    files.set(stem, { path, source, parsed });
    for (const node of parsed.program.body) {
      if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
      const declaration = node.declaration;
      const names = declaration.type === 'VariableDeclaration' ? declaration.declarations.map(item => item.id.name) : [declaration.id?.name];
      const comment = parsed.comments.filter(item => item.type === 'Block' && item.value.startsWith('*') && item.end <= node.start
        && !source.slice(item.end, node.start).trim()).at(-1);
      for (const name of names.filter(Boolean)) declarations.set(name, { name, stem, path, source, node, declaration, doc: comment ? jsdoc(comment.value) : '' });
    }
  }
  // Public names follow index.ts re-exports; every other export stays internal to game-api.
  const exported = new Set(), namespaces = new Map(), publicDeclarations = new Map(), index = files.get('index');
  const exportsOf = stem => [...declarations.values()].filter(item => item.stem === stem);
  for (const node of index.parsed.program.body) {
    const target = node.source?.value?.replace(/^\.\//, '');
    if (node.type === 'ExportAllDeclaration') {
      if (node.exported) {
        const ns = node.exported.name;
        exported.add(ns);
        namespaces.set(ns, target);
        for (const item of exportsOf(target)) { item.namespace = ns; publicDeclarations.set(item.name, item); }
      } else {
        for (const item of exportsOf(target)) { exported.add(item.name); publicDeclarations.set(item.name, item); }
      }
    } else if (node.type === 'ExportNamedDeclaration' && node.source) {
      for (const spec of node.specifiers) {
        const name = spec.exported.name, local = (spec.local ?? spec.exported).name, item = declarations.get(local);
        exported.add(name);
        if (item) publicDeclarations.set(name, item);
      }
    }
  }
  const keys = new Map();
  for (const item of publicDeclarations.values()) {
    const init = item.declaration.type === 'VariableDeclaration' ? item.declaration.declarations[0].init : undefined;
    const text = init ? item.source.slice(init.start, init.end) : '';
    const slot = /slot:\s*'([^']+)'/.exec(text)?.[1], version = /version:\s*'([^']+)'/.exec(text)?.[1];
    const type = /ServiceKey<\s*([A-Za-z0-9_]+)/.exec(item.source.slice(item.declaration.start, init?.start ?? item.declaration.end))?.[1];
    if (slot && version) keys.set(slot, { name: item.name, version, type });
  }
  return { declarations, publicDeclarations, namespaces, exported, keys, files };
}
function jsdoc(value) {
  return value.replace(/^\*/, '').split('\n').map(line => line.replace(/^\s*\* ?/, '').trimEnd()).join(' ')
    .replace(/\s+/g, ' ').trim();
}
/** Declaration text without its JSDoc; function and arrow bodies are omitted. Inline
 * `import('./file').Name` types become `Name`, as creators import them from the entry point. */
function signature(item) {
  return declarationText(item).replace(/\bimport\('\.\/[a-z0-9-]+'\)\./g, '');
}
function declarationText(item) {
  const { node, declaration, source } = item;
  if (declaration.type === 'FunctionDeclaration' && declaration.body) return `${source.slice(node.start, declaration.body.start).trimEnd()};`;
  const init = declaration.type === 'VariableDeclaration' ? declaration.declarations[0].init : undefined;
  if (init?.type === 'ArrowFunctionExpression') return `${source.slice(node.start, init.body.start).trimEnd()} …;`;
  return source.slice(node.start, node.end);
}
function pageFits(blocks, limit = PAGE_LIMIT) {
  if (blocks.length > limit.blocks) return false;
  if (Buffer.byteLength(JSON.stringify(blocks)) > limit.bytes) return false;
  let chars = 0;
  for (const block of blocks) {
    if (block.type === 'list') for (const item of block.items) chars += item.length;
    else chars += block.text.length;
  }
  return chars <= limit.bytes;
}
function topicPages(stem, items, usedBy, limit = PAGE_LIMIT) {
  const ns = items[0]?.namespace;
  const intro = {
    type: 'paragraph',
    text: ns
      ? `Import ${ns} from @space-sim/game-api. Units are SI unless a note says otherwise. Source: packages/game-api/src/${stem}.ts.`
      : `Import these names from @space-sim/game-api. Units are SI unless a note says otherwise. Source: packages/game-api/src/${stem}.ts.`,
  };
  const footer = { type: 'link', text: 'API reference index', page: 'api-reference' };
  const groups = items.map(item => {
    const owners = [...usedBy.get(item.name) ?? []].sort();
    return [
      { type: 'heading', text: item.namespace ? `${item.namespace}.${item.name}` : item.name },
      ...(item.doc ? [{ type: 'paragraph', text: item.doc }] : []),
      { type: 'code', text: signature(item) },
      { type: 'paragraph', text: `Used by: ${owners.length ? owners.join(', ') : 'host or creator modules (not imported by shipped modules)'}.` },
    ];
  });
  const singleBlocks = [intro, ...groups.flat(), footer];
  if (pageFits(singleBlocks, limit)) {
    return [{
      id: `api-reference/game-api/${stem}`,
      title: `game-api: ${stem}.ts`,
      summary: `Declarations from ${stem}.ts used by documented modules.`,
      blocks: singleBlocks,
    }];
  }
  const navReserve = { blocks: Math.max(8, Math.min(32, Math.floor(limit.blocks / 8))), bytes: 2048 };
  const chunkLimit = {
    blocks: Math.max(6, limit.blocks - navReserve.blocks),
    bytes: Math.max(1024, limit.bytes - navReserve.bytes),
  };
  const chunks = [];
  let current = [];
  for (const group of groups) {
    const candidate = [...current, ...group];
    if (current.length && !pageFits([intro, ...candidate, footer], chunkLimit)) {
      chunks.push(current);
      current = [...group];
    } else {
      current = candidate;
    }
  }
  if (current.length) chunks.push(current);
  const pageId = index => index === 0 ? `api-reference/game-api/${stem}` : `api-reference/game-api/${stem}/${index + 1}`;
  return chunks.map((chunk, index) => {
    const navLinks = chunks.map((_, other) => other === index ? null : ({
      type: 'link',
      text: `game-api: ${stem}.ts (part ${other + 1} of ${chunks.length})`,
      page: pageId(other),
    })).filter(Boolean);
    return {
      id: pageId(index),
      title: index === 0 ? `game-api: ${stem}.ts` : `game-api: ${stem}.ts (${index + 1}/${chunks.length})`,
      summary: `Declarations from ${stem}.ts (part ${index + 1} of ${chunks.length}).`,
      blocks: [intro, ...chunk, ...navLinks, footer],
    };
  });
}
/** Names imported from the public entry point, and other specifiers, of one module/example folder. */
function imports(folder) {
  const names = new Set(), other = [];
  const walk = path => {
    for (const entry of list(path)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) { walk(child); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      for (const node of parse(child, read(child)).program.body) {
        if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) || !node.source) continue;
        if (node.source.value !== '@space-sim/game-api') { if (!node.source.value.startsWith('.')) other.push(`${child}: ${node.source.value}`); continue; }
        for (const item of node.specifiers ?? []) if (item.imported || item.local) names.add((item.imported ?? item.local).name);
      }
    }
  };
  walk(`${folder}/src`);
  return { names: [...names].sort(), other };
}
/** The literal arguments of contributeGuide calls in a module's sources. */
function registeredGuides(folder) {
  const guides = [];
  const walk = path => {
    for (const entry of list(path)) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) { walk(child); continue; }
      if (!entry.name.endsWith('.ts')) continue;
      const visit = node => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression' && node.callee?.property?.name === 'contributeGuide' && node.arguments[0]?.type === 'ObjectExpression') {
          const value = {};
          for (const property of node.arguments[0].properties) {
            const key = property.key?.name ?? property.key?.value;
            if (property.value?.type === 'Literal' && typeof property.value.value === 'string') value[key] = property.value.value;
          }
          guides.push(value);
        }
        for (const child of Object.values(node)) Array.isArray(child) ? child.forEach(visit) : visit(child);
      };
      visit(parse(child, read(child)).program);
    }
  };
  walk(`${folder}/src`);
  return guides;
}
function sections(guide) {
  const result = new Map();
  let current;
  for (const block of guide.blocks) {
    if (block.type === 'heading') { current = block.text; result.set(current, []); }
    else if (current) result.get(current).push(block);
  }
  return result;
}
const blockText = block => block.type === 'list' ? block.items.join('\n') : block.text;
/** Exact version, or a ^/~ range that the declared version satisfies. */
function matches(declared, mentioned) {
  const parse = text => text.replace(/^[\^~]/, '').split('.').map(Number), [a, b] = [parse(declared), parse(mentioned)];
  const atLeast = a[0] > b[0] || a[0] === b[0] && (a[1] > b[1] || a[1] === b[1] && a[2] >= b[2]);
  return mentioned.startsWith('^') ? a[0] === b[0] && atLeast : mentioned.startsWith('~') ? a[0] === b[0] && a[1] === b[1] && atLeast
    : declared.replace(/^[\^~]/, '') === mentioned;
}

function collect() {
  const inputs = new Set();
  const api = gameApi();
  const modules = [];
  for (const entry of list('modules').filter(entry => entry.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const folder = `modules/${entry.name}`, descriptor = json(`${folder}/module.json`), manifest = descriptor.manifest;
    const guides = (descriptor.guides ?? []).map(path => ({ path: `${folder}/${path}`, ...json(`${folder}/${path}`) }));
    const usage = guides.find(guide => guide.path === `${folder}/docs/creators/usage.json`);
    modules.push({ folder, name: entry.name, descriptor, manifest, guides, usage,
      documented: !!usage?.blocks.some(block => block.type === 'heading' && block.text === TEMPLATE[0]) });
  }
  const targets = new Set();
  for (const game of list('games').filter(entry => entry.isDirectory())) {
    const path = `games/${game.name}/targets.json`;
    if (!existsSync(join(ROOT, path))) continue;
    for (const plan of Object.values(json(path).plans ?? {})) for (const ref of plan.profile?.modules ?? []) targets.add(ref.id);
  }
  const manual = read('modules/manual/src/content.ts'), creators = manual.slice(manual.indexOf('const CREATORS'));
  const book = creators.slice(0, creators.indexOf('\n];'));
  const bookPages = new Set([...book.matchAll(/^\s*id: '([^']+)'/gm)].map(match => match[1]));
  const bookLinks = [...book.matchAll(/data-page="([^"]+)"/g)].map(match => match[1]);
  return { api, modules, targets, bookPages, bookLinks, inputs, version: json('package.json').version };
}

/** Everything published: reference pages for templated modules and all public game-api topics. */
export function generate(state = collect(), options = {}) {
  const pageLimit = options.pageLimit ?? PAGE_LIMIT;
  const { api, modules, targets } = state, documented = modules.filter(module => module.documented);
  const used = new Map(), usedBy = new Map();
  const include = (name, owner) => {
    const nsTarget = api.namespaces.get(name);
    if (nsTarget) {
      for (const item of api.publicDeclarations.values()) if (item.stem === nsTarget) include(item.name, owner);
      return;
    }
    const item = api.publicDeclarations.get(name);
    if (!item) return;
    usedBy.set(name, new Set([...usedBy.get(name) ?? [], owner]));
    if (used.has(name)) return;
    used.set(name, item);
    // A ServiceKey<T> constant is only useful beside the service type it hands out.
    const key = [...api.keys.values()].find(entry => entry.name === name);
    if (key?.type) include(key.type, owner);
    for (const heritage of item.declaration.extends ?? []) {
      const base = heritage.expression?.name ?? heritage.expression?.typeName?.name;
      if (base) include(base, owner);
      for (const param of heritage.typeArguments?.params ?? []) if (param.typeName?.name) include(param.typeName.name, owner);
    }
  };
  const moduleImports = new Map();
  for (const module of documented) {
    const example = `examples/modules/${module.name}`, names = imports(module.folder).names, exampleNames = existsSync(join(ROOT, example)) ? imports(example).names : [];
    moduleImports.set(module.manifest.id, { names, exampleNames, example });
    for (const name of [...names, ...exampleNames]) include(name, module.manifest.id);
    for (const capability of [...module.manifest.provides, ...module.manifest.requires]) {
      const key = api.keys.get(capability.name);
      if (key) { include(key.name, module.manifest.id); if (key.type) include(key.type, module.manifest.id); }
    }
  }
  const topics = [...new Set([...api.publicDeclarations.values()].map(item => item.stem))].sort();
  state.inputs.add(`${GAME_API}/index.ts`);
  for (const item of api.publicDeclarations.values()) state.inputs.add(item.path);
  for (const module of documented) {
    state.inputs.add(`${module.folder}/module.json`); state.inputs.add(module.usage.path);
    const { example } = moduleImports.get(module.manifest.id);
    for (const file of ['module.json', 'src/main.ts']) if (existsSync(join(ROOT, example, file))) state.inputs.add(`${example}/${file}`);
  }
  const digest = createHash('sha256').update(`version\0${state.version}\0`);
  for (const path of [...state.inputs].sort()) digest.update(`${path}\0${read(path)}\0`);
  const apiVersions = [...new Set(documented.map(module => module.manifest.apiVersion))].sort().join(', ') || 'none';
  const formats = [...new Set(documented.map(module => module.manifest.format))].sort().join(', ') || 'none';
  const provenance = `Spacelab package ${state.version} · API ${apiVersions} · manifest ${formats} · source digest ${digest.digest('hex').slice(0, 16)}`;

  const capability = (name, version, optional) => {
    const key = api.keys.get(name);
    return `${name}@${version}${optional ? ' (optional)' : ''}${key ? ` · ${key.name}${key.type ? `: ServiceKey<${key.type}>` : ''}` : ''}`;
  };
  const stemOf = name => api.publicDeclarations.get(name)?.stem ?? api.namespaces.get(name);
  const gameApiPages = topics.flatMap(stem => {
    const items = [...api.publicDeclarations.values()].filter(item => item.stem === stem).sort((a, b) => a.node.start - b.node.start);
    return topicPages(stem, items, usedBy, pageLimit);
  });
  const pages = [{
    id: 'api-reference', title: 'API reference', summary: 'Generated reference for documented modules and the game-api declarations they use.',
    blocks: [
      { type: 'paragraph', text: 'This reference is generated from module manifests, Creators guides and the public @space-sim/game-api declarations. Each module page lists the facts its manifest declares; each game-api page shows the exact declarations with their notes. Modules appear here once their Creators guide follows the module guide template.' },
      { type: 'paragraph', text: provenance },
      { type: 'paragraph', text: 'Three versions are independent: a module version (semver, such as 0.1.0), the API identifier a module is written against (such as space-sim-game-api/2) and a file-format identifier (such as space-sim-flight-plans/1). The v2 API is pre-freeze and can still change.' },
      { type: 'heading', text: 'Modules' },
      ...documented.map(module => ({ type: 'link', text: `${module.manifest.name} (${module.manifest.id})`, page: `api-reference/module/${module.manifest.id}` })),
      { type: 'heading', text: 'Game API topics' },
      ...gameApiPages.map(page => ({
        type: 'link',
        text: page.id.replace(/^api-reference\/game-api\//, '').replace(/\/(\d+)$/, '.ts (part $1)').replace(/^([^.]+)$/, '$1.ts'),
        page: page.id,
      })),
      { type: 'link', text: 'Code modules: manifests, packaging and installation', page: 'modules' },
    ],
  }];
  for (const module of documented) {
    const m = module.manifest, { names, exampleNames, example } = moduleImports.get(m.id), settings = Object.entries(m.settings);
    const used = [...new Set([...names, ...exampleNames])].filter(name => api.exported.has(name)).sort();
    pages.push({ id: `api-reference/module/${m.id}`, title: `${m.name} reference`, summary: module.usage.summary, blocks: [
      { type: 'paragraph', text: module.usage.summary },
      { type: 'list', items: [`ID: ${m.id}`, `Version: ${m.version}`, `API: ${m.apiVersion}`, `Manifest format: ${m.format}`, `Kind: ${m.kind}`,
        `Tier: ${m.tier}`, `Environments: ${m.environments.join(', ')}`, `Entry: ${module.descriptor.entry}`, `Multiplayer: ${module.descriptor.compatibility?.multiplayer ? 'supported' : 'not declared'}`] },
      { type: 'heading', text: 'Provides' },
      m.provides.length ? { type: 'list', items: m.provides.map(item => capability(item.name, item.version)) } : { type: 'paragraph', text: 'Nothing.' },
      { type: 'heading', text: 'Requires' },
      m.requires.length ? { type: 'list', items: m.requires.map(item => capability(item.name, item.version, item.optional)) } : { type: 'paragraph', text: 'Nothing.' },
      { type: 'heading', text: 'Composition' },
      { type: 'list', items: [`Slots: ${m.slots.join(', ') || 'none'}`, `Dependencies: ${m.dependencies.map(d => `${d.id}@${d.version}`).join(', ') || 'none'}`,
        `Conflicts: ${m.conflicts.map(d => `${d.id}@${d.version}`).join(', ') || 'none'}`,
        `Initialize before: ${m.before.join(', ') || 'none'}; after: ${m.after.join(', ') || 'none'}`] },
      { type: 'heading', text: 'Settings' },
      settings.length ? { type: 'list', items: settings.map(([key, s]) => `${key}: ${s.type}, default ${s.default}, from ${s.minimum} to ${s.maximum}${s.step === undefined ? '' : `, step ${s.step}`}. ${s.label ?? ''}${s.label && s.description ? ': ' : ''}${s.description ?? ''}`.trim()) }
        : { type: 'paragraph', text: 'None.' },
      { type: 'heading', text: 'Game API used' },
      { type: 'paragraph', text: used.length ? used.join(', ') : 'None.' },
      ...[...new Set(used.map(stemOf).filter(Boolean))].sort().map(stem => ({ type: 'link', text: `game-api ${stem}.ts`, page: `api-reference/game-api/${stem}` })),
      { type: 'heading', text: 'Guide and example' },
      { type: 'paragraph', text: `Example source: ${example} (build with npm run module:build -- ${example}/module.json out.spacemod).` },
      ...(targets.has(m.id) ? [{ type: 'link', text: `${module.usage.title}: how to use, replace and remove it`, page: `${m.id}/usage` }] : []),
    ] });
  }
  pages.push(...gameApiPages);
  for (const page of pages) {
    if (/\bimport\s*\(/.test(JSON.stringify(page))) throw new Error(`${page.id}: text resembling a dynamic import breaks the offline build`);
    const size = Buffer.byteLength(JSON.stringify(page.blocks));
    if (!pageFits(page.blocks, pageLimit)) throw new Error(`${page.id}: ${page.blocks.length} blocks, ${size} bytes exceeds one Manual page; split the topic`);
  }
  // The host shows shipped guides only for these modules, so the list is part of the bundle.
  const bundle = { format: 'spacelab-api-reference/1', provenance, modules: documented.map(module => module.manifest.id), pages };
  return { bundle, text: text(bundle, documented), documented, state };
}
function text(bundle, documented) {
  const render = page => [`=== ${page.title} [${page.id}]`, ...page.blocks[0]?.text === page.summary ? [] : [page.summary, ''], ...page.blocks.flatMap(block =>
    block.type === 'heading' ? ['', `## ${block.text}`] : block.type === 'list' ? block.items.map((item, index) => `${block.ordered ? `${index + 1}.` : '-'} ${item}`)
      : block.type === 'code' ? block.text.split('\n').map(line => `    ${line}`) : block.type === 'link' ? [`-> ${block.text} [${block.page}]`] : [block.text]), ''];
  return [
    'Spacelab module API reference (plain text)',
    'Generated by packages/module-tools/reference.mjs from module manifests, Creators guides and game-api declarations.',
    'Do not edit; regenerate with: node packages/module-tools/reference.mjs',
    'The same pages appear in the in-game Manual under Creators -> API reference. [page-id] names a Manual page.', '',
    ...bundle.pages.flatMap(render),
    ...documented.flatMap(module => render({ ...module.usage, id: `${module.manifest.id}/usage` })),
  ].join('\n').replace(/[ \t]+$/gm, '') + '\n';
}

/** Readable drift diagnostics for templated guides, links, examples and generated output. */
export function check(result = generate()) {
  const { state, documented, bundle } = result, { api, modules, targets, bookPages } = state, errors = [];
  const fail = (where, message) => errors.push(`${where}: ${message}`);
  for (const item of api.publicDeclarations.values()) {
    if (!item.doc) fail(item.path, `public declaration ${item.name} is missing a leading JSDoc comment`);
  }
  const providers = new Map();
  for (const module of modules) for (const item of module.manifest.provides) providers.set(item.name, [...providers.get(item.name) ?? [], item.version]);
  const pageIds = new Set([...bookPages, ...bundle.pages.map(page => page.id)]);
  // Shipped guides are registered only for documented modules that some game target enables.
  for (const module of documented) if (targets.has(module.manifest.id)) for (const guide of module.guides) if (guide.audience === 'creators') pageIds.add(`${module.manifest.id}/${guide.id}`);
  const links = (where, blocks) => {
    for (const block of blocks) if (block.type === 'link' && !pageIds.has(block.page))
      fail(where, `link "${block.text}" targets ${block.page}, which is not a visible Creators Manual page (book page, API reference, or the guide of a documented module in a game target)`);
  };
  for (const page of bundle.pages) links(OUTPUTS.pages, page.blocks);
  links('modules/manual/src/content.ts (Creators)', state.bookLinks.map(page => ({ type: 'link', text: page, page })));
  for (const module of documented) {
    const m = module.manifest, guide = module.usage, where = guide.path, parts = sections(guide);
    const headings = guide.blocks.filter(block => block.type === 'heading').map(block => block.text);
    if (guide.blocks[0]?.type !== 'heading' || headings.join('|') !== TEMPLATE.join('|')) fail(where, `headings must be exactly: ${TEMPLATE.join(', ')}; found ${headings.join(', ')}`);
    if (!/^[^.!?]+(?:\.[a-z0-9][^.!?]*)*\.$/.test(guide.summary)) fail(where, 'summary must be one sentence ending with a full stop');
    const registered = registeredGuides(module.folder).find(item => item.asset === 'docs/creators/usage.json');
    if (!registered) fail(module.folder, 'no contributeGuide call registers docs/creators/usage.json');
    else for (const key of ['id', 'title', 'summary']) if (registered[key] !== guide[key])
      fail(where, `${key} differs from the contributeGuide call in ${module.folder}/src (${JSON.stringify(registered[key])}); keep one wording`);
    const all = guide.blocks.map(blockText).join('\n'), facts = (parts.get('Provides and requires') ?? []).map(blockText).join('\n');
    for (const item of m.provides) if (!facts.includes(`${item.name}@${item.version}`)) fail(where, `Provides and requires must state ${item.name}@${item.version} from module.json`);
    for (const item of m.requires) if (!facts.includes(`${item.name}@${item.version}`)) fail(where, `Provides and requires must state ${item.name}@${item.version}${item.optional ? ' (optional)' : ''} from module.json`);
    for (const [, name, version] of all.matchAll(SERVICE)) {
      const own = [...m.provides, ...m.requires].filter(item => item.name === name);
      const known = [...own.map(item => item.version), ...providers.get(name) ?? [], ...api.keys.has(name) ? [api.keys.get(name).version] : []];
      if (!known.length) fail(where, `${name}@${version} is not a service any module or game-api key declares`);
      else if (!(own.length ? own : known.map(version => ({ version }))).some(item => item.version === version || matches(item.version, version)))
        fail(where, `${name}@${version} does not match the declared version (${[...new Set(own.length ? own.map(item => item.version) : known)].join(', ')})`);
    }
    const settingText = (parts.get('Settings') ?? []).map(blockText).join('\n'), settings = Object.entries(m.settings);
    if (!settings.length && !settingText.includes('no settings')) fail(where, 'Settings must say "This module has no settings."');
    for (const [key, s] of settings) {
      const expected = `${key} (default ${s.default}, from ${s.minimum} to ${s.maximum}${s.step === undefined ? '' : `, step ${s.step}`})`;
      if (!settingText.includes(expected)) fail(where, `Settings must describe ${expected}, as module.json declares`);
    }
    const stability = (parts.get('Stability') ?? []).map(blockText).join('\n');
    for (const fact of [m.version, m.apiVersion, m.format]) if (!stability.includes(fact)) fail(where, `Stability must name ${fact} from module.json`);
    const example = `examples/modules/${module.name}`, exampleText = (parts.get('Example') ?? []).map(blockText).join('\n');
    if (!exampleText.includes(example)) fail(where, `Example must point to ${example}`);
    if (!existsSync(join(ROOT, example, 'module.json')) || !existsSync(join(ROOT, example, 'src/main.ts'))) fail(example, 'example needs module.json and src/main.ts');
    else {
      const found = imports(example);
      for (const other of found.other) fail(other, 'examples import only @space-sim/game-api and their own files');
      for (const name of found.names) if (!api.exported.has(name)) fail(example, `imports ${name}, which @space-sim/game-api does not export`);
      const em = json(`${example}/module.json`).manifest;
      for (const item of [...em.provides, ...em.requires]) if (!providers.has(item.name) && !api.keys.has(item.name) && !em.provides.some(p => p.name === item.name))
        fail(`${example}/module.json`, `${item.name} is not a known service`);
    }
    for (const name of imports(module.folder).names) if (!api.exported.has(name)) fail(module.folder, `imports ${name}, which @space-sim/game-api does not export`);
    const related = (parts.get('Related') ?? []).filter(block => block.type === 'link').map(block => block.page);
    for (const page of ['modules', `api-reference/module/${m.id}`]) if (!related.includes(page)) fail(where, `Related must link to ${page}`);
    links(where, guide.blocks);
  }
  const expected = { [OUTPUTS.pages]: `${JSON.stringify(bundle, null, 2)}\n`, [OUTPUTS.text]: result.text };
  for (const [path, content] of Object.entries(expected)) {
    const current = existsSync(join(ROOT, path)) ? read(path) : undefined;
    if (current === content) continue;
    const line = current === undefined ? 0 : current.split('\n').findIndex((value, index) => value !== content.split('\n')[index]) + 1;
    fail(path, current === undefined ? 'missing; run node packages/module-tools/reference.mjs' : `stale from line ${line}; run node packages/module-tools/reference.mjs`);
  }
  return errors;
}
export function write(result = generate()) {
  writeFileSync(join(ROOT, OUTPUTS.pages), `${JSON.stringify(result.bundle, null, 2)}\n`);
  writeFileSync(join(ROOT, OUTPUTS.text), result.text);
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.includes('--check')) {
      const errors = check();
      if (errors.length) { console.error(`API reference check failed (${errors.length}):\n${errors.map(error => `- ${error}`).join('\n')}`); process.exitCode = 1; }
      else console.log('API reference check passed');
    } else {
      const result = write();
      console.log(`Wrote ${relative(ROOT, join(ROOT, OUTPUTS.pages))} (${result.bundle.pages.length} pages) and ${OUTPUTS.text}`);
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
