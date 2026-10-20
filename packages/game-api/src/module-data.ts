import type { ServiceKey } from './modules-v2';
import type { ModuleValue } from './motion';

/** Storage granularity for an authoritative module data schema: singleton `'world'`, per-`'player'`, or per-`'entity'`. */
export type ModuleDataScope = 'world' | 'player' | 'entity';
/** Namespaced identifier, integer schema version, and scope of a replicated module data store. */
export interface ModuleDataSchema {
  /** Stable module namespace plus local name, e.g. example.inventory/items. */
  readonly id: string;
  readonly version: number;
  readonly scope: ModuleDataScope;
}
/** Address of a single module data record combining the namespaced `adapter` ID and record key `id`. */
export interface ModuleDataTarget { readonly adapter: string; readonly id: string }
/** Authoritative mutation request targeting a module data record with a named `command` and JSON-compatible `args`. */
export interface ModuleDataCommand extends ModuleDataTarget { readonly command: string; readonly args: ModuleValue }
/** Authenticated caller context (`playerId`, optional target `ownerId`, and committed simulation `tick`) passed to `ModuleDataAdapter.authorize`. */
export interface ModuleDataActor { readonly playerId: string; readonly ownerId?: string; readonly tick: number }
/** Deterministic, synchronous, bounded callbacks. Values are detached and frozen. No IO,
 * clocks or hidden mutable state. A reducer returns its entire next record atomically.
 * All records are replicated to every peer: never put secrets/tokens in this store. */
export interface ModuleDataAdapter {
  readonly name: string;
  readonly version: number;
  readonly scope: ModuleDataScope;
  readonly initial: ModuleValue;
  validate(value: ModuleValue): boolean;
  /** One migration per schema version, from N to N+1. Used only when loading saves. */
  readonly migrations?: Readonly<Record<number, (value: ModuleValue) => ModuleValue>>;
  authorize(input: Readonly<ModuleDataActor & { target: ModuleDataTarget; command: string; args: ModuleValue; state: ModuleValue }>): boolean;
  reduce(input: Readonly<{ target: ModuleDataTarget; command: string; args: ModuleValue; state: ModuleValue; tick: number }>): ModuleValue;
}
/** Resolved module data adapter contribution pairing a `ModuleDataSchema` with its deterministic `ModuleDataAdapter`. */
export interface ModuleDataExtension extends ModuleDataSchema { readonly adapter: ModuleDataAdapter }
/** Detached, frozen record entry (`adapter`, `id`, and validated `value`) inside a module data snapshot or delta. */
export interface ModuleDataRecord extends ModuleDataTarget { readonly value: ModuleValue }
/** Portable `space-sim-module-data/1` snapshot of all registered schemas and non-default records at a monotonic `revision`. */
export interface ModuleDataSnapshot {
  readonly format: 'space-sim-module-data/1';
  readonly revision: number;
  readonly schemas: readonly ModuleDataSchema[];
  readonly records: readonly ModuleDataRecord[];
}
/** Incremental or full `space-sim-module-data/1` replication payload; `since` names the base revision when sending deltas. */
export interface ModuleDataDelta extends ModuleDataSnapshot {
  /** Absent means complete replacement; present means apply only these changed records. */
  readonly since?: number;
}
/** Read-only view of authoritative module data records, schemas, snapshots, and revision deltas. */
export interface ModuleDataRead {
  readonly schemas: readonly ModuleDataSchema[];
  readonly revision: number;
  get(adapter: string, id: string): ModuleValue | undefined;
  snapshot(): ModuleDataSnapshot;
  delta(since: number): ModuleDataDelta;
}
/** Mutable authoritative module data store supporting direct host writes, authorized commands, network snapshot application, and migrated save restores. */
export interface ModuleDataControl extends ModuleDataRead {
  /** Trusted host initialization/update; remote callers use commands, never arbitrary writes. */
  set(target: ModuleDataTarget, value: ModuleValue): void;
  remove(target: ModuleDataTarget): void;
  command(request: ModuleDataCommand, actor: ModuleDataActor): void;
  /** Validate every record before committing. Network replication requires exact versions. */
  apply(snapshot: unknown): void;
  /** Save loads may use registered one-version migrations. Missing adapters are errors. */
  restore(snapshot: unknown): void;
  clear(): void;
}

/** Headless storage for a session adapter's own world. The session supplies authenticated
 * actor/ownership context; this factory grants no access to another live world. */
export interface ModuleDataFactory { create(adapters: readonly ModuleDataExtension[]): ModuleDataControl }
/** Service key for the authoritative module data store factory (`core.module-data@1.0.0`). */
export const CORE_MODULE_DATA: ServiceKey<ModuleDataFactory> = Object.freeze({slot:'core.module-data',version:'1.0.0'});
