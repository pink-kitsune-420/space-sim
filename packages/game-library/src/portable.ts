/** Host-only package codec (`packages/game-library`): inert inspection of `.spacemod` and `.spacedata` packages (allowed entries, size limits, `integrity.json` digests, licences, guides and legacy wrappers). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`) and never receive package bytes; authors build and check packages with the `module:*` and `file:*` npm scripts (Manual → Creators → Code modules). Nothing here evaluates module code. */
import { parsePackageJson } from './json';
export { parsePackageJson } from './json';
import { captureDocument, type DataModule, type ModuleManifest, type ManifestV2 } from '../../game-api/src/index';
import { artifactDigest, artifactPath, MODULE_LICENSES, parseCodeArtifact, type CodeArtifact } from '../../game-runtime/src/artifact';
import { canonicalJson, sha256Bytes } from '../../game-runtime/src/authoritative';
import { freezeJson, keys, object, string, validateManifest } from '../../game-runtime/src/validation';
import { validateManifestV2 } from '../../game-runtime/src/validation-v2';
import { validateDataModule } from '../../modules/src/data';
import { validateUniverse } from '../../sim-core/src/universe';
import { fileLimit, readZip, validateFilePaths, writeZip, type PackageFiles, type ZipOptions } from './zip';
import type { ShippedPackageOptions } from './shipped-catalogue';
export { ShippedModuleCatalogue, parseShippedCatalogue, type ShippedModulePin, type ShippedPackageOptions } from './shipped-catalogue';

/** Descriptor format of a module package (`module.json` in a `.spacemod`). Host-only (`packages/game-library`). */
export const PACKAGE_FORMAT = 'spacelab-module-package/1';
/** Descriptor format of a data-only package (`data.json` in a `.spacedata`); it cannot contain executable modules. Host-only (`packages/game-library`). */
export const DATA_PACKAGE_FORMAT = 'spacelab-data-package/1';
/** Format of `integrity.json`: a sorted inventory of every other entry's byte length and SHA-256, plus the digest of that inventory. Host-only (`packages/game-library`). */
export const INTEGRITY_FORMAT = 'spacelab-integrity/1';
const retainedFiles = new WeakMap<object, PackageFiles>();
/** Inert source sidecars follow validated runtime values without changing v1 serialization. */
export function rememberPackageFiles(value: object, files: PackageFiles): void { retainedFiles.set(value, files); }
/** Package files previously attached to a validated runtime value, if any. Host-only (`packages/game-library`). */
export function packageFiles(value: object): PackageFiles | undefined { return retainedFiles.get(value); }
/** Attaches `from`'s package files to `to`. Host-only (`packages/game-library`). */
export function copyPackageFiles(from: object, to: object): void { const files = retainedFiles.get(from); if (files) retainedFiles.set(to, files); }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
/** Match JSON's omission of optional undefined fields, while rejecting lossy non-finite values. */
export function jsonBytes(value: unknown): Uint8Array<ArrayBuffer> {
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (typeof item === 'number' && !Number.isFinite(item)) throw new Error('Cannot serialize non-finite data');
    return item;
  });
  if (text === undefined) throw new Error('Expected JSON data');
  return encoder.encode(`${canonicalJson(JSON.parse(text))}\n`);
}
/** UTF-8 bytes of `value`. Host-only (`packages/game-library`). */
export const textBytes = (value: string): Uint8Array<ArrayBuffer> => encoder.encode(value);
/** One inventory entry: package path, byte length and SHA-256. Host-only (`packages/game-library`). */
export interface FileIdentity { readonly path: string; readonly bytes: number; readonly sha256: string }
/** Parsed `integrity.json`: inventory of every entry except itself and the SHA-256 `digest` of its canonical JSON, which identifies the package. Host-only (`packages/game-library`). */
export interface Integrity { readonly format: typeof INTEGRITY_FORMAT; readonly files: readonly FileIdentity[]; readonly digest: string }
/** Validated `module.json` or `data.json`: manifest (v1 or v2), editable `entry` under `src/`, optional `build` (`dist/module.js`, toolchain and inputs digest), compatibility flags, assets under `assets/`, data payloads, guides under `docs/players/` or `docs/creators/`, licensed inputs, source status and an optional `legacy/` original. Host-only (`packages/game-library`). */
export interface ModulePackageDescriptor {
  readonly format: typeof PACKAGE_FORMAT | typeof DATA_PACKAGE_FORMAT;
  readonly manifest: ModuleManifest | ManifestV2;
  readonly entry?: string;
  readonly build?: { readonly bundle: 'dist/module.js'; readonly toolchain: string; readonly inputsDigest: string };
  readonly compatibility: CodeArtifact['compatibility'];
  readonly assets: readonly { readonly path: string; readonly mediaType: string }[];
  readonly data: readonly { readonly kind: 'content' | 'universe' | 'shaders' | 'theme' | 'guides'; readonly path: string }[];
  readonly guides: readonly string[];
  readonly inputs: CodeArtifact['inputs'];
  readonly sourceStatus: 'included' | 'legacy-unavailable';
  readonly legacy?: { readonly path: string; readonly format: string; readonly digest?: string };
}
/** Result of inspecting a module package: descriptor, verified integrity, files, any legacy code artifact, v2 bundle source or legacy content, and whether it is playable (bundle present and current). Host-only (`packages/game-library`). */
export interface InspectedModule {
  readonly descriptor: ModulePackageDescriptor; readonly integrity: Integrity; readonly files: PackageFiles;
  /** Legacy runtime identity is deliberately independent from the complete package identity. */
  readonly code?: CodeArtifact; readonly codeV2?: { readonly source: string; readonly digest: string }; readonly content?: DataModule; readonly playable: boolean;
}

