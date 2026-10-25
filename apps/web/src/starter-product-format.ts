// Copyright (c) 2026 pink-kitsune-420. All Rights Reserved.
// SPDX-License-Identifier: LicenseRef-Project

import type { PlanetBakeResult, RenderOverview } from '../../../packages/game-api/src/index';

/** Host/build transport only; not a module, save, or world-authoring format. */
export const STARTER_PRODUCT_FORMAT = 'space-lab.starter-product/1';
export const STARTER_PRODUCT_MAX_BYTES = 3 * 1024 * 1024;
export type StarterProducts = { physical: PlanetBakeResult; overview: RenderOverview };
type ArrayDescription = { array: 'Uint8Array' | 'Float32Array' | 'Float64Array'; offset: number; length: number };
export interface StarterProduct {
  readonly format: typeof STARTER_PRODUCT_FORMAT;
  readonly bodyId: 'planet' | 'moon';
  readonly surfaceIdentity: string;
  readonly sourceIdentity: string;
  readonly bytes: number;
  readonly compressedBytes: number;
  readonly digest: string;
  readonly rawDigest: string;
  readonly path: string;
  readonly tree: unknown;
}

/** Canonical little-endian arrays with eight-byte alignment; first-party build use only. */
export function encodeStarterProducts(value: StarterProducts): { tree: unknown; bytes: Uint8Array } {
  let size = 0;
  const pieces: { offset: number; array: Uint8Array | Float32Array | Float64Array }[] = [];
  function visit(v: unknown): unknown {
    if (v instanceof Uint8Array || v instanceof Float32Array || v instanceof Float64Array) {
      size = Math.ceil(size / 8) * 8;
      const offset = size; size += v.byteLength; pieces.push({ offset, array: v });
      return { array: v.constructor.name, offset, length: v.length };
    }
    if (Array.isArray(v)) return v.map(visit);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x)]));
    return v;
  }
  const tree = visit(value);
  if (size > STARTER_PRODUCT_MAX_BYTES) throw Error('Starter product exceeds storage budget');
  const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
  for (const { offset, array } of pieces) {
    if (array instanceof Uint8Array) bytes.set(array, offset);
    else for (let i = 0; i < array.length; i++) {
      if (array instanceof Float64Array) view.setFloat64(offset + i * 8, array[i]!, true);
      else view.setFloat32(offset + i * 4, array[i]!, true);
    }
  }
  return { tree, bytes };
}

/** Decode only after matching the pinned compressed/raw digests. Strict limits
 * precede allocation; returned arrays own their storage, never an active profile. */
export function decodeStarterProducts(product: StarterProduct, bytes: Uint8Array): StarterProducts {
  if (product.format !== STARTER_PRODUCT_FORMAT || !Number.isInteger(product.bytes) || product.bytes < 1
    || product.bytes > STARTER_PRODUCT_MAX_BYTES || bytes.length !== product.bytes) throw Error('Invalid starter product size/version');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let nodes = 0, copied = 0;
  const ranges: [number, number][] = [];
  function visit(v: unknown, depth = 0): unknown {
    if (++nodes > 1024 || depth > 24) throw Error('Starter product descriptor limit');
    if (v && typeof v === 'object' && 'array' in v) {
      const a = v as ArrayDescription, unit = a.array === 'Float64Array' ? 8 : a.array === 'Float32Array' ? 4 : a.array === 'Uint8Array' ? 1 : 0;
      if (!unit || Object.keys(a).some(k => !['array', 'offset', 'length'].includes(k))
        || !Number.isInteger(a.offset) || a.offset < 0 || a.offset % 8 !== 0 || !Number.isInteger(a.length) || a.length < 1
        || a.length > STARTER_PRODUCT_MAX_BYTES / unit || a.offset + a.length * unit > bytes.length
        || ranges.some(([lo, hi]) => a.offset < hi && a.offset + a.length * unit > lo)) throw Error('Invalid starter array layout');
      copied += a.length * unit; if (copied > STARTER_PRODUCT_MAX_BYTES) throw Error('Starter array budget exceeded');
      ranges.push([a.offset, a.offset + a.length * unit]);
      if (a.array === 'Uint8Array') return bytes.slice(a.offset, a.offset + a.length);
      const out = a.array === 'Float64Array' ? new Float64Array(a.length) : new Float32Array(a.length);
      for (let i = 0; i < a.length; i++) {
        const n = unit === 8 ? view.getFloat64(a.offset + i * unit, true) : view.getFloat32(a.offset + i * unit, true);
        if (!Number.isFinite(n)) throw Error('Non-finite starter sample'); out[i] = n;
      }
      return out;
    }
    if (Array.isArray(v)) return v.map(x => visit(x, depth + 1));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, visit(x, depth + 1)]));
    if (typeof v === 'number' && !Number.isFinite(v)) throw Error('Invalid starter number');
    return v;
  }
  return visit(product.tree) as StarterProducts;
}
