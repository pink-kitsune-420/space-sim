import type { ModuleDataAdapter, ModuleDataActor, ModuleDataCommand, ModuleDataControl, ModuleDataDelta,
  ModuleDataExtension, ModuleDataRecord, ModuleDataSchema, ModuleDataSnapshot, ModuleDataTarget, ModuleValue } from '../../game-api/src/index';
import { validateModuleState } from './motion';

const FORMAT = 'space-sim-module-data/1';
const TARGET = /^[A-Za-z0-9_.:-]{1,64}$/;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const LIMIT_RECORDS = 4096, LIMIT_BYTES = 4 * 1024 * 1024;
const value = (raw: ModuleValue): ModuleValue => validateModuleState({ version: 1, value: raw }).value;
const integer = (raw: unknown): number => {
  if (!Number.isSafeInteger(raw) || (raw as number) < 0) throw new Error('Invalid module-data revision/version');
  return raw as number;
};
export function captureDataAdapter(moduleId: string, raw: ModuleDataAdapter): ModuleDataExtension {
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(moduleId) || !raw || typeof raw.name !== 'string' || !NAME.test(raw.name) || !['world', 'player', 'entity'].includes(raw.scope) || integer(raw.version) < 1
    || typeof raw.validate !== 'function' || typeof raw.authorize !== 'function' || typeof raw.reduce !== 'function') throw new Error('Invalid module-data adapter');
  const migrations: Record<number, (value: ModuleValue) => ModuleValue> = Object.create(null);
  for (const [key, fn] of Object.entries(raw.migrations ?? {})) {
    const from = Number(key);
    if (String(from) !== key || integer(from) < 1 || from >= raw.version || typeof fn !== 'function') throw new Error('Invalid module-data migration');
    migrations[from] = fn.bind(raw);
  }
  const adapter: ModuleDataAdapter = Object.freeze({ name: raw.name, scope: raw.scope, version: raw.version,
    initial: value(raw.initial), validate: raw.validate.bind(raw), authorize: raw.authorize.bind(raw), reduce: raw.reduce.bind(raw), migrations: Object.freeze(migrations) });
  if (adapter.validate(adapter.initial) !== true) throw new Error(`Module ${moduleId}: invalid initial data`);
  return Object.freeze({ id: `${moduleId}/${raw.name}`, version: raw.version, scope: raw.scope, adapter });
}
/** One store per world. Nothing runs on physics ticks; work occurs only on writes or IO.
 * Every operation stages all validation before publishing state. */