/** Bytes of a required package entry, or throws `Missing package file <path>`. Host-only (`packages/game-library`). */
export function requiredFile(files: PackageFiles, path: string): Uint8Array<ArrayBuffer> {
  const bytes = files.get(artifactPath(path));
  if (!bytes) throw new Error(`Missing package file ${path}`);
  return bytes;
}
/** Sorted `FileIdentity` list of `files`, excluding `integrity.json` by default. Host-only (`packages/game-library`). */
export function inventory(files: PackageFiles, exclude: readonly string[] = ['integrity.json']): FileIdentity[] {
  return [...files].filter(([path]) => !exclude.includes(path)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([path, bytes]) => ({ path, bytes: bytes.length, sha256: sha256Bytes(bytes) }));
}
/** Builds the `integrity.json` value for `files`. Host-only (`packages/game-library`). */
export function createIntegrity(files: PackageFiles): Integrity {
  const body = { format: INTEGRITY_FORMAT, files: inventory(files) } as const;
  return { ...body, digest: sha256Bytes(encoder.encode(canonicalJson(body))) };
}
/** Recomputes the inventory and throws `Package inventory/digest mismatch` unless `integrity.json` matches exactly; returns the frozen integrity. Host-only (`packages/game-library`). */
export function verifyIntegrity(files: PackageFiles): Integrity {
  const raw = parsePackageJson(requiredFile(files, 'integrity.json'), 'Integrity');
  const actual = createIntegrity(files);
  if (canonicalJson(raw) !== canonicalJson(actual)) throw new Error('Package inventory/digest mismatch');
  return freezeJson(actual);
}
/** Source/asset bytes, declared compiler/API provenance and build options are bound together.
 * Generated bundle/integrity and inputsDigest itself are excluded to avoid a cyclic hash. */
export function buildInputsDigest(files: PackageFiles, descriptor: ModulePackageDescriptor): string {
  const { build, ...config } = descriptor;
  return sha256Bytes(encoder.encode(canonicalJson({ descriptor: config, toolchain: build?.toolchain ?? '',
    files: inventory(files, ['module.json', 'integrity.json', 'dist/module.js']) })));
}
function array(raw: unknown, label: string, max = 256): unknown[] {
  if (!Array.isArray(raw) || raw.length > max) throw new Error(`${label}: expected at most ${max} entries`);
  return raw;
}
function safeDigest(raw: unknown): string {
  if (typeof raw !== 'string' || !/^[0-9a-f]{64}$/.test(raw)) throw new Error('Invalid SHA-256 digest');
  return raw;
}
/** Structural authoring validation. Reserved identity recognition requires the
 * verified complete inventory and is enforced by inspectModuleFiles. */
