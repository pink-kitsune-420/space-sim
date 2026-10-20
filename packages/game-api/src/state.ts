import type { SolverDiagnostics } from './orbit';
import type { SurfaceDefinition, SurfaceSweepDiagnostics } from './surface';
import type { ModuleState } from './motion';

/** Immutable 2D Cartesian vector (SI metres, `m/s`, or `m/s²` in world/body frames with `+Y` up, or CSS pixels in screen space with `+Y` down). */
export interface Vec { readonly x: number; readonly y: number }
/** Sidereal spin of a body: its terrain, oceans and anything resting on them turn with it. */
export interface BodyRotation {
  /** Seconds per turn. */
  readonly period: number;
  /** -1 turns clockwise, the same sense as default orbits; 1 counter-clockwise. */
  readonly direction: 1 | -1;
  /** Angle of the body-fixed frame at time 0, radians. */
  readonly phase: number;
}
/** Minimal authoritative celestial body parameters for motion and surface contact: reference `radius` in `m` and gravitational parameter `mu` (`GM`) in `m³/s²`. */
export interface Body {
  readonly id: string;
  readonly radius: number;
  readonly mu: number;
  readonly surface?: SurfaceDefinition;
  readonly rotation?: BodyRotation;
}
/** A flying state is in the body-centred inertial frame. On a rotating body a landed or crashed
 * state is in the body-fixed frame instead: it rests with constant position and heading. */
export interface State {
  readonly moduleState?: Readonly<Record<string, ModuleState>>;
  readonly time: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly heading: number;
  readonly throttle: number;
  readonly status: 'landed' | 'flying' | 'crashed';
  readonly revision: number;
  readonly godMode?: boolean;
  readonly coast?: Coast;
  readonly dynamics?: 'kepler' | 'numerical';
  readonly solver?: SolverDiagnostics;
  /** Terrain event epoch lies within this completed scheduler step. */
  readonly contact?: SurfaceContactEvent;
  readonly water?: 'submerged' | 'floating';
  /** Split drift vertex retained for prediction of a gentle sea entry. */
  readonly waterEntry?: GhostSample;
}
/** Terrain or sea contact event recorded during a step, with simulation `time` in `s`, step `fraction` in `[0, 1]`, and body-relative `impactVelocity` in `m/s`. */
export interface SurfaceContactEvent {
  readonly material?: 'rock' | 'water';
  readonly time: number;
  readonly fraction: number;
  readonly surfaceIdentity: string;
  readonly impactVelocity: Vec;
  readonly diagnostics: SurfaceSweepDiagnostics;
}
/** Exact Keplerian coasting epoch (`epochSeconds` in `s`, body-centered inertial `position` in `m` and `velocity` in `m/s`, `mu` in `m³/s²`) from which unpowered motion is evaluated without drift. */
export interface Coast {
  readonly modelIdentity?: string;
  readonly bodyId: string;
  readonly epochSeconds: number;
  readonly position: Vec;
  readonly velocity: Vec;
  readonly mu: number;
  readonly revision: number;
  readonly surfaceRadius: number;
  readonly surfaceIdentity: string;
  /** Absent for the circular preview contact model, even on configured bodies. */
  readonly contactSurfaceIdentity?: string;
}

/** Held pilot flight control inputs: `turn` rate in `[-1, 1]` (positive turns counter-clockwise), `throttle` rate in `[-1, 1]`, and `engine` ignition boolean. */
export interface Controls { readonly turn: number; readonly throttle: number; readonly engine: boolean }
/** Built-in starting spawn preset identifier (`'pad'`, `'planet-orbit'`, or `'moon-orbit'`). */
export type Preset = 'pad' | 'planet-orbit' | 'moon-orbit';

/** Timed 2D position sample with simulation `time` in seconds and `position` in metres. */
export interface Sample { readonly time: number; readonly position: Vec }

/** Trajectory forecast sample with simulation `time` (`s`), `position` (`m`), and `velocity` (`m/s`) in the translating non-rotating frame of `frameId ?? bodyId`. */
export interface GhostSample extends Sample {
  readonly velocity: Vec;
  /** Segment ending here is a verified numerical drift, not a conic/Hermite arc. */
  readonly linear?: boolean;
  readonly contactMaterial?: 'water';
  /** Active gravitational body. Multi-body forecasts express position/velocity in
   * frameId's translating, nonrotating frame at this sample's time. */
  readonly bodyId?: string;
  readonly frameId?: string;
  /** First sample in a new SOI; continuous position, velocity and time. */
  readonly encounter?: { readonly from: string; readonly to: string };
  /** Destination body at this SOI handoff time, in the same translating frame as
   * position. Optional display snapshot, never current world coordinates. The
   * reference radius is not a terrain/contact boundary. */
  readonly encounterBody?: { readonly position: Vec; readonly radius: number; readonly name: string };
}
/** Why an orbital ghost projection pass ended. */
export type GhostEnd = 'closed' | 'impact' | 'escape' | 'open' | 'grounded' | 'floating' | 'failed' | 'horizon';

/** Delta entry representing a modified sparse binary page in a `SparsePageStore`. */
export interface SparsePageDelta {
  readonly key: string;
  readonly delta: Uint8Array;
}

/** Versioned copy-on-write sparse binary page store for high-capacity state (e.g. voxel chunks, tile grids). */
export interface SparsePageStore {
  readonly pageSizeBytes: 1024 | 2048 | 4096;
  getPage(key: string): Uint8Array | undefined;
  setPage(key: string, data: Uint8Array): void;
  markDirty(key: string): void;
  commitDirtyPages(): readonly SparsePageDelta[];
}

