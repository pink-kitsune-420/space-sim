import type { CapabilityBinding, CapabilityNeed, HostServiceAccess, ManifestV2, ModuleEnvironment, ModuleLockV2, ModuleTier } from '../../game-api/src/index';
import { satisfies } from './semver';
import { freezeJson } from './validation';
import { validateProfileV2 } from './validation-v2';

export interface ResolutionDiagnostic {
  readonly code: 'missing' | 'version' | 'environment' | 'tier' | 'provider' | 'capability' | 'conflict' | 'cycle' | 'settings' | 'ordering';
  readonly requester: string;
  readonly need: string;
  readonly candidates: readonly { readonly id: string; readonly name: string; readonly version: string }[];
  readonly actions: readonly string[];
  readonly chain?: readonly string[];
}
/** The manager and headless adapters can render the same structured dependency failure. */
export class ModuleResolutionError extends Error {
  readonly diagnostic: ResolutionDiagnostic;
  constructor(message: string, diagnostic: ResolutionDiagnostic) {
    super(message); this.name = 'ModuleResolutionError'; this.diagnostic = freezeJson(diagnostic);
  }
}
export function permitsDependency(from: ModuleTier, to: ModuleTier): boolean {
  return from === 'authoritative' ? to === 'authoritative'
    : from === 'presentation' ? to === 'presentation' || to === 'authoritative' : true;
}
/** Pure metadata resolution: never enables installed suggestions or evaluates module code. */
export function resolveModulesV2(installed: ReadonlyMap<string, ManifestV2>, raw: unknown,
  environment: ModuleEnvironment, requiredSlots: readonly string[] = [], hostServices: readonly HostServiceAccess[] = []): ModuleLockV2 {
  const profile = validateProfileV2(raw);
  const fail = (code: ResolutionDiagnostic['code'], requester: string, need: string, message: string,
    candidates: readonly ManifestV2[] = [], chain?: string[]): never => {
    throw new ModuleResolutionError(message, { code, requester, need,
      candidates: candidates.map(m => ({ id: m.id, name: m.name, version: m.version })),
      actions: candidates.length ? ['Enable a compatible module, or remove the requesting module.'] : ['Install a compatible module, or remove the requesting module.'],
      ...(chain ? { chain } : {}) });
  };
  const selected = new Map(profile.modules.map(ref => {
    const m = installed.get(ref.id);
    if (!m) return fail('missing', ref.id, ref.version, `${ref.id} is not installed.`);
    if (m.version !== ref.version) return fail('version', ref.id, ref.version, `${m.name} needs version ${ref.version}; installed ${m.version}.`);
    if (!m.environments.includes(environment)) return fail('environment', ref.id, environment, `${m.name} cannot run in ${environment}.`);
    return [m.id, m] as const;
  }));
  const slots = new Map<string, ManifestV2[]>();
  for (const m of selected.values()) for (const slot of m.slots) slots.set(slot, [...slots.get(slot) ?? [], m]);
  const providers: Record<string, string> = Object.create(null);
  for (const slot of requiredSlots) if (!slots.has(slot)) fail('provider', profile.id, slot, `This game needs a provider for ${slot}.`);
  for (const slot of Object.keys(profile.providers)) if (!slots.has(slot)) fail('provider', profile.id, slot, `No enabled module provides ${slot}.`);
  for (const [slot, choices] of slots) {
    const id = Object.hasOwn(profile.providers, slot) ? profile.providers[slot] : choices.length === 1 ? choices[0]!.id : undefined;
    if (!id || !choices.some(m => m.id === id)) fail('provider', profile.id, slot, `Select one provider for ${slot}: ${choices.map(m => m.name).sort().join(', ')}.`, choices);
    providers[slot] = id!;
  }
  const active = new Map([...selected].filter(([id, m]) => !m.slots.length || Object.values(providers).includes(id)));
  const edges = new Map([...selected.keys()].map(id => [id, new Map<string, string>()]));
  const edge = (from: string, to: string, reason: string): void => { edges.get(from)!.set(to, reason); };
  const tier = (m: ManifestV2, provider: ManifestV2, need: string): void => {
    if (!permitsDependency(m.tier, provider.tier)) fail('tier', m.id, need, `${m.name} (${m.tier}) cannot depend on ${provider.name} (${provider.tier}).`);
  };
  const bindings: Record<string, Record<string, CapabilityBinding>> = Object.create(null);
  const settings: Record<string, Record<string, number>> = Object.create(null);
  for (const [id, m] of selected) {
    const values: Record<string, number> = Object.create(null), overrides = profile.settings[id] ?? {};
    for (const key of Object.keys(overrides)) if (!Object.hasOwn(m.settings, key)) fail('settings', id, key, `${m.name} has no setting named ${key}.`);
    for (const [key, schema] of Object.entries(m.settings)) {
      const value = Object.hasOwn(overrides, key) ? overrides[key]! : schema.default;
      if (value < schema.minimum || value > schema.maximum) fail('settings', id, key, `${m.name}: ${key} must be between ${schema.minimum} and ${schema.maximum}.`);
      values[key] = value;
    }
    settings[id] = values;
    for (const conflict of m.conflicts) {
      const other = selected.get(conflict.id);
      if (other && satisfies(other.version, conflict.version)) fail('conflict', id, conflict.id, `${m.name} conflicts with ${other.name} ${other.version}.`);
    }
    for (const [targets, direction, optional] of [[m.before, 'before', false], [m.after, 'after', false],
      [m.beforeIfPresent ?? [], 'before', true], [m.afterIfPresent ?? [], 'after', true]] as const) for (const target of targets) {
      if (!selected.has(target)) { if (!optional) fail('ordering', id, target, `${m.name}: ${direction} target ${target} is not enabled.`); continue; }
      const other = selected.get(target)!;
      tier(direction === 'before' ? other : m, direction === 'before' ? m : other, `ordering ${direction} ${target}`);
      edge(direction === 'before' ? id : target, direction === 'before' ? target : id, `${direction} ${target}`);
    }
    // Inactive alternatives cannot demand executable services, but their metadata remains locked.
    if (!active.has(id)) continue;
    for (const dep of m.dependencies) {
      const provider = active.get(dep.id);
      if (!provider) fail('missing', id, dep.id, `${m.name} needs enabled dependency ${dep.id}@${dep.version}.`,
        [...installed.values()].filter(v => v.id === dep.id && satisfies(v.version, dep.version) && v.environments.includes(environment)));
      if (!satisfies(provider!.version, dep.version)) fail('version', id, dep.id, `${m.name} needs ${dep.id}@${dep.version}; enabled ${provider!.version}.`);
      tier(m, provider!, dep.id); edge(dep.id, id, `dependency ${dep.id}`);
    }
    bindings[id] = Object.create(null) as Record<string, CapabilityBinding>;
    const choices = profile.capabilities[id] ?? {};
    for (const name of Object.keys(choices)) if (!m.requires.some(n => n.name === name)) fail('capability', id, name, `${m.name} does not declare a need for ${name}.`);
    for (const need of m.requires) {
      const explicitChoice = Object.hasOwn(choices, need.name) ? choices[need.name] : undefined;
      const host = hostServices.find(h => h.key.slot === need.name && satisfies(h.key.version, need.version)
        && h.tiers.includes(m.tier) && h.environments.includes(environment));
      if (host && (!explicitChoice || explicitChoice === 'builtin.engine')) {
        bindings[id]![need.name] = { name: need.name, version: host.key.version, provider: { id: 'builtin.engine', version: '1.0.0' } };
        continue;
      }
      const compatible = (p: ManifestV2): boolean => p.kind !== 'data' && p.environments.includes(environment)
        && permitsDependency(m.tier, p.tier) && p.provides.some(c => c.name === need.name && satisfies(c.version, need.version));
      const candidates = [...active.values()].filter(compatible).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      const choice = explicitChoice;
      const provider = choice ? candidates.find(p => p.id === choice) : candidates.length === 1 ? candidates[0] : undefined;
      if (!provider) {
        if (!choice && need.optional && !candidates.length) continue;
        const suggestions = [...installed.values()].filter(compatible).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        missingCapability(m, need, candidates, suggestions, fail);
      }
      const cap = provider!.provides.find(c => c.name === need.name)!;
      bindings[id]![need.name] = { ...cap, provider: { id: provider!.id, version: provider!.version } };
      if (provider!.id !== id) edge(provider!.id, id, `capability ${need.name}@${need.version}`);
    }
  }
  for (const id of Object.keys(profile.settings)) if (!selected.has(id)) fail('settings', id, id, `${id} has settings but is not enabled.`);
  for (const id of Object.keys(profile.capabilities)) if (!active.has(id)) fail('capability', id, id, `${id} has capability choices but is not active.`);
  // DFS retains the actual cycle and edge causes; Kahn's algorithm supplies stable ASCII ties.
  const visited = new Set<string>(), stack: string[] = [];
  const visit = (id: string): void => {
    const at = stack.indexOf(id);
    if (at !== -1) {
      const cycle = [...stack.slice(at), id];
      const chain = cycle.slice(0, -1).map((from, i) => `${from} --${edges.get(from)!.get(cycle[i + 1]!)}--> ${cycle[i + 1]}`);
      fail('cycle', id, id, `Module dependency cycle: ${chain.join('; ')}`, [], chain);
    }
    if (visited.has(id)) return;
    stack.push(id); for (const to of edges.get(id)!.keys()) visit(to); stack.pop(); visited.add(id);
  };
  for (const id of [...selected.keys()].sort()) visit(id);
  const incoming = new Map([...selected.keys()].map(id => [id, 0]));
  for (const targets of edges.values()) for (const id of targets.keys()) incoming.set(id, incoming.get(id)! + 1);
  const order: string[] = [];
  while (incoming.size) {
    const id = [...incoming.keys()].filter(id => incoming.get(id) === 0).sort()[0]!;
    order.push(id); incoming.delete(id);
    for (const to of edges.get(id)!.keys()) incoming.set(to, incoming.get(to)! - 1);
  }
  return freezeJson({ format: 'space-sim-lock/2', profileId: profile.id,
    modules: order.map(id => ({ id, version: selected.get(id)!.version })), order, providers, capabilities: bindings, settings });
}
function missingCapability(m: ManifestV2, need: CapabilityNeed, candidates: ManifestV2[], suggestions: ManifestV2[],
  fail: (code: ResolutionDiagnostic['code'], requester: string, need: string, message: string, candidates: ManifestV2[]) => never): never {
  return fail('capability', m.id, `${need.name}@${need.version}`, candidates.length
    ? `${m.name} needs ${need.name}@${need.version}. Choose a compatible provider: ${candidates.map(p => p.name).join(', ')}.`
    : `${m.name} needs ${need.name}@${need.version}. ${suggestions.length ? `Enable ${suggestions.map(p => p.name).join(' or ')}` : 'Install a compatible module'}, or remove ${m.name}.`, suggestions);
}