export function validateDescriptor(raw: unknown): ModulePackageDescriptor {
  const d = object(raw, 'Module package');
  keys(d, ['format', 'manifest', 'entry', 'build', 'compatibility', 'assets', 'data', 'guides', 'inputs', 'sourceStatus', 'legacy'], 'Module package');
  if (d.format !== PACKAGE_FORMAT && d.format !== DATA_PACKAGE_FORMAT) throw new Error('Unsupported module package format');
  const manifest = (d.manifest as { format?: unknown })?.format === 'space-sim-module/2' ? validateManifestV2(d.manifest) : validateManifest(d.manifest);
  if (d.format === DATA_PACKAGE_FORMAT && manifest.kind !== 'data') throw new Error('Data files cannot contain executable modules');
  if (!(MODULE_LICENSES as readonly string[]).includes(manifest.license)) throw new Error('Module license is not approved for distribution');
  const compatibility = object(d.compatibility, 'Compatibility'); keys(compatibility, ['deterministic', 'multiplayer'], 'Compatibility');
  if (typeof compatibility.deterministic !== 'boolean' || typeof compatibility.multiplayer !== 'boolean'
    || compatibility.multiplayer && !compatibility.deterministic) throw new Error('Multiplayer requires declared determinism');
  if (d.sourceStatus !== 'included' && d.sourceStatus !== 'legacy-unavailable') throw new Error('Invalid source status');
  const assets = array(d.assets, 'Assets', 1024).map(raw => {
    const a = object(raw, 'Asset'); keys(a, ['path', 'mediaType'], 'Asset');
    const path = artifactPath(a.path), mediaType = string(a.mediaType, 'Asset media type');
    if (!path.startsWith('assets/')) throw new Error('Assets must live under assets/');
    return { path, mediaType };
  });
  const data = array(d.data, 'Data').map(raw => {
    const a = object(raw, 'Data'); keys(a, ['kind', 'path'], 'Data');
    if (!['content', 'universe', 'shaders', 'theme', 'guides'].includes(a.kind as string)) throw new Error('Unknown data payload kind');
    const path = artifactPath(a.path);
    if (!path.startsWith('data/') && !path.startsWith('assets/')) throw new Error('Payloads must live under data/');
    return { kind: a.kind, path } as ModulePackageDescriptor['data'][number];
  });
  const guides = array(d.guides, 'Guides').map(artifactPath);
  for (const path of guides) if (!/^docs\/(players|creators)\/.+\.json$/.test(path)) throw new Error('Guides belong in docs/players or docs/creators');
  for (const list of [assets.map(a => a.path), data.map(a => a.path), guides]) if (new Set(list).size !== list.length) throw new Error('Duplicate descriptor path');
  const inputs = array(d.inputs, 'Inputs').map(raw => {
    const a = object(raw, 'Input'); keys(a, ['path', 'sha256', 'license', 'attribution'], 'Input');
    const path = artifactPath(a.path), sha256 = safeDigest(a.sha256), license = string(a.license, 'Input license');
    if (!(MODULE_LICENSES as readonly string[]).includes(license) || typeof a.attribution !== 'string' || !a.attribution.trim() || a.attribution.length > 65536) throw new Error(`Input ${path}: invalid license or attribution`);
    return { path, sha256, license, attribution: a.attribution };
  });
  if (new Set(inputs.map(i => i.path)).size !== inputs.length) throw new Error('Duplicate licensed input');
  let entry: string | undefined, build: ModulePackageDescriptor['build'], legacy: ModulePackageDescriptor['legacy'];
  if (d.entry !== undefined) { entry = artifactPath(d.entry); if (!entry.startsWith('src/') || !/\.[cm]?[jt]sx?$/.test(entry)) throw new Error('Editable entry must be source under src/'); }
  if (d.build !== undefined) {
    const b = object(d.build, 'Build'); keys(b, ['bundle', 'toolchain', 'inputsDigest'], 'Build');
    if (b.bundle !== 'dist/module.js') throw new Error('Bundle must be dist/module.js');
    build = { bundle: b.bundle, toolchain: string(b.toolchain, 'Toolchain'), inputsDigest: safeDigest(b.inputsDigest) };
  }
  if (d.legacy !== undefined) {
    const l = object(d.legacy, 'Legacy'); keys(l, ['path', 'format', 'digest'], 'Legacy');
    const path = artifactPath(l.path);
    if (!path.startsWith('legacy/')) throw new Error('Legacy originals belong in legacy/');
    legacy = { path, format: string(l.format, 'Legacy format'), ...(l.digest === undefined ? {} : { digest: safeDigest(l.digest) }) };
  }
  if (manifest.format === 'space-sim-module/2' && legacy) throw new Error('V2 modules cannot use legacy code wrappers');
  if (manifest.kind === 'data' && (entry || build || d.sourceStatus !== 'included')) throw new Error('Data packages have no executable entry/bundle');
  if (manifest.kind === 'provider' && (d.sourceStatus === 'included' ? !entry || legacy !== undefined : !legacy || entry !== undefined || build !== undefined)) throw new Error('Code requires editable source, or an explicit source-unavailable legacy wrapper');
  return freezeJson({ format: d.format, manifest, ...(entry ? { entry } : {}), ...(build ? { build } : {}),
    compatibility: compatibility as unknown as CodeArtifact['compatibility'], assets, data, guides, inputs, sourceStatus: d.sourceStatus, ...(legacy ? { legacy } : {}) });
}
function validateGuide(bytes: Uint8Array): void {
  // Structured data only; the future guide renderer owns allowlisted node interpretation.
  const raw = object(parsePackageJson(bytes, 'Guide', 64 * 1024), 'Guide');
  keys(raw, ['id', 'audience', 'title', 'summary', 'blocks'], 'Guide');
  if (!['players', 'creators'].includes(raw.audience as string)) throw new Error('Guide audience must be players or creators');
  string(raw.id, 'Guide ID'); string(raw.title, 'Guide title'); string(raw.summary, 'Guide summary');
  // Same bounded block schema the Manual renders, including lists and page links.
  captureDocument(raw);
}
/** Validate source packages inertly; playable=false permits missing/stale bundles for inspection.
 * At most 1,024 entries and 64 MiB expanded (`Module file count exceeded`, `Module expanded size limit exceeded`),
 * per-entry limits from `fileLimit`, and only `module.json`, `data.json`, `integrity.json`, `LICENSE`, `NOTICE` and files
 * under `src/`, `dist/`, `assets/`, `data/`, `docs/`, `tests/` or `legacy/`; nested `.spacemod`, `.spacedata`, `.spacegame`
 * and `.spaceuniverse` files fail with `Unsupported module entry <path>`. `builtin.*` IDs need an exact shipped catalogue pin.
 * A playable inspection of a missing or stale bundle fails with `Rebuild this module with module:build, then pack it again.` */
