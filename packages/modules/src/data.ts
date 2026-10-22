import type { DataModule, UniverseDefinition, VehicleDefaults } from '../../game-api/src/index';
import { validateManifest } from '../../game-runtime/src/index';
import { freezeJson, keys, object, string } from '../../game-runtime/src/validation';
import { validateUniverse } from '../../sim-core/src/universe';

export const MAX_MODULE_BYTES = 4 * 1024 * 1024;
export type { DataModule } from '../../game-api/src/index';
const VEHICLE = { acceleration: [0, 10000], turnRate: [0, 100], initialThrottle: [0, 1], contactRadiusMetres: [0, 32] } as const;
const COLORS = ['color', 'accentColor', 'atmosphereColor', 'horizonColor', 'skyColor'];
function validateVehicle(raw: unknown, label: string): void {
  for (const [key, value] of Object.entries(object(raw, `${label} vehicle settings`))) {
    const bounds = Object.hasOwn(VEHICLE, key) ? VEHICLE[key as keyof VehicleDefaults] : undefined;
    if (!bounds) throw new Error(`${label} setting ${key}: unknown vehicle setting`);
    if (typeof value !== 'number' || !Number.isFinite(value) || value < bounds[0] || value > bounds[1]) throw new Error(`${label} setting ${key}: must be finite and in [${bounds[0]}, ${bounds[1]}]`);
  }
}
function validatePreset(raw: unknown, label: string): void {
  const p = object(raw, `${label} preset`);
  const where = `${label} preset ${String(p.id)}`;
  keys(p, ['id', 'name', 'bodyId', 'kind', 'radius', 'radiusMetres', 'altitude', 'phaseRadians',
    'direction', 'headingRadians', 'zoom', 'position', 'velocity'], where);
  for (const key of ['id', 'name', 'bodyId']) string(p[key], `${where} ${key}`);
  if (!['landed', 'circular-orbit', 'state'].includes(p.kind as string)) throw new Error(`${where}: invalid kind`);
  for (const key of ['radius', 'radiusMetres', 'altitude', 'phaseRadians', 'headingRadians', 'zoom']) {
    const value = p[key];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value)
      || (['radius', 'radiusMetres', 'zoom'].includes(key) && value <= 0))) throw new Error(`${where} ${key}: invalid finite value`);
  }
  if (p.direction !== undefined && p.direction !== -1 && p.direction !== 1) throw new Error(`${where} direction: expected -1 or 1`);
  for (const key of ['position', 'velocity']) {
    const v = p[key];
    if ((p.kind === 'state' || v !== undefined) && (!Array.isArray(v) || v.length !== 2 || !v.every(n => typeof n === 'number' && Number.isFinite(n)))) throw new Error(`${where} ${key}: expected two finite coordinates`);
  }
}
export function validateDataModule(raw: unknown): DataModule {
  const root = object(raw, 'Data module');
  keys(root, ['format', 'manifest', 'data'], 'Data module');
  if (root.format !== 'space-sim-data-module/1') throw new Error('Data module: unsupported format');
  const manifest = validateManifest(root.manifest), label = `Module ${manifest.id}`;
  if (manifest.kind !== 'data' || manifest.slots.length || manifest.provides.length || manifest.requires.length || Object.keys(manifest.settings).length) throw new Error(`${label}: data modules cannot declare executable services or settings schemas`);
  if (manifest.id.startsWith('builtin.')) throw new Error(`${label}: builtin namespace is reserved`);
  const data = object(root.data, label);
  keys(data, ['vehicle', 'universes', 'presets', 'appearance'], label);
  if (manifest.authority === 'presentation' && (data.vehicle || data.universes || data.presets)) throw new Error(`${label}: vehicle, universes and presets require authoritative scope`);
  if (data.vehicle !== undefined) {
    const v = object(data.vehicle, `${label} vehicle`);
    keys(v, ['override', 'settings'], `${label} vehicle`);
    if (v.override !== true) throw new Error(`${label} vehicle: existing settings require override: true`);
    validateVehicle(v.settings, label);
  }
  for (const kind of ['universes', 'presets', 'appearance'] as const) {
    if (data[kind] === undefined) continue;
    if (!Array.isArray(data[kind]) || data[kind].length > 256) throw new Error(`${label} ${kind}: expected at most 256 entries`);
    for (const rawEntry of data[kind]) {
      const e = object(rawEntry, `${label} ${kind}`);
      keys(e, kind === 'universes' ? ['definition', 'target', 'override'] : kind === 'presets'
        ? ['universe', 'system', 'preset', 'override'] : ['universe', 'system', 'body', 'override', 'colors'], `${label} ${kind}`);
      if (e.override !== undefined && e.override !== true) throw new Error(`${label} ${kind}: override must be true when supplied`);
      if (kind === 'universes') {
        try {
          const universe = validateUniverse(e.definition);
          for (const system of universe.systems) {
            if (system.vehicleDefaults !== undefined) validateVehicle(system.vehicleDefaults, `${label} system ${system.id}`);
            for (const preset of system.presets) validatePreset(preset, label);
          }
        } catch (error) { throw new Error(`${label} universe: ${(error as Error).message}`); }
        if (e.target !== undefined) { string(e.target, `${label} universe target`); if (e.override !== true) throw new Error(`${label}: universe replacement requires override: true`); }
        else if (e.override) throw new Error(`${label}: universe override requires an explicit target`);
      } else {
        string(e.universe, `${label} universe`); string(e.system, `${label} system`);
        if (kind === 'presets') validatePreset(e.preset, label);
        else {
          string(e.body, `${label} body`);
          if (e.override !== true) throw new Error(`${label} appearance: requires override: true`);
          const colors = object(e.colors, `${label} appearance`);
          keys(colors, COLORS, `${label} appearance`);
          for (const [key, color] of Object.entries(colors)) if (typeof color !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error(`${label} appearance ${key}: expected #RRGGBB`);
        }
      }
    }
  }
  return freezeJson({ format: root.format, manifest, data }) as unknown as DataModule;
}
export function parseDataModule(text: string): DataModule {
  if (new TextEncoder().encode(text).length > MAX_MODULE_BYTES) throw new Error('Data module: files must be at most 4 MiB');
  return validateDataModule(JSON.parse(text));
}
export function exportDataModule(module: DataModule): string { return JSON.stringify(validateDataModule(module), null, 2); }

/** Namespaced content, explicit replacements, and a single writer for each exposed field.
 * No traversal of arbitrary object paths or last-loaded-wins policy. */
export function applyDataModules(base: ReadonlyMap<string, UniverseDefinition>, modules: readonly DataModule[]): ReadonlyMap<string, UniverseDefinition> {
  const universes = new Map(base);
  const writers = new Map<string, string>();
  const claim = (target: string, id: string): void => {
    if (writers.has(target)) throw new Error(`Module ${id}: conflicting override ${target} (also ${writers.get(target)})`);
    writers.set(target, id);
  };
  // Additions are installed first. A single explicit override may then replace an
  // existing built-in or data universe; two replacements of one key are a conflict.
  for (const m of modules) for (const entry of m.data.universes ?? []) if (!entry.target) {
    const key = `${m.manifest.id}/${entry.definition.id}`;
    if (universes.has(key)) throw new Error(`Module ${m.manifest.id}: duplicate universe ${key}`);
    universes.set(key, freezeJson(validateUniverse(entry.definition)));
  }
  for (const m of modules) for (const entry of m.data.universes ?? []) if (entry.target) {
    const key = entry.target;
    claim(`universe:${key}`, m.manifest.id);
    if (!universes.has(key)) throw new Error(`Module ${m.manifest.id}: unknown universe override ${key}`);
    universes.set(key, freezeJson(validateUniverse(entry.definition)));
  }
  // Additions are available before field overrides, independent of registration order.
  for (const m of modules) {
    const id = m.manifest.id;
    if (m.data.vehicle) for (const key of Object.keys(m.data.vehicle.settings)) claim(`vehicle:${key}`, id);
    for (const entry of m.data.presets ?? []) {
      const u = universes.get(entry.universe);
      const system = u?.systems.find(s => s.id === entry.system);
      if (!u || !system) throw new Error(`Module ${id}: unknown preset target ${entry.universe}/${entry.system}`);
      claim(`preset:${entry.universe}/${entry.system}/${entry.preset.id}`, id);
      const existing = system.presets.some(p => p.id === entry.preset.id);
      if (existing !== (entry.override === true)) throw new Error(`Module ${id} preset ${entry.preset.id}: ${existing ? 'requires override: true' : 'override target does not exist'}`);
      const updated = { ...u, systems: u.systems.map(s => s !== system ? s : { ...s,
        presets: [...s.presets.filter(p => p.id !== entry.preset.id), entry.preset] }) };
      try { universes.set(entry.universe, validateUniverse(updated)); } catch (error) { throw new Error(`Module ${id} preset ${entry.preset.id}: ${(error as Error).message}`); }
    }
    for (const entry of m.data.appearance ?? []) {
      const u = universes.get(entry.universe), system = u?.systems.find(s => s.id === entry.system);
      if (!u || !system?.bodies.some(b => b.id === entry.body)) throw new Error(`Module ${id}: unknown appearance target ${entry.universe}/${entry.system}/${entry.body}`);
      for (const key of Object.keys(entry.colors)) claim(`appearance:${entry.universe}/${entry.system}/${entry.body}/${key}`, id);
      universes.set(entry.universe, freezeJson({ ...u, systems: u.systems.map(s => s !== system ? s : { ...s,
        bodies: s.bodies.map(b => b.id !== entry.body ? b : { ...b, ...entry.colors }) }) }));
    }
  }
  // Vehicle settings are part of the world's universe, so presets and prediction use
  // exactly the same settings as live motion. No context-only setting overlays.
  for (const m of modules) if (m.data.vehicle) for (const [key, u] of universes) {
    universes.set(key, freezeJson({ ...u, systems: u.systems.map(s => ({ ...s,
      vehicleDefaults: { ...s.vehicleDefaults, ...m.data.vehicle!.settings } })) }));
  }
  return universes;
}
