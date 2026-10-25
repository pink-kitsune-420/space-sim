/*
 * Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
 * SPDX-License-Identifier: LicenseRef-Project
 * Proprietary Space Sim game code; personal, non-commercial evaluation only.
 * See ../../../games/space-sim-successor/LICENSE-GAME.txt for the full terms.
 */

import { createPlanetBake, type PlanetSurfaceDefinition, type RenderOverview, type SurfaceProfile } from '../../../packages/game-api/src/index';
import { sha256Bytes } from '../../../packages/game-runtime/src/authoritative';
import { planetDefinitionForSamples, PLANET_SURFACE_MAP } from '../../../packages/sim-core/src/planet-surface';
import { surfaceIdentity, surfaceFromPlanetBake } from '../../../packages/sim-core/src/surface';
import { decodeStarterProducts, STARTER_PRODUCT_MAX_BYTES, STARTER_PRODUCT_FORMAT, type StarterProduct } from './starter-product-format';
import { MATERIAL_DOMAINS } from './successor-materials';
import { overviewWork } from './successor-overview';
import { loadingPaint, loadingYield, type LoadingProgress } from './loading';

type StarterBody = { readonly id: string; readonly name?: string; readonly radius: number; readonly surface: PlanetSurfaceDefinition };
export interface PreparedStarterWorlds {
  readonly profiles: ReadonlyMap<string, SurfaceProfile>;
  readonly overviews: ReadonlyMap<string, RenderOverview>;
  readonly sources: readonly { body: string; source: 'prepared' | 'generated'; reason?: string }[];
}
const hex = (bytes: ArrayBuffer) => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
async function digest(bytes: Uint8Array): Promise<string> {
  return globalThis.crypto?.subtle ? hex(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>)) : sha256Bytes(bytes);
}
async function readBounded(stream: ReadableStream<Uint8Array>, expected: number, signal: AbortSignal, progress?: (n: number) => void): Promise<Uint8Array> {
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let count = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    for (;;) {
      const next = await reader.read(); signal.throwIfAborted(); if (next.done) break;
      count += next.value.length; if (count > expected) throw Error('Prepared product exceeds declared size');
      chunks.push(next.value); progress?.(count);
    }
    if (count !== expected) throw Error('Prepared product is incomplete');
    const bytes = new Uint8Array(expected); let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    return bytes;
  } finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