/** Maximum aggregate size in bytes (32 MiB) allowable in a single `SparsePageStore`. */
export const MAX_SPARSE_PAGE_STORE_BYTES = 32 * 1024 * 1024;

/** Copy-on-write implementation of `SparsePageStore` with per-tick transaction and rollback support. */
export class CopyOnWriteSparsePageStore implements SparsePageStore {
  readonly pageSizeBytes: 1024 | 2048 | 4096;
  private readonly committedPages: Map<string, Uint8Array>;
  private readonly uncommittedPages: Map<string, Uint8Array>;
  private readonly dirtyKeySet: Set<string>;

  constructor(
    pageSizeBytes: 1024 | 2048 | 4096 = 2048,
    committedPages: Map<string, Uint8Array> = new Map(),
    uncommittedPages: Map<string, Uint8Array> = new Map(),
    dirtyKeySet: Set<string> = new Set()
  ) {
    if (pageSizeBytes !== 1024 && pageSizeBytes !== 2048 && pageSizeBytes !== 4096) {
      throw new Error(`Invalid pageSizeBytes: ${pageSizeBytes}. Must be 1024, 2048, or 4096.`);
    }
    this.pageSizeBytes = pageSizeBytes;
    this.committedPages = committedPages;
    this.uncommittedPages = uncommittedPages;
    this.dirtyKeySet = dirtyKeySet;
  }

  get pageCount(): number {
    let count = this.committedPages.size;
    for (const key of this.uncommittedPages.keys()) {
      if (!this.committedPages.has(key)) count++;
    }
    return count;
  }

  getPage(key: string): Uint8Array | undefined {
    return this.uncommittedPages.get(key) ?? this.committedPages.get(key);
  }

  setPage(key: string, data: Uint8Array): void {
    if (!key || typeof key !== 'string') throw new Error('SparsePageStore page key must be a non-empty string');
    if (!(data instanceof Uint8Array) || data.byteLength !== this.pageSizeBytes) {
      throw new Error(`SparsePageStore page data must be a Uint8Array of length ${this.pageSizeBytes}`);
    }
    const isNew = !this.committedPages.has(key) && !this.uncommittedPages.has(key);
    if (isNew && (this.pageCount + 1) * this.pageSizeBytes > MAX_SPARSE_PAGE_STORE_BYTES) {
      throw new Error(`SparsePageStore exceeds maximum capacity of ${MAX_SPARSE_PAGE_STORE_BYTES} bytes (32 MiB)`);
    }
    const copy = new Uint8Array(this.pageSizeBytes);
    copy.set(data);
    this.uncommittedPages.set(key, copy);
    this.dirtyKeySet.add(key);
  }

  markDirty(key: string): void {
    if (!key || typeof key !== 'string') throw new Error('SparsePageStore page key must be a non-empty string');
    if (this.uncommittedPages.has(key)) return;
    const existing = this.committedPages.get(key);
    if (existing) {
      const copy = new Uint8Array(this.pageSizeBytes);
      copy.set(existing);
      this.uncommittedPages.set(key, copy);
      this.dirtyKeySet.add(key);
    } else {
      if ((this.pageCount + 1) * this.pageSizeBytes > MAX_SPARSE_PAGE_STORE_BYTES) {
        throw new Error(`SparsePageStore exceeds maximum capacity of ${MAX_SPARSE_PAGE_STORE_BYTES} bytes (32 MiB)`);
      }
      const blank = new Uint8Array(this.pageSizeBytes);
      this.uncommittedPages.set(key, blank);
      this.dirtyKeySet.add(key);
    }
  }

  commitDirtyPages(): readonly SparsePageDelta[] {
    if (this.dirtyKeySet.size === 0) return [];
    const sortedKeys = Array.from(this.dirtyKeySet).sort();
    const deltas: SparsePageDelta[] = [];
    for (const key of sortedKeys) {
      const page = this.uncommittedPages.get(key)!;
      this.committedPages.set(key, page);
      deltas.push(Object.freeze({ key, delta: page }));
    }
    this.uncommittedPages.clear();
    this.dirtyKeySet.clear();
    return Object.freeze(deltas);
  }

  discardDirtyPages(): void {
    this.uncommittedPages.clear();
    this.dirtyKeySet.clear();
  }

  clone(): CopyOnWriteSparsePageStore {
    const newCommitted = new Map(this.committedPages);
    const newUncommitted = new Map<string, Uint8Array>();
    for (const [k, v] of this.uncommittedPages) {
      const copy = new Uint8Array(this.pageSizeBytes);
      copy.set(v);
      newUncommitted.set(k, copy);
    }
    return new CopyOnWriteSparsePageStore(
      this.pageSizeBytes,
      newCommitted,
      newUncommitted,
      new Set(this.dirtyKeySet)
    );
  }

  keys(): IterableIterator<string> {
    const keys = new Set([...this.committedPages.keys(), ...this.uncommittedPages.keys()]);
    return keys.values();
  }
}

/** Creates a new `SparsePageStore` initialized with optional pages. */
export function createSparsePageStore(
  pageSizeBytes: 1024 | 2048 | 4096 = 2048,
  initialPages?: Iterable<[string, Uint8Array]> | Record<string, Uint8Array>
): CopyOnWriteSparsePageStore {
  const store = new CopyOnWriteSparsePageStore(pageSizeBytes);
  if (initialPages) {
    const entries = Symbol.iterator in Object(initialPages)
      ? (initialPages as Iterable<[string, Uint8Array]>)
      : Object.entries(initialPages);
    for (const [k, v] of entries) {
      store.setPage(k, v);
    }
    store.commitDirtyPages();
  }
  return store;
}