export class ModuleDataStore implements ModuleDataControl {
  readonly schemas: readonly ModuleDataSchema[];
  readonly extensions: readonly ModuleDataExtension[];
  private readonly adapters: ReadonlyMap<string, ModuleDataExtension>;
  private records = new Map<string, { record: ModuleDataRecord; revision: number; bytes: number }>();
  private bytes = 0;
  private serial = 0;
  private fullAfter = 0;
  get revision(): number { return this.serial; }
  constructor(extensions: readonly ModuleDataExtension[] = []) {
    if (extensions.length > 128) throw new Error('At most 128 module-data adapters');
    this.extensions = Object.freeze(extensions.map(e => {
      const slash = e.id.lastIndexOf('/');
      const captured = captureDataAdapter(e.id.slice(0, slash), e.adapter);
      if (slash < 1 || captured.id !== e.id || captured.version !== e.version || captured.scope !== e.scope) throw new Error('Invalid module-data extension');
      return captured;
    }));
    this.adapters = new Map(this.extensions.map(e => [e.id, e]));
    if (this.adapters.size !== extensions.length) throw new Error('Duplicate module-data adapter');
    this.schemas = Object.freeze(this.extensions.map(({ id, version, scope }) => Object.freeze({ id, version, scope })));
  }
  private target(target: ModuleDataTarget): ModuleDataExtension {
    const extension = this.adapters.get(target.adapter);
    if (!extension) throw new Error(`Missing required module-data adapter ${target.adapter}`);
    if (typeof target.id !== 'string' || !TARGET.test(target.id) || (extension.scope === 'world' && target.id !== 'world')) throw new Error('Invalid module-data target');
    return extension;
  }
  private key(target: ModuleDataTarget): string { return `${target.adapter}:${target.id}`; }
  get(adapter: string, id: string): ModuleValue | undefined { return this.records.get(this.key({ adapter, id }))?.record.value; }
  private checked(target: ModuleDataTarget, raw: ModuleValue): ModuleDataRecord {
    const extension = this.target(target), checked = value(raw);
    if (extension.adapter.validate(checked) !== true) throw new Error(`Invalid data for ${target.adapter}`);
    return Object.freeze({ adapter: target.adapter, id: target.id, value: checked });
  }
  private next(): number { if (this.serial >= Number.MAX_SAFE_INTEGER) throw new Error('Module-data revision exhausted'); return this.serial + 1; }
  set(target: ModuleDataTarget, raw: ModuleValue): void {
    const record = this.checked(target, raw), key = this.key(record), prior = this.records.get(key);
    const bytes = new TextEncoder().encode(JSON.stringify(record)).length;
    const total = this.bytes - (prior?.bytes ?? 0) + bytes;
    if ((!prior && this.records.size >= LIMIT_RECORDS) || total > LIMIT_BYTES) throw new Error('Module-data store exceeds record/byte limits');
    const revision = this.next(); this.records.set(key, { record, revision, bytes }); this.bytes = total; this.serial = revision;
  }
  remove(target: ModuleDataTarget): void {
    this.target(target); const key = this.key(target), entry = this.records.get(key); if (!entry) return;
    const revision = this.next(); this.records.delete(key); this.bytes -= entry.bytes; this.serial = revision; this.fullAfter = revision;
  }
  command(request: ModuleDataCommand, actor: ModuleDataActor): void {
    const target = Object.freeze({ adapter: request.adapter, id: request.id }), extension = this.target(target);
    if (typeof actor.playerId !== 'string' || !TARGET.test(actor.playerId) || !Number.isSafeInteger(actor.tick) || actor.tick < 0 || typeof request.command !== 'string' || !NAME.test(request.command)) throw new Error('Invalid module-data command');
    const args = value(request.args), state = this.get(target.adapter, target.id) ?? extension.adapter.initial;
    const input = Object.freeze({ ...actor, target, command: request.command, args, state });
    if (extension.adapter.authorize(input) !== true) throw new Error(`Module-data command denied by ${target.adapter}`);
    this.set(target, extension.adapter.reduce(Object.freeze({ target, command: request.command, args, state, tick: actor.tick })));
  }
  snapshot(): ModuleDataSnapshot { return Object.freeze({ format: FORMAT, revision: this.serial, schemas: this.schemas,
    records: Object.freeze([...this.records.values()].map(e => e.record)) }); }
  delta(since: number): ModuleDataDelta {
    integer(since);
    if (since < this.fullAfter || since > this.serial) return this.snapshot();
    return Object.freeze({ format: FORMAT, revision: this.serial, schemas: this.schemas, since,
      records: Object.freeze([...this.records.values()].filter(e => e.revision > since).map(e => e.record)) });
  }
  apply(raw: unknown): void { this.accept(raw, false); }
  restore(raw: unknown): void { this.accept(raw, true); }
  private accept(raw: unknown, migrate: boolean): void {
    if (!raw || typeof raw !== 'object') throw new Error('Invalid module-data snapshot');
    const snapshot = raw as ModuleDataDelta;
    if (snapshot.format !== FORMAT || !Array.isArray(snapshot.schemas) || snapshot.schemas.length > 128
      || !Array.isArray(snapshot.records) || snapshot.records.length > LIMIT_RECORDS) throw new Error('Invalid module-data snapshot');
    const revision = integer(snapshot.revision);
    if (!migrate && revision < this.serial) throw new Error('Module-data snapshot is stale');
    const versions = new Map<string, number>();
    for (const schema of snapshot.schemas) {
      const extension = this.adapters.get(schema?.id);
      if (!extension) throw new Error(`Missing required module-data adapter ${schema?.id}`);
      if (versions.has(schema.id) || extension.scope !== schema.scope || integer(schema.version) < 1
        || (migrate ? schema.version > extension.version : schema.version !== extension.version)) throw new Error(`Incompatible module-data schema ${schema.id}`);
      versions.set(schema.id, schema.version);
    }
    // Missing local adapters are incompatible too: their defaults affect authority.
    if (versions.size !== this.adapters.size) throw new Error('Missing required module-data schemas');
    if (migrate && snapshot.since !== undefined) throw new Error('Saves require full module-data snapshots');
    if (snapshot.since !== undefined && (integer(snapshot.since) !== this.serial || revision < snapshot.since)) throw new Error('Module-data delta is out of order');
    if (snapshot.since !== undefined && snapshot.records.length && revision === snapshot.since) throw new Error('Module-data delta must advance revision');
    const staged = snapshot.since === undefined ? new Map<string, { record: ModuleDataRecord; revision: number; bytes: number }>() : new Map(this.records);
    let bytes = snapshot.since === undefined ? 0 : this.bytes;
    const seen = new Set<string>();
    for (const record of snapshot.records) {
      if (!record || typeof record !== 'object') throw new Error('Invalid module-data record');
      const extension = this.target(record), key = this.key(record);
      if (seen.has(key)) throw new Error('Duplicate module-data record'); seen.add(key);
      let next = value(record.value), version = versions.get(record.adapter)!;
      while (version < extension.version) {
        const migration = extension.adapter.migrations?.[version];
        if (!migration) throw new Error(`Missing module-data migration ${record.adapter}@${version}`);
        next = value(migration(next)); version++;
      }
      const checked = this.checked(record, next), size = new TextEncoder().encode(JSON.stringify(checked)).length;
      bytes += size - (staged.get(key)?.bytes ?? 0);
      if (bytes > LIMIT_BYTES || (!staged.has(key) && staged.size >= LIMIT_RECORDS)) throw new Error('Module-data store exceeds record/byte limits');
      staged.set(key, { record: checked, revision, bytes: size });
    }
    this.records = staged; this.bytes = bytes; this.serial = revision; this.fullAfter = revision;
  }
  clear(): void { if (!this.records.size) return; const revision = this.next(); this.records.clear(); this.bytes = 0; this.serial = revision; this.fullAfter = revision; }
}
