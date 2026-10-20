/** Host-only (`packages/game-runtime`): v2 manifest and profile validation. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); authors check manifests with `npm run module:validate`. */
import type { CapabilityNeed, CapabilityRef, ManifestV2, ModuleProfileV2, ModuleTier } from '../../game-api/src/index';
import { validRange } from './semver';
import { freezeJson, keys, moduleId, object, ranges, string, strings, validateManifest, validateProfile, version } from './validation';

/** Capability and slot names: dot-separated segments of lowercase letters, digits and hyphens, each starting with a letter (for example `net.websocket`). Host-only (`packages/game-runtime`). */
export const SERVICE_SLOT = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const TIERS: readonly ModuleTier[] = ['authoritative', 'presentation', 'platform', 'network'];
/** Returns `raw` when it matches `SERVICE_SLOT`, otherwise throws `Invalid capability name <name>`. Host-only (`packages/game-runtime`). */
export function capabilityName(raw: unknown): string {
  const name = string(raw, 'Capability name');
  if (!SERVICE_SLOT.test(name)) throw new Error(`Invalid capability name ${name}`);
  return name;
}
function capabilities(raw: unknown, needs: boolean): (CapabilityRef | CapabilityNeed)[] {
  if (!Array.isArray(raw) || raw.length > 256) throw new Error('Capabilities: expected at most 256 entries');
  const values = raw.map(value => {
    const c = object(value, 'Capability'); keys(c, needs ? ['name', 'version', 'optional'] : ['name', 'version'], 'Capability');
    const name = capabilityName(c.name);
    const v = needs ? string(c.version, `Capability ${name} range`) : version(c.version, `Capability ${name}`);
    if (needs && !validRange(v)) throw new Error(`Capability ${name}: invalid version range ${v}`);
    if (c.optional !== undefined && typeof c.optional !== 'boolean') throw new Error(`Capability ${name}: optional must be boolean`);
    return { name, version: v.trim().replace(/\s+/g, ' '), ...(c.optional !== undefined ? { optional: c.optional as boolean } : {}) };
  });
  if (new Set(values.map(c => c.name)).size !== values.length) throw new Error('Duplicate capability name');
  return values;
}
/** Validates and freezes a `space-sim-module/2` manifest. Requires `apiVersion` `space-sim-game-api/2` (`Unsupported manifest/API version`), tier `authoritative`, `presentation`, `platform` or `network`, and at most 256 capabilities per list with exact provided versions and valid needed ranges. `core.*`, `input.source` and `transport` slots and `core.*` provides are reserved for the engine; data modules declare no slots. Shared fields follow `validateManifest`. Host-only (`packages/game-runtime`). */
export function validateManifestV2(raw: unknown): ManifestV2 {
  const m = object(raw, 'Manifest v2');
  keys(m, ['format', 'apiVersion', 'id', 'name', 'version', 'kind', 'tier', 'environments', 'dependencies', 'conflicts',
    'provides', 'requires', 'slots', 'before', 'after', 'beforeIfPresent', 'afterIfPresent', 'settings', 'license'], 'Manifest v2');
  if (m.format !== 'space-sim-module/2' || m.apiVersion !== 'space-sim-game-api/2') throw new Error('Unsupported manifest/API version');
  if (!TIERS.includes(m.tier as ModuleTier)) throw new Error('Manifest v2: invalid tier');
  // Reuse the strict v1 validators for unchanged contracts without serializing a v1 manifest.
  const { tier: _tier, beforeIfPresent: _before, afterIfPresent: _after, ...legacyFields } = m;
  const common = validateManifest({ ...legacyFields, format: 'space-sim-module/1', apiVersion: 'space-sim-game-api/1',
    authority: m.tier === 'authoritative' ? 'authoritative' : 'presentation',
    provides: [], requires: [], slots: [] });
  const slots = strings(m.slots, 'Manifest v2 slots');
  if (slots.some(s => !SERVICE_SLOT.test(s) || s.startsWith('core.') || ['input.source', 'transport'].includes(s))
    || m.kind === 'data' && slots.length) throw new Error('Manifest v2: invalid or reserved singleton slot');
  if (capabilities(m.provides, false).some(c => c.name.startsWith('core.'))) throw new Error('core.* capabilities are reserved for the engine');
  const { authority: _authority, ...fields } = common;
  return freezeJson({ ...fields, format: m.format, apiVersion: m.apiVersion, tier: m.tier,
    conflicts: ranges(m.conflicts, 'Manifest v2 conflicts'), slots,
    provides: capabilities(m.provides, false), requires: capabilities(m.requires, true),
    ...(m.beforeIfPresent !== undefined ? { beforeIfPresent: strings(m.beforeIfPresent, 'beforeIfPresent').map(v => moduleId(v, 'beforeIfPresent')) } : {}),
    ...(m.afterIfPresent !== undefined ? { afterIfPresent: strings(m.afterIfPresent, 'afterIfPresent').map(v => moduleId(v, 'afterIfPresent')) } : {}),
  }) as ManifestV2;
}
/** Validates and freezes a `space-sim-profile/2` profile: exact module references, slot providers, per-module capability provider choices and numeric settings. Host-only (`packages/game-runtime`). */
export function validateProfileV2(raw: unknown): ModuleProfileV2 {
  const p = object(raw, 'Profile v2');
  keys(p, ['format', 'id', 'modules', 'providers', 'capabilities', 'settings'], 'Profile v2');
  if (p.format !== 'space-sim-profile/2') throw new Error('Profile v2: unsupported format');
  const common = validateProfile({ format: 'space-sim-profile/1', id: p.id, modules: p.modules, providers: p.providers, settings: p.settings });
  const bindings: Record<string, Record<string, string>> = Object.create(null);
  for (const [id, raw] of Object.entries(object(p.capabilities, 'Profile capabilities'))) {
    moduleId(id, 'Capability requester'); const choices: Record<string, string> = Object.create(null);
    for (const [name, provider] of Object.entries(object(raw, `Module ${id} capabilities`))) choices[capabilityName(name)] = moduleId(provider, 'Capability provider');
    bindings[id] = choices;
  }
  return freezeJson({ ...common, format: 'space-sim-profile/2', capabilities: bindings });
}
