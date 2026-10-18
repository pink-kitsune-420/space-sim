import type { ModuleDependency, ModuleManifest, ModuleProfile, ModuleReference, NumberSetting } from '../../game-api/src/index';
import { validRange } from './semver';

export function object(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label}: expected an object`);
  return raw as Record<string, unknown>;
}
export function keys(raw: Record<string, unknown>, allowed: readonly string[], label: string): void {
  for (const key of Object.keys(raw)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
}
export function string(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !raw.trim() || raw.length > 256) throw new Error(`${label}: expected a nonempty string (at most 256 characters)`);
  return raw;
}
export function moduleId(raw: unknown, label: string): string {
  const id = string(raw, label);
  if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(id)) throw new Error(`${label}: expected a namespaced module ID`);
  return id;
}
export function version(raw: unknown, label: string): string {
  const value = string(raw, label);
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value)) throw new Error(`${label}: expected an exact semantic version`);
  return value;
}
function list(raw: unknown, label: string): unknown[] {
  if (!Array.isArray(raw) || raw.length > 256) throw new Error(`${label}: expected a list of at most 256 entries`);
  return raw;
}
export function strings(raw: unknown, label: string): string[] {
  const values = list(raw, label).map(v => string(v, label));
  if (new Set(values).size !== values.length) throw new Error(`${label}: duplicate entry`);
  return values;
}
function references(raw: unknown, label: string): ModuleReference[] {
  const values = list(raw, label).map(value => {
    const ref = object(value, label);
    keys(ref, ['id', 'version'], label);
    return { id: moduleId(ref.id, label), version: version(ref.version, label) };
  });
  if (new Set(values.map(v => v.id)).size !== values.length) throw new Error(`${label}: duplicate module ID`);
  return values;
}
/** Dependencies and conflicts name a version range; profiles and locks stay exact. */
export function ranges(raw: unknown, label: string): ModuleDependency[] {
  const values = list(raw, label).map(value => {
    const ref = object(value, label);
    keys(ref, ['id', 'version'], label);
    const range = string(ref.version, label);
    if (!validRange(range)) throw new Error(`${label}: invalid version range ${range} (use 1.2.3, ^1.2.3, ~1.2.3, >=1.2.3 <2.0.0, * or alternatives with ||)`);
    return { id: moduleId(ref.id, label), version: range.trim().replace(/\s+/g, ' ') };
  });
  if (new Set(values.map(v => v.id)).size !== values.length) throw new Error(`${label}: duplicate module ID`);
  return values;
}
export function validateManifest(raw: unknown): ModuleManifest {
  const m = object(raw, 'Manifest'), id = moduleId(m.id, 'Manifest id'), label = `Module ${id}`;
  keys(m, ['format', 'apiVersion', 'id', 'name', 'version', 'kind', 'authority', 'environments', 'dependencies',
    'conflicts', 'provides', 'requires', 'slots', 'before', 'after', 'settings', 'license'], label);
  if (m.format !== 'space-sim-module/1' || m.apiVersion !== 'space-sim-game-api/1') throw new Error(`${label}: unsupported manifest/API version`);
  if (m.kind !== 'provider' && m.kind !== 'data') throw new Error(`${label}: unsupported kind`);
  if (m.authority !== 'authoritative' && m.authority !== 'presentation') throw new Error(`${label}: invalid authority`);
  const environments = strings(m.environments, `${label} environments`);
  if (!environments.length || environments.some(e => !['browser', 'offline', 'node'].includes(e))) throw new Error(`${label}: invalid environments`);
  const settings: Record<string, NumberSetting> = Object.create(null);
  for (const [key, value] of Object.entries(object(m.settings, `${label} settings`))) {
    const s = object(value, `${label} setting ${key}`);
    keys(s, ['type', 'default', 'minimum', 'maximum'], `${label} setting ${key}`);
    if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key) || s.type !== 'number'
      || ![s.default, s.minimum, s.maximum].every(n => typeof n === 'number' && Number.isFinite(n))
      || (s.minimum as number) > (s.default as number) || (s.default as number) > (s.maximum as number)) throw new Error(`${label} setting ${key}: invalid number schema`);
    settings[key] = s as unknown as NumberSetting;
  }
  const slots = strings(m.slots, `${label} slots`);
  if (slots.some(s => !/^[a-z][a-z0-9-]*$/.test(s)) || (m.kind === 'data' && slots.length)) throw new Error(`${label}: invalid provider slots`);
  return freezeJson({ ...m, id, name: string(m.name, `${label} name`), version: version(m.version, label),
    license: string(m.license, `${label} license`), settings, slots,
    environments, dependencies: ranges(m.dependencies, `${label} dependencies`),
    ...(m.conflicts !== undefined ? { conflicts: ranges(m.conflicts, `${label} conflicts`) } : {}),
    provides: strings(m.provides, `${label} provides`), requires: strings(m.requires, `${label} requires`),
    before: strings(m.before, `${label} before`).map(v => moduleId(v, label)),
    after: strings(m.after, `${label} after`).map(v => moduleId(v, label)),
  }) as unknown as ModuleManifest;
}
export function validateProfile(raw: unknown): ModuleProfile {
  const p = object(raw, 'Profile');
  keys(p, ['format', 'id', 'modules', 'providers', 'settings'], 'Profile');
  if (p.format !== 'space-sim-profile/1') throw new Error('Profile: unsupported format');
  const providers: Record<string, string> = Object.create(null);
  for (const [slot, value] of Object.entries(object(p.providers, 'Profile providers'))) providers[slot] = moduleId(value, `Profile provider ${slot}`);
  const settings: Record<string, Record<string, number>> = Object.create(null);
  for (const [id, value] of Object.entries(object(p.settings, 'Profile settings'))) {
    moduleId(id, 'Profile settings');
    const values: Record<string, number> = Object.create(null);
    for (const [key, n] of Object.entries(object(value, `Module ${id} settings`))) {
      if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(`Module ${id} setting ${key}: expected a finite number`);
      values[key] = n;
    }
    settings[id] = values;
  }
  return freezeJson({ format: p.format, id: moduleId(p.id, 'Profile id'), modules: references(p.modules, 'Profile modules'), providers, settings }) as ModuleProfile;
}
/** Detach caller-owned JSON before freezing, including nested arrays. */
export function freezeJson<T>(value: T): T {
  const clone = JSON.parse(JSON.stringify(value)) as T;
  function freeze(v: unknown): void {
    if (!v || typeof v !== 'object') return;
    for (const child of Object.values(v)) freeze(child);
    Object.freeze(v);
  }
  freeze(clone);
  return clone;
}
