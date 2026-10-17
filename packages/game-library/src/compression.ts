export const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
export const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
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
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(expanded));
}
