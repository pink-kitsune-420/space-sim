import type { ServiceKey } from './modules-v2';
import type { ModuleValue } from './motion';

export type ModuleDataScope = 'world' | 'player' | 'entity';
export interface ModuleDataSchema {
  /** Stable module namespace plus local name, e.g. example.inventory/items. */
  readonly id: string;
  readonly version: number;
  readonly scope: ModuleDataScope;
}
export interface ModuleDataTarget { readonly adapter: string; readonly id: string }
export interface ModuleDataCommand extends ModuleDataTarget { readonly command: string; readonly args: ModuleValue }
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
export interface ModuleDataExtension extends ModuleDataSchema { readonly adapter: ModuleDataAdapter }
export interface ModuleDataRecord extends ModuleDataTarget { readonly value: ModuleValue }
export interface ModuleDataSnapshot {
  readonly format: 'space-sim-module-data/1';
  readonly revision: number;
  readonly schemas: readonly ModuleDataSchema[];
  readonly records: readonly ModuleDataRecord[];
}
export interface ModuleDataDelta extends ModuleDataSnapshot {
  /** Absent means complete replacement; present means apply only these changed records. */
  readonly since?: number;
}
export interface ModuleDataRead {
  readonly schemas: readonly ModuleDataSchema[];
  readonly revision: number;
  get(adapter: string, id: string): ModuleValue | undefined;
  snapshot(): ModuleDataSnapshot;
  delta(since: number): ModuleDataDelta;
}
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
export const CORE_MODULE_DATA: ServiceKey<ModuleDataFactory> = Object.freeze({slot:'core.module-data',version:'1.0.0'});
