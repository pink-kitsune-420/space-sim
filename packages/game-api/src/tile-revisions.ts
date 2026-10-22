/** Caller-owned presentation epoch shared by a world's views. Create a fresh owner for
 * a new world/session. Disposal is idempotent and invalidates all of its revisions;
 * it never edits terrain, simulation or saves. Object identity survives SDK bundling. */
export interface TileChunkOwner {
  readonly version: 1;
  readonly disposed: boolean;
  dispose(): void;
}
/** Explicit opt-in immutable content identity. Arrays/clip points must stay unchanged
 * for (owner,id,revision); advance revision after completed draws before reusing data.
 * IDs/revisions are nonnegative safe integers. Revisions increase monotonically per ID;
 * never wrap, restart or resubmit an older revision within the same owner.
 * A revision covers the whole 32x32 chunk: IDs, walls, light/encoding, clip, tileMetres
 * and paletteId. Origin/rotation/camera are transforms, not content. Palette registration
 * has its own renderer invalidation. This is a producer promise, not mutation detection. */
export interface TileChunkRevision {
  readonly owner: TileChunkOwner;
  readonly id: number;
  readonly revision: number;
}
/** Optional revision protocol, not a caching/residency or performance guarantee.
 * Future retained payload is bounded per renderer; native/GPU peak memory is separate.
 * Different renderers/views own independent retention. Context/provider replacement
 * discards local state; live owners may be reused with newly registered palettes. */
export interface TileChunkRevisions {
  readonly version: 1;
  readonly maxEntries: number;
  readonly maxBytes: number;
  /** Drop this (owner,id)'s renderer-local versions; idempotent, including after disposal.
   * Never disposes the shared owner or another view. Released content may draw again. */
  release(content: TileChunkRevision): void;
}
/** Upper policy limits for revision-keyed retained presentation payload per renderer.
 * The protocol alone retains no content. Four existing game views permit at most 8 MiB. */
export const TILE_CHUNK_REVISION_LIMITS = Object.freeze({ maxEntries: 512, maxBytes: 2 * 1024 * 1024 });

/** Allocate once per world/session, not once per frame or chunk. Drop producer references
 * after all views finish; disposing one renderer must not dispose a shared owner. */
export function createTileChunkOwner(): TileChunkOwner {
  let disposed = false;
  return Object.freeze({ version: 1 as const, get disposed() { return disposed; }, dispose() { disposed = true; } });
}

/** Validate metadata without copying, retaining, hashing or claiming array immutability.
 * allowDisposed is only for renderer-local release/cleanup, never for drawing. Owners
 * are structurally checked so separately bundled SDK copies interoperate; no authority
 * or security token is granted by this presentation-only protocol. */
export function validateTileChunkRevision(raw: unknown, allowDisposed = false): asserts raw is TileChunkRevision {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('tile contentRevision must be an object');
  const d = raw as Record<string, unknown>;
  for (const key in d) if (key !== 'owner' && key !== 'id' && key !== 'revision') throw new Error('Unknown tile contentRevision field');
  const owner = d.owner as TileChunkOwner | undefined;
  if (!owner || typeof owner !== 'object' || !Object.isFrozen(owner) || owner.version !== 1
    || typeof owner.disposed !== 'boolean' || typeof owner.dispose !== 'function') throw new Error('Invalid tile content owner');
  if (owner.disposed && !allowDisposed) throw new Error('Tile content owner has been disposed');
  if (!Number.isSafeInteger(d.id) || (d.id as number) < 0 || !Number.isSafeInteger(d.revision) || (d.revision as number) < 0)
    throw new Error('Tile content IDs and revisions must be nonnegative safe integers');
}

/** Renderer-author helper. release is local to this renderer; legacy draws retain no
 * metadata/content. Actual caching, allocation and palette generations remain the
 * renderer's responsibility under these caps. Cleanup callbacks must be idempotent. */
export function createTileChunkRevisions(release?: (content: TileChunkRevision) => void): TileChunkRevisions {
  return Object.freeze({ version: 1 as const, ...TILE_CHUNK_REVISION_LIMITS,
    release(content: TileChunkRevision) { validateTileChunkRevision(content, true); release?.(content); } });
}
