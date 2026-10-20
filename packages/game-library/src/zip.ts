/** Host-only bounded ZIP reader and reproducible writer (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`). */
import { artifactPath } from '../../game-runtime/src/artifact';
import { MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES } from './compression';

/** Package entries by path. Host-only (`packages/game-library`). */
export type PackageFiles = ReadonlyMap<string, Uint8Array<ArrayBuffer>>;
/** Shared by an outer game and its embedded modules. Counts actual expanded bytes, not claims. */
export interface ArchiveBudget { bytes: number; files: number }
/** ZIP options: abort signal, shared expanded-byte budget and file-count limit (default `MAX_PACKAGE_FILES`). Host-only (`packages/game-library`). */
export interface ZipOptions { readonly signal?: AbortSignal; readonly budget?: ArchiveBudget; readonly maxFiles?: number }
const encoder = new TextEncoder(), decoder = new TextDecoder('utf-8', { fatal: true });
/** Most entries in one package archive (`1024`; `ZIP file count limit exceeded`). Host-only (`packages/game-library`). */
export const MAX_PACKAGE_FILES = 1024;
/** Most entries across a game and all its embedded packages (`263168`; `Aggregate ZIP file count exceeded`). Host-only (`packages/game-library`). */
export const MAX_GAME_FILES = 256 * MAX_PACKAGE_FILES + 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, i) => {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
/** Standard ZIP CRC-32 of `bytes`. Host-only (`packages/game-library`). */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
/** Whether `bytes` start with the ZIP `PK` signature. Host-only (`packages/game-library`). */
export const isZip = (bytes: Uint8Array): boolean => bytes[0] === 0x50 && bytes[1] === 0x4b;
/** Largest expanded size of one entry: 1 MiB for descriptors, locks, `integrity.json` and JSON under `docs/`, `assets/`, `data/` or `state/`; 4 MiB for `dist/module.js` and `legacy/` files; 32 MiB for embedded `.spacemod` or `.spacedata` packages and a join pack's `game.spacegame`; 8 MiB for other entries. Host-only (`packages/game-library`). */
export function fileLimit(path: string): number {
  if (path === 'game.spacegame') return MAX_ARCHIVE_BYTES; // bounded prejoin wire container member
  return path === 'module.json' || path === 'data.json' || path === 'save.json' || path === 'game.json' || path === 'game.lock.json' || path === 'integrity.json'
    || path.endsWith('.json') && (path.startsWith('docs/') || path.startsWith('assets/') || path.startsWith('data/') || path.startsWith('state/')) ? 1024 * 1024
    : path === 'dist/module.js' ? 4 * 1024 * 1024 : (path.startsWith('modules/') && path.endsWith('.spacemod') || path.startsWith('data/') && path.endsWith('.spacedata')) ? MAX_ARCHIVE_BYTES
      : path.startsWith('legacy/') ? 4 * 1024 * 1024 : 8 * 1024 * 1024;
}
/** Enforces collisions including implied directories, independently of ZIP entry ordering. */
export function validateFilePaths(paths: readonly string[]): void {
  const seen = new Map<string, 'file' | 'directory'>(), explicit = new Set<string>();
  for (const path of paths) {
    const dir = path.endsWith('/'), name = dir ? path.slice(0, -1) : path;
    artifactPath(name);
    const folded = name.toLowerCase();
    if (explicit.has(folded)) throw new Error(`Duplicate or case-colliding path: ${name}`);
    explicit.add(folded);
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) {
      const parent = parts.slice(0, i).join('/').toLowerCase();
      if (seen.get(parent) === 'file') throw new Error(`File/directory conflict: ${path}`);
      seen.set(parent, 'directory');
    }
    if (seen.has(folded) && (!dir || seen.get(folded) === 'file')) throw new Error(`File/directory conflict: ${path}`);
    seen.set(folded, dir ? 'directory' : 'file');
  }
  // A/B and a/C also collide, even though neither explicitly names its parent.
  const spelling = new Map<string, string>();
  for (const path of paths) {
    const parts = path.replace(/\/$/, '').split('/');
    for (let i = 1; i <= parts.length; i++) {
      const prefix = parts.slice(0, i).join('/'), folded = prefix.toLowerCase();
      if (spelling.has(folded) && spelling.get(folded) !== prefix) throw new Error(`Case-colliding path: ${path}`);
      spelling.set(folded, prefix);
    }
  }
}
function charge(budget: ArchiveBudget, count: number, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  budget.bytes += count;
  if (budget.bytes > MAX_EXPANDED_BYTES) throw new Error('Archive exceeds expanded size limit (64 MiB)');
}
async function transform(bytes: Uint8Array<ArrayBuffer>, compress: boolean, maximum: number,
  signal?: AbortSignal, onChunk?: (length: number) => void): Promise<Uint8Array<ArrayBuffer>> {
  let codec: TransformStream<Uint8Array<ArrayBuffer>, Uint8Array<ArrayBuffer>>;
  try { codec = compress ? new CompressionStream('deflate-raw') : new DecompressionStream('deflate-raw'); }
  catch { throw new Error('Raw DEFLATE is unavailable here; request a stored (uncompressed ZIP) export'); }
  const reader = new Blob([bytes]).stream().pipeThrough(codec).getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel(signal?.reason).catch(() => {}); };
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    signal?.throwIfAborted();
    while (true) {
      const next = await reader.read();
      signal?.throwIfAborted();
      if (next.done) break;
      size += next.value.length;
      if (size > maximum) throw new Error('ZIP entry exceeds expanded size limit');
      onChunk?.(next.value.length);
      chunks.push(next.value);
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { signal?.removeEventListener('abort', cancel); reader.releaseLock(); }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
  return output;
}
function extras(view: DataView, offset: number, length: number): void {
  const end = offset + length;
  while (offset < end) {
    if (offset + 4 > end) throw new Error('Truncated ZIP extra field');
    const tag = view.getUint16(offset, true), size = view.getUint16(offset + 2, true);
    if (tag === 1) throw new Error('ZIP64 is unsupported');
    offset += 4 + size;
  }
  if (offset !== end) throw new Error('Invalid ZIP extra field');
}
/** Bounded standard ZIP inspection. Never executes or extracts to the filesystem. */
export async function readZip(bytes: Uint8Array<ArrayBuffer>, options: ZipOptions = {}): Promise<Map<string, Uint8Array<ArrayBuffer>>> {
  options.signal?.throwIfAborted();
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('Archive exceeds compressed size limit (32 MiB)');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  for (; end >= Math.max(0, bytes.length - 65557); end--) {
    if (view.getUint32(end, true) === 0x06054b50 && end + 22 + view.getUint16(end + 20, true) === bytes.length) break;
  }
  if (end < 0 || end < bytes.length - 65557) throw new Error('Missing or truncated ZIP directory');
  const count = view.getUint16(end + 10, true), centralSize = view.getUint32(end + 12, true), centralStart = view.getUint32(end + 16, true);
  if (view.getUint16(end + 4, true) || view.getUint16(end + 6, true) || count !== view.getUint16(end + 8, true)) throw new Error('Multipart ZIP is unsupported');
  if (count === 65535 || centralSize === 0xffffffff || centralStart === 0xffffffff) throw new Error('ZIP64 is unsupported');
  if (centralStart + centralSize !== end) throw new Error('Inconsistent ZIP directory');
  if (count > (options.maxFiles ?? MAX_PACKAGE_FILES)) throw new Error('ZIP file count limit exceeded');
  const records: { path: string; start: number; end: number; data: number; packed: number; size: number; crc: number; method: number; directory: boolean }[] = [];
  let offset = centralStart;
  for (let i = 0; i < count; i++) {
    options.signal?.throwIfAborted();
    if (offset + 46 > end || view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid ZIP directory entry');
    const flags = view.getUint16(offset + 8, true), method = view.getUint16(offset + 10, true), crc = view.getUint32(offset + 16, true);
    const packed = view.getUint32(offset + 20, true), size = view.getUint32(offset + 24, true), n = view.getUint16(offset + 28, true);
    const x = view.getUint16(offset + 30, true), comment = view.getUint16(offset + 32, true), start = view.getUint32(offset + 42, true);
    const attrs = view.getUint32(offset + 38, true), mode = attrs >>> 16, type = mode & 0xf000;
    if (flags & ~0x080e || flags & 1 || ![0, 8].includes(method)) throw new Error('Encrypted or unsupported ZIP entry');
    if (method === 0 && flags & 6) throw new Error('Invalid stored ZIP flags');
    if (view.getUint16(offset + 34, true) || packed === 0xffffffff || size === 0xffffffff || start === 0xffffffff) throw new Error('Multipart or ZIP64 entry is unsupported');
    if (offset + 46 + n + x + comment > end) throw new Error('Truncated ZIP name');
    const path = decoder.decode(bytes.subarray(offset + 46, offset + 46 + n));
    const directory = path.endsWith('/');
    if (type && type !== (directory ? 0x4000 : 0x8000) || !directory && (mode & 0o111 || attrs & 0x10)) throw new Error('ZIP accepts regular files only; links/devices/executables are forbidden');
    if (size > fileLimit(path) || directory && size !== 0) throw new Error('ZIP entry exceeds size limit or invalid directory');
    extras(view, offset + 46 + n, x);
    if (start + 30 > centralStart || view.getUint32(start, true) !== 0x04034b50) throw new Error('Invalid local ZIP header');
    const ln = view.getUint16(start + 26, true), lx = view.getUint16(start + 28, true), data = start + 30 + ln + lx;
    if (data + packed > centralStart || view.getUint16(start + 6, true) !== flags || view.getUint16(start + 8, true) !== method
      || decoder.decode(bytes.subarray(start + 30, start + 30 + ln)) !== path) throw new Error('ZIP local/central header mismatch');
    extras(view, start + 30 + ln, lx);
    const localCrc = view.getUint32(start + 14, true), localPacked = view.getUint32(start + 18, true), localSize = view.getUint32(start + 22, true);
    if (!(flags & 8) && (localCrc !== crc || localPacked !== packed || localSize !== size)
      || flags & 8 && (localCrc !== 0 && localCrc !== crc || localPacked !== 0 && localPacked !== packed || localSize !== 0 && localSize !== size)) throw new Error('ZIP local/central size or CRC mismatch');
    let recordEnd = data + packed;
    if (flags & 8) {
      if (recordEnd + 12 > centralStart) throw new Error('Truncated ZIP data descriptor');
      if (view.getUint32(recordEnd, true) === 0x08074b50) recordEnd += 4;
      if (recordEnd + 12 > centralStart || view.getUint32(recordEnd, true) !== crc || view.getUint32(recordEnd + 4, true) !== packed || view.getUint32(recordEnd + 8, true) !== size) throw new Error('ZIP data descriptor mismatch');
      recordEnd += 12;
    }
    records.push({ path, start, end: recordEnd, data, packed, size, crc, method, directory });
    offset += 46 + n + x + comment;
  }
  if (offset !== end) throw new Error('Inconsistent ZIP directory size');
  validateFilePaths(records.map(r => r.path));
  const ordered = [...records].sort((a, b) => a.start - b.start);
  for (let i = 1; i < ordered.length; i++) if (ordered[i]!.start < ordered[i - 1]!.end) throw new Error('Overlapping ZIP entries');
  const budget = options.budget ?? { bytes: 0, files: 0 }, files = new Map<string, Uint8Array<ArrayBuffer>>();
  for (const r of records) {
    if (++budget.files > MAX_GAME_FILES) throw new Error('Aggregate ZIP file count exceeded');
    const packed = bytes.subarray(r.data, r.data + r.packed);
    let expanded;
    if (r.method === 0) { charge(budget, packed.length, options.signal); expanded = packed; }
    else expanded = await transform(packed, false, Math.min(r.size, fileLimit(r.path)), options.signal, n => charge(budget, n, options.signal));
    if (expanded.length !== r.size || crc32(expanded) !== r.crc) throw new Error(`ZIP size/CRC mismatch: ${r.path}`);
    if (!r.directory) files.set(r.path, expanded);
  }
  return files;
}
/** Sorted entries, fixed DOS date and regular-file metadata give reproducible output.
 * Stored ZIP is the universal fallback; DEFLATE is selected only when supported. */
export async function writeZip(files: PackageFiles, options: ZipOptions & { readonly compression?: 'store' | 'deflate' | 'auto' } = {}): Promise<Uint8Array<ArrayBuffer>> {
  options.signal?.throwIfAborted();
  const entries = [...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
  if (entries.length >= 65535 || entries.length > (options.maxFiles ?? MAX_PACKAGE_FILES)) throw new Error('ZIP file count limit exceeded');
  validateFilePaths(entries.map(([path]) => path));
  const local: Uint8Array<ArrayBuffer>[] = [], central: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0, expanded = 0, deflate = options.compression !== 'store';
  if (deflate) {
    try { new CompressionStream('deflate-raw'); }
    catch { if (options.compression === 'deflate') throw new Error('Raw DEFLATE unavailable; choose store'); deflate = false; }
  }
  for (const [path, bytes] of entries) {
    options.signal?.throwIfAborted();
    expanded += bytes.length;
    if (bytes.length > fileLimit(path) || expanded > MAX_EXPANDED_BYTES) throw new Error('ZIP expanded size limit exceeded');
    const name = encoder.encode(path), packed = deflate ? await transform(bytes, true, MAX_ARCHIVE_BYTES, options.signal) : bytes;
    const method = deflate ? 8 : 0, crc = crc32(bytes);
    const header = new Uint8Array(30 + name.length), h = new DataView(header.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x800, true); h.setUint16(8, method, true);
    h.setUint16(12, 33, true); h.setUint32(14, crc, true); h.setUint32(18, packed.length, true); h.setUint32(22, bytes.length, true);
    h.setUint16(26, name.length, true); header.set(name, 30);
    const record = new Uint8Array(46 + name.length), c = new DataView(record.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true); c.setUint16(10, method, true);
    c.setUint16(14, 33, true); c.setUint32(16, crc, true); c.setUint32(20, packed.length, true); c.setUint32(24, bytes.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true); record.set(name, 46);
    local.push(header, packed); central.push(record); offset += header.length + packed.length;
    if (offset > MAX_ARCHIVE_BYTES) throw new Error('ZIP compressed size limit exceeded');
  }
  const directorySize = central.reduce((n, b) => n + b.length, 0), end = new Uint8Array(22), e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, entries.length, true); e.setUint16(10, entries.length, true);
  e.setUint32(12, directorySize, true); e.setUint32(16, offset, true);
  const size = offset + directorySize + 22;
  if (size > MAX_ARCHIVE_BYTES) throw new Error('ZIP compressed size limit exceeded');
  const result = new Uint8Array(size);
  let position = 0;
  for (const chunk of [...local, ...central, end]) { result.set(chunk, position); position += chunk.length; }
  return result;
}