async function readProduct(p: StarterProduct, signal: AbortSignal, onprogress: (value: LoadingProgress) => void): Promise<Uint8Array> {
  if (p.format !== STARTER_PRODUCT_FORMAT || !Number.isInteger(p.bytes) || p.bytes < 1 || p.bytes > STARTER_PRODUCT_MAX_BYTES
    || !Number.isInteger(p.compressedBytes) || p.compressedBytes < 1 || p.compressedBytes > STARTER_PRODUCT_MAX_BYTES
    || !/^[a-f0-9]{64}$/.test(p.digest) || !/^[a-f0-9]{64}$/.test(p.rawDigest)
    || !/^[a-f0-9]{64}$/.test(p.sourceIdentity) || !/^starter-products\/(planet|moon)-[a-f0-9]{16}\.bin$/.test(p.path)) throw Error('Incompatible prepared product');
  let compressed: Uint8Array;
  const embedded = document.getElementById('starter-product-' + p.digest);
  const stage = `Reading ${p.bodyId === 'planet' ? 'Primus' : 'Parvus'}`;
  if (location.protocol === 'file:') {
    if (!embedded) throw Error('Embedded starter product is missing');
    const text = embedded.textContent ?? '';
    if (text.length !== Math.ceil(p.compressedBytes / 3) * 4) throw Error('Invalid embedded product length');
    compressed = new Uint8Array(p.compressedBytes); let cursor = 0, yieldedAt = performance.now();
    for (let i = 0; i < text.length; i += 65536) {
      signal.throwIfAborted(); const decoded = atob(text.slice(i, i + 65536));
      for (let j = 0; j < decoded.length; j++) compressed[cursor++] = decoded.charCodeAt(j);
      onprogress({ stage, done: cursor, total: p.compressedBytes });
      if (performance.now() - yieldedAt >= 6 || cursor === p.compressedBytes) { await loadingYield(); yieldedAt = performance.now(); }
    }
  } else {
    const response = await fetch(new URL(p.path, document.baseURI), { signal });
    if (!response.ok || !response.body) throw Error(`Prepared world unavailable (${response.status})`);
    compressed = await readBounded(response.body, p.compressedBytes, signal, done => onprogress({ stage, done, total: p.compressedBytes }));
  }
  onprogress({ stage: `Checking ${p.bodyId === 'planet' ? 'Primus' : 'Parvus'}` }); await loadingPaint();
  if (await digest(compressed) !== p.digest) throw Error('Prepared world checksum differs'); signal.throwIfAborted();
  const decompressed = new Blob([compressed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('gzip'));
  const bytes = await readBounded(decompressed, p.bytes, signal);
  if (await digest(bytes) !== p.rawDigest) throw Error('Prepared world samples differ'); signal.throwIfAborted();
  return bytes;
}

/** Candidate-owned products only. Exact built-in surface identities select reuse;
 * custom/missing/stale/corrupt products use the same bounded deterministic bake.
 * No session is activated, changed or simulated here. Abort discards all results. */
export async function prepareStarterWorlds(bodies: readonly StarterBody[], products: readonly StarterProduct[], signal: AbortSignal,
  onprogress: (value: LoadingProgress) => void): Promise<PreparedStarterWorlds> {
  if (bodies.length > 4) throw Error('Starter body budget exceeded');
  const profiles = new Map<string, SurfaceProfile>(), overviews = new Map<string, RenderOverview>();
  const sources: { body: string; source: 'prepared' | 'generated'; reason?: string }[] = [];
  for (const body of bodies) {
    signal.throwIfAborted(); const identity = surfaceIdentity(body), label = body.name ?? (body.id === 'planet' ? 'Primus' : body.id === 'moon' ? 'Parvus' : body.id);
    const product = products.find(p => p.bodyId === body.id && p.surfaceIdentity === identity);
    onprogress({ stage: `Reading ${label}` }); await loadingPaint(); signal.throwIfAborted();
    let reason = 'No compatible prepared world';
    if (product) try {
      const bytes = await readProduct(product, signal, onprogress);
      const decoded = decodeStarterProducts(product, bytes);
      const profile = surfaceFromPlanetBake(body, decoded.physical);
      if (decoded.overview.planet?.identity !== profile.planet!.identity + ':north-rgba/1'
        || decoded.overview.planet.size !== 512 || decoded.overview.planet.rgba.length !== 512 * 512 * 4
        || decoded.overview.planet.equator.length !== profile.sampleCount * 4 || !decoded.overview.surface) throw Error('Prepared map identity differs');
      profiles.set(body.id, profile); overviews.set(body.id, decoded.overview); sources.push({ body: body.id, source: 'prepared' });
      continue;
    } catch (error) { signal.throwIfAborted(); reason = error instanceof Error ? error.message : String(error); }
    onprogress({ stage: `Preparing ${label}` }); await loadingPaint();
    const job = createPlanetBake(planetDefinitionForSamples(body.surface), { ...PLANET_SURFACE_MAP,
      equatorSamples: body.surface.sampleCount, orientationRadians: body.surface.orientationRadians });
    try {
      while (job.status === 'pending') {
        signal.throwIfAborted(); const start = performance.now();
        do { job.step(256); } while (job.status === 'pending' && performance.now() - start < 6);
        onprogress({ stage: `Preparing ${label}`, done: job.progress, total: 1 }); await loadingYield();
      }
      signal.throwIfAborted(); const profile = surfaceFromPlanetBake(body, job.takeResult()); profiles.set(body.id, profile);
      if (body.id !== 'planet' && body.id !== 'moon') { sources.push({ body: body.id, source: 'generated', reason }); continue; }
      onprogress({ stage: `Drawing ${label}` }); await loadingPaint();
      const work = overviewWork(profile, MATERIAL_DOMAINS[body.id]); let step = work.next();
      while (!step.done) {
        signal.throwIfAborted(); const start = performance.now();
        do { step = work.next(); } while (!step.done && performance.now() - start < 6);
        await loadingYield();
      }
      overviews.set(body.id, step.value); sources.push({ body: body.id, source: 'generated', reason });
    } finally { job.cancel(); }
  }
  signal.throwIfAborted(); return { profiles, overviews, sources };
}
