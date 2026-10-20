/** Host-only archive size limits and gzip JSON helpers (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`). */
import { parsePackageJson } from './json';
/** Largest compressed file or ZIP archive (32 MiB; `Archive exceeds compressed size limit (32 MiB)`). Host-only (`packages/game-library`). */
export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
/** Largest expanded size of one archive, shared by a game and its embedded packages (64 MiB; `Archive exceeds expanded size limit (64 MiB)`). Host-only (`packages/game-library`). */
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
/** Whether `bytes` start with the gzip signature. Host-only (`packages/game-library`). */
export const isCompressed = (bytes: Uint8Array): boolean => bytes[0] === 0x1f && bytes[1] === 0x8b;

async function bounded(stream: ReadableStream<Uint8Array>, maximum: number): Promise<Uint8Array<ArrayBuffer>> {
  const reader = stream.getReader(), chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.length;
      if (length > maximum) { await reader.cancel(); throw new Error('File exceeds the expanded size limit'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
/** Lossless standard gzip; no quantization or rounding of model numbers. */
export async function compressJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > MAX_EXPANDED_BYTES) throw new Error('File exceeds the expanded size limit');
  return bounded(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip')), MAX_ARCHIVE_BYTES);
}
/** Sniff contents so JSON, .json.gz and custom compressed extensions share one route. */
export async function readJsonFile(bytes: Uint8Array<ArrayBuffer>, compressedOnly = false): Promise<unknown> {
  if (bytes.length > MAX_ARCHIVE_BYTES) throw new Error('File exceeds the compressed size limit (32 MiB)');
  const compressed = isCompressed(bytes);
  if (compressedOnly && !compressed) throw new Error('Expected a gzip-compressed file');
  const expanded = compressed
    ? await bounded(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_EXPANDED_BYTES) : bytes;
  return parsePackageJson(expanded, 'Legacy JSON file', MAX_EXPANDED_BYTES, 4 * 1024 * 1024);
}