export function inspectModuleFiles(files: PackageFiles, playable = true, options: ShippedPackageOptions = {}): InspectedModule {
  if (files.size > 1024) throw new Error('Module file count exceeded');
  validateFilePaths([...files.keys()]);
  let total = 0;
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (bytes.length > fileLimit(path) || total > 64 * 1024 * 1024) throw new Error('Module expanded size limit exceeded');
    if (!/^(module\.json|data\.json|integrity\.json|LICENSE|NOTICE|(?:src|dist|assets|data|docs|tests|legacy)\/.+)$/.test(path) || /\.(spacemod|spacedata|spacegame|spaceuniverse)$/i.test(path)) throw new Error(`Unsupported module entry ${path}`);
  }
  if (files.has('module.json') === files.has('data.json')) throw new Error('Expected exactly one module.json or data.json descriptor');
  const descriptorPath = files.has('data.json') ? 'data.json' : 'module.json';
  const integrity = verifyIntegrity(files), descriptor = validateDescriptor(parsePackageJson(requiredFile(files, descriptorPath), 'Package descriptor'));
  if (descriptor.manifest.id.startsWith('builtin.')
    && !options.shipped?.recognizes(descriptor.manifest.id, descriptor.manifest.version, integrity.digest))
    throw new Error('Imported builtin identities require an exact shipped catalogue pin; fork under a creator namespace');
  if ((descriptor.format === DATA_PACKAGE_FORMAT) !== (descriptorPath === 'data.json')) throw new Error('Data files use data.json with spacelab-data-package/1');
  if (!decoder.decode(requiredFile(files, 'LICENSE')).trim() || !decoder.decode(requiredFile(files, 'NOTICE')).trim()) throw new Error('Include license texts and provenance');
  const d = descriptor;
  for (const a of d.assets) requiredFile(files, a.path);
  for (const path of d.guides) validateGuide(requiredFile(files, path));
  for (const [path] of files) if (path.startsWith('docs/')) {
    if (!d.guides.includes(path)) throw new Error(`Undeclared guide ${path}`);
  }
  let content: DataModule | undefined;
  for (const payload of d.data) {
    const raw = parsePackageJson(requiredFile(files, payload.path), `Data ${payload.path}`);
    if (payload.kind === 'content') {
      if (content) throw new Error('Only one legacy content payload per module');
      content = validateDataModule(raw);
      if (canonicalJson(content.manifest) !== canonicalJson(d.manifest)) throw new Error('Content manifest differs from descriptor');
    } else if (payload.kind === 'universe') {
      validateUniverse(raw);
      if (('tier' in d.manifest ? d.manifest.tier : d.manifest.authority) !== 'authoritative') throw new Error('Universes require authoritative data');
    } else if (payload.kind === 'guides') validateGuide(requiredFile(files, payload.path));
    else if (payload.kind === 'theme') throw new Error('Theme payload registration requires API v2; unsupported in Phase 1');
    else validateShaderPayload(raw);
  }
  if (d.manifest.kind === 'data' && (!d.data.length || [...files.keys()].some(p => p.startsWith('src/') || p.startsWith('dist/')))) throw new Error('Data packages require payloads and contain no executable source');
  let code: CodeArtifact | undefined, codeV2: InspectedModule['codeV2'], ready = true;
  if (d.sourceStatus === 'legacy-unavailable') {
    const original = requiredFile(files, d.legacy!.path);
    code = parseCodeArtifact(decoder.decode(original));
    if (d.legacy!.format !== code.format || d.legacy!.digest !== code.digest || canonicalJson(code.manifest) !== canonicalJson(d.manifest)
      || canonicalJson(code.compatibility) !== canonicalJson(d.compatibility) || canonicalJson(code.inputs) !== canonicalJson(d.inputs)
      || decoder.decode(requiredFile(files, 'dist/module.js')) !== code.source) throw new Error('Legacy wrapper differs from its original artifact');
    for (const [path, text] of Object.entries(code.assets)) if (decoder.decode(requiredFile(files, `assets/${path}`)) !== text) throw new Error('Legacy asset mismatch');
    if ([...files.keys()].some(p => p.startsWith('src/'))) throw new Error('Source-unavailable wrappers cannot claim editable source');
  } else if (d.manifest.kind === 'provider') {
    requiredFile(files, d.entry!);
    let licensedInputsMatch = true;
    for (const input of d.inputs) if (!input.path.startsWith('game-api/')) {
      if (sha256Bytes(requiredFile(files, input.path)) !== input.sha256) licensedInputsMatch = false;
    }
    ready = licensedInputsMatch && !!d.build && files.has('dist/module.js') && d.build.inputsDigest === buildInputsDigest(files, d);
    if (ready && d.manifest.format === 'space-sim-module/2') {
      codeV2 = { source: decoder.decode(requiredFile(files, 'dist/module.js')), digest: integrity.digest };
    } else if (ready && d.manifest.format === 'space-sim-module/1') {
      const assets: Record<string, string> = Object.create(null);
      for (const a of d.assets) {
        // Binary assets are preserved, but API v1 can only expose UTF-8 text.
        if (a.mediaType.startsWith('text/') || a.mediaType === 'application/json') assets[a.path] = decoder.decode(requiredFile(files, a.path));
      }
      const body = { format: 'space-sim-code-module/1', manifest: d.manifest, source: decoder.decode(requiredFile(files, 'dist/module.js')),
        assets, inputs: d.inputs, compatibility: d.compatibility } as const;
      code = parseCodeArtifact(JSON.stringify({ ...body, digest: artifactDigest(body) }));
    }
  }
  if (playable && !ready) throw new Error('Rebuild this module with module:build, then pack it again.');
  if (code) rememberPackageFiles(code, files);
  if (content) rememberPackageFiles(content, files);
  return { descriptor, integrity, files, ...(code ? { code } : {}), ...(content ? { content } : {}), ...(codeV2 ? { codeV2 } : {}), playable: ready };
}
/** Preserve the existing partial three-pass shader ABI. Defaults are filled by parseShaderFile. */
export function validateShaderPayload(raw: unknown): void {
  const shader = object(raw, 'Shader pack'); keys(shader, ['format', 'name', 'passes'], 'Shader pack');
  if (shader.format !== 'space-sim-shaders/1' || typeof shader.name !== 'string' || !shader.name.trim() || shader.name.length > 80) throw new Error('Invalid shader pack');
  const passes = object(shader.passes, 'Shader passes'); keys(passes, ['scene', 'vector', 'text'], 'Shader passes');
  if (!Object.keys(passes).length) throw new Error('Provide a shader pass');
  for (const [name, raw] of Object.entries(passes)) {
    const stages = object(raw, name); keys(stages, ['vertex', 'fragment'], name);
    for (const source of Object.values(stages)) if (typeof source !== 'string' || !source.trim() || source.length > 256 * 1024) throw new Error('Invalid shader source');
  }
}
/** Writes `integrity.json`, inspects the complete package as playable and returns a reproducible ZIP. Host-only (`packages/game-library`). */
export async function encodeModuleFiles(files: PackageFiles, options: ZipOptions & ShippedPackageOptions & { readonly compression?: 'store' | 'deflate' | 'auto' } = {}): Promise<Uint8Array<ArrayBuffer>> {
  const complete = new Map(files); complete.set('integrity.json', jsonBytes(createIntegrity(complete)));
  inspectModuleFiles(complete, true, options);
  return writeZip(complete, options);
}
/** Reads a `.spacemod` or `.spacedata` ZIP within the archive limits and inspects it (playable by default). Never runs code. Host-only (`packages/game-library`). */
export async function decodeModulePackage(bytes: Uint8Array<ArrayBuffer>, options: ZipOptions & ShippedPackageOptions & { readonly playable?: boolean } = {}): Promise<InspectedModule> {
  return inspectModuleFiles(await readZip(bytes, options), options.playable ?? true, options);
}
/** Lossless legacy adapter. The source-input hashes do not contain the original TypeScript. */
export function wrapLegacyCode(artifact: CodeArtifact): Map<string, Uint8Array<ArrayBuffer>> {
  const checked = parseCodeArtifact(JSON.stringify(artifact));
  const descriptor: ModulePackageDescriptor = { format: PACKAGE_FORMAT, manifest: checked.manifest, compatibility: checked.compatibility,
    assets: Object.keys(checked.assets).map(path => ({ path: `assets/${path}`, mediaType: 'text/plain' })), data: [], guides: [], inputs: checked.inputs,
    sourceStatus: 'legacy-unavailable', legacy: { path: 'legacy/artifact.json', format: checked.format, digest: checked.digest } };
  const files = new Map([['module.json', jsonBytes(descriptor)], ['legacy/artifact.json', jsonBytes(checked)], ['dist/module.js', textBytes(checked.source)],
    ['LICENSE', textBytes(checked.inputs.map(i => `${i.license}\n${i.attribution}`).join('\n\n'))], ['NOTICE', textBytes('Original source unavailable. Bundled inputs:\n' + checked.inputs.map(i => `${i.path} ${i.sha256}\n${i.attribution}`).join('\n'))]]);
  for (const [path, value] of Object.entries(checked.assets)) files.set(`assets/${path}`, textBytes(value));
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return files;
}
/** Wraps a legacy `space-sim-data-module/1` value as `.spacedata` files with its exact content, the supplied licence text and fresh integrity. Host-only (`packages/game-library`). */
export function wrapLegacyData(raw: DataModule, licenseText: string): Map<string, Uint8Array<ArrayBuffer>> {
  const content = validateDataModule(raw);
  const descriptor: ModulePackageDescriptor = { format: DATA_PACKAGE_FORMAT, manifest: content.manifest, compatibility: { deterministic: true, multiplayer: true },
    assets: [], data: [{ kind: 'content', path: 'data/content.json' }], guides: [], inputs: [], sourceStatus: 'included' };
  const files = new Map([['data.json', jsonBytes(descriptor)], ['data/content.json', jsonBytes(content)], ['LICENSE', textBytes(licenseText)],
    ['NOTICE', textBytes('Legacy data module; exact original content retained. License: ' + content.manifest.license)]]);
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return files;
}

/** Convert validated legacy data using the existing world schema and unchanged float64 values. */
export function wrapUniversePackage(raw: unknown, licenseText: string, license = 'MIT'): Map<string, Uint8Array<ArrayBuffer>> {
  const universe = validateUniverse(raw), suffix = universe.id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'world';
  const manifest: ModuleManifest = { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: `local.universe-${suffix}`, name: universe.name,
    version: '0.1.0', kind: 'data', authority: 'authoritative', environments: ['browser', 'offline', 'node'], dependencies: [], provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license };
  const files = wrapLegacyData({ format: 'space-sim-data-module/1', manifest, data: { universes: [{ definition: universe }] } }, licenseText);
  files.set('data/universe.json', jsonBytes(universe));
  const d = validateDescriptor(parsePackageJson(requiredFile(files, 'data.json'), 'Descriptor'));
  files.set('data.json', jsonBytes({ ...d, data: [...d.data, { kind: 'universe', path: 'data/universe.json' }] }));
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return files;
}
/** Wraps a `space-sim-shaders/1` pack as presentation data package `local.shader-<name>` with licence text and integrity. Host-only (`packages/game-library`). */
export function wrapShaderPackage(raw: unknown, licenseText: string, license = 'MIT'): Map<string, Uint8Array<ArrayBuffer>> {
  validateShaderPayload(raw);
  const shader = raw as { name: string }, suffix = shader.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '') || 'shader';
  const manifest: ModuleManifest = { format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1', id: `local.shader-${suffix}`, name: shader.name,
    version: '0.1.0', kind: 'data', authority: 'presentation', environments: ['browser', 'offline'], dependencies: [], provides: [], requires: [], slots: [], before: [], after: [], settings: {}, license };
  const descriptor: ModulePackageDescriptor = { format: DATA_PACKAGE_FORMAT, manifest, compatibility: { deterministic: true, multiplayer: false }, assets: [],
    data: [{ kind: 'shaders', path: 'data/shaders.json' }], guides: [], inputs: [], sourceStatus: 'included' };
  const files = new Map([['data.json', jsonBytes(descriptor)], ['data/shaders.json', jsonBytes(raw)], ['LICENSE', textBytes(licenseText)],
    ['NOTICE', textBytes('Original three-pass shader pack; inherits the current renderer defaults.')]]);
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  return files;
}
/** Dedicated importer payload; existing universe/shader validators still supply runtime defaults. */
export function modulePayload(module: InspectedModule, kind: ModulePackageDescriptor['data'][number]['kind']): unknown {
  const payloads = module.descriptor.data.filter(p => p.kind === kind);
  if (payloads.length !== 1) throw new Error(`Expected one ${kind} payload`);
  return parsePackageJson(requiredFile(module.files, payloads[0]!.path), kind);
}
