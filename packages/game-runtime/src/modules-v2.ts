import type { ActionDefinitionV2, CapabilityBinding, Disposable, GuidePage, HostServiceAccess, InputSource, ManifestV2,
  MaterialDefinition, ModuleAssets, ModuleContribution, ModuleEnvironment, ModuleInitializationV2, ModuleLockV2,
  ModuleProfileV2, PostEffectDefinition, RegisteredModuleV2, ServiceKey, TransportProvider, DiscoveryProvider,
  WindowDefinition } from '../../game-api/src/index';
import { ModuleCandidate } from './index';
import { artifactPath } from './artifact';
import { DeviceHooks, captureActions, captureEffect, captureGuide, captureWindow, validateGuideDocument } from './hooks-v2';
import { resolveModulesV2 } from './resolver-v2';
import { version } from './validation';
import { capabilityName, validateManifestV2 } from './validation-v2';

/** Candidate-only assets. Only declared paths are visible and binary reads are defensive. */
export function moduleAssets(files: ReadonlyMap<string, Uint8Array> = new Map(),
  createUrl?: (bytes: Uint8Array) => { readonly href: string; dispose(): void }): ModuleAssets {
  const owned = new Map([...files].map(([path, bytes]) => [artifactPath(path), bytes.slice()]));
  const read = (path: string): Uint8Array => {
    const bytes = owned.get(artifactPath(path)); if (!bytes) throw new Error(`Undeclared module asset ${path}`); return bytes;
  };
  return Object.freeze({ text: (path: string) => new TextDecoder('utf-8', { fatal: true }).decode(read(path)),
    bytes: (path: string) => read(path).slice(),
    url: (path: string) => {
      if (!createUrl) throw new Error('Object URLs require an owned browser asset adapter');
      return createUrl(read(path).slice());
    } });
}
/** Separate v2 registry: no v1 lock, serializer or authoritative fingerprint changes. */
export class ModuleRegistryV2 {
  private readonly modules = new Map<string, RegisteredModuleV2>();
  private readonly assets = new Map<string, ModuleAssets>();
  private readonly prepared = new WeakMap<ModuleCandidateV2, ModuleEnvironment>();
  private readonly host: readonly HostServiceAccess[];
  constructor(hostServices: readonly HostServiceAccess[] = []) {
    const seen = new Set<string>();
    this.host = Object.freeze(hostServices.map(h => {
      const slot = capabilityName(h.key.slot); version(h.key.version, `Host service ${slot}`);
      if (!slot.startsWith('core.') || seen.has(slot) || h.service === undefined) throw new Error(`Invalid or duplicate engine service ${slot}`);
      if (!h.tiers.length || h.tiers.some(t => !['authoritative', 'presentation', 'platform', 'network'].includes(t))
        || !h.environments.length || h.environments.some(e => !['browser', 'offline', 'node'].includes(e))) throw new Error(`Invalid host service access ${slot}`);
      seen.add(slot);
      return Object.freeze({ key: Object.freeze({ slot, version: h.key.version }), service: h.service,
        tiers: Object.freeze([...h.tiers]), environments: Object.freeze([...h.environments]) });
    }));
  }
  get manifests(): ReadonlyMap<string, ManifestV2> { return new Map([...this.modules].map(([id, m]) => [id, m.manifest])); }
  get contentDigests(): Readonly<Record<string, string>> {
    return Object.fromEntries([...this.modules].filter(([, m]) => m.contentDigest !== undefined).map(([id, m]) => [id, m.contentDigest!]));
  }
  register(module: RegisteredModuleV2, assets: ModuleAssets = moduleAssets()): void {
    const manifest = validateManifestV2(module.manifest);
    if (manifest.id === 'builtin.engine' || this.modules.has(manifest.id)) throw new Error(`Duplicate or reserved module ${manifest.id}`);
    if (typeof module.initialize !== 'function') throw new Error(`Module ${manifest.id}: initializer must be a function`);
    if (module.contentDigest !== undefined && !/^[0-9a-f]{64}$/.test(module.contentDigest)) throw new Error(`Module ${manifest.id}: invalid content digest`);
    this.modules.set(manifest.id, { manifest, initialize: module.initialize, contentDigest: module.contentDigest, supportsMultiplayer: module.supportsMultiplayer });
    this.assets.set(manifest.id, assets);
  }
  resolve(profile: unknown, environment: ModuleEnvironment, slots: readonly string[] = []): ModuleLockV2 {
    return resolveModulesV2(this.manifests, profile, environment, slots, this.host);
  }
  prepare(profile: ModuleProfileV2, environment: ModuleEnvironment, slots: readonly string[] = []): ModuleCandidateV2 {
    const lock = this.resolve(profile, environment, slots);
    const soloPreview = lock.order.some(id => {
      const module = this.modules.get(id)!;
      return module.manifest.tier === 'authoritative' && !id.startsWith('builtin.') && !module.supportsMultiplayer
        && (!module.manifest.slots.length || Object.values(lock.providers).includes(id));
    });
    const candidate = new ModuleCandidateV2(lock, soloPreview);
    try {
      for (const id of candidate.lock.order) {
        const m = this.modules.get(id)!, manifest = m.manifest;
        if (manifest.slots.length && !Object.values(candidate.lock.providers).includes(id)) continue;
        if (manifest.kind === 'data') continue;
        const requireTier = (tiers: readonly string[], hook: string): void => {
          if (!tiers.includes(manifest.tier)) throw new Error(`Module ${id}: ${hook} is unavailable to ${manifest.tier} modules`);
        };
        const mutable = (): void => candidate.assertInitializing();
        const rawAssets = this.assets.get(id)!;
        const assets: ModuleAssets = Object.freeze({ text: rawAssets.text.bind(rawAssets), bytes: rawAssets.bytes.bind(rawAssets),
          url: (path: string) => candidate.own(rawAssets.url(path)) });
        const context = Object.freeze<ModuleInitializationV2>({ settings: candidate.lock.settings[id]!, assets,
          own: <T extends Disposable>(resource: T): T => { return candidate.own(resource); },
          selected: (slot: string) => candidate.lock.providers[slot] === id,
          provide: <T>(key: ServiceKey<T>, service: T): void => {
            mutable(); checkKey(key);
            if (candidate.lock.providers[key.slot] !== id || !manifest.provides.some(c => c.name === key.slot && c.version === key.version)) throw new Error(`Module ${id}: not selected/declared for ${key.slot}@${key.version}`);
            candidate.provide(key, service);
          },
          use: <T>(key: ServiceKey<T>): T => {
            mutable(); checkKey(key); const binding = candidate.lock.capabilities[id]?.[key.slot];
            if (!binding || binding.version !== key.version) throw new Error(`Module ${id}: undeclared or incompatible service ${key.slot}@${key.version}`);
            if (binding.provider.id === 'builtin.engine') return this.host.find(h => h.key.slot === key.slot)!.service as T;
            return candidate.boundService<T>(binding);
          },
          expose: (api: object) => { mutable(); candidate.core.expose(id, api); },
          dependency: <T extends object>(target: string): T => {
            mutable(); const provider = this.modules.get(target)?.manifest;
            if (!manifest.dependencies.some(d => d.id === target) || !provider || provider.tier !== manifest.tier) throw new Error(`Module ${id}: dependency API must be declared in the same tier`);
            return candidate.core.exposed<T>(target);
          },
          migrateState: (from: number, fn: Parameters<ModuleInitializationV2['migrateState']>[1]) => {
            mutable(); requireTier(['authoritative'], 'state migration'); candidate.core.addMigration(id, from, fn);
          },
          contributeForce: hook => { mutable(); requireTier(['authoritative'], 'forces'); candidate.core.contributeForce(id, manifest.version, hook); },
          contributeWorldRule: hook => { mutable(); requireTier(['authoritative'], 'world rules'); candidate.core.contributeWorldRule(id, manifest.version, hook); },
          contributeCommand: hook => { mutable(); requireTier(['authoritative'], 'commands'); candidate.core.contributeCommand(id, manifest.version, hook); },
          contributeLayer: hook => { mutable(); requireTier(['presentation'], 'layers'); candidate.core.contributePresentation('layer', id, manifest.version, hook); },
          contributePanel: hook => { mutable(); requireTier(['presentation'], 'panels'); candidate.core.contributePresentation('panel', id, manifest.version, hook); },
          contributeCamera: hook => { mutable(); requireTier(['presentation'], 'cameras'); candidate.core.contributePresentation('camera', id, manifest.version, hook); },
          contributeInput: source => { mutable(); requireTier(['platform'], 'input'); candidate.add('input', candidate.hooks.input(id, source, () => candidate.actionIds), 16); },
          contributeActions: actions => { mutable(); requireTier(['platform'], 'actions'); candidate.addActions(id, captureActions(actions, id)); },
          contributeTransport: provider => { mutable(); requireTier(['network'], 'transport'); candidate.add('transport', candidate.hooks.transport(id, provider), 16); },
          contributeDiscovery: provider => { mutable(); requireTier(['network'], 'discovery'); candidate.add('discovery', candidate.hooks.discovery(id, provider), 16); },
          contributeWindow: window => { mutable(); requireTier(['platform'], 'windows'); candidate.add('window', contribution(id, captureWindow(window)), 16); },
          contributeGuide: page => {
            mutable(); requireTier(['platform', 'presentation'], 'guides'); const captured = captureGuide(page);
            const document = assets.text(captured.asset); validateGuideDocument(document, captured);
            candidate.add('guide', { moduleId: id, id: `${id}/${captured.id}`, value: captured }, 256, 256);
            candidate.guideDocuments.set(`${id}/${captured.id}`, document);
          },
          contributeMaterial: material => {
            mutable(); requireTier(['presentation'], 'materials'); const captured = captureEffect(material, false);
            validateShader(assets, captured.fragmentAsset); candidate.add('material', contribution(id, captured), 8, 8);
          },
          contributePostEffect: effect => {
            mutable(); requireTier(['presentation'], 'post effects'); const captured = captureEffect(effect, true);
            validateShader(assets, captured.fragmentAsset); candidate.add('post', contribution(id, captured), 4, 4);
          },
        });
        try {
          const result: unknown = m.initialize(context);
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
            // Observe rejection while rejecting asynchronous initialization itself.
            void Promise.resolve(result).catch(() => {}); throw new Error('Initialization must be synchronous');
          }
        } catch (error) { throw new Error(`Module ${id} initialization: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); }
      }
      candidate.seal(); this.prepared.set(candidate, environment); return candidate;
    } catch (error) { candidate.dispose(); throw error; }
  }
  preparedFor(candidate: ModuleCandidateV2, environment: ModuleEnvironment): boolean { return this.prepared.get(candidate) === environment; }
}
function checkKey(key: Pick<ServiceKey<unknown>, 'slot' | 'version'>): void { capabilityName(key.slot); version(key.version, 'Service version'); }
function contribution<T extends { readonly name: string }>(moduleId: string, value: T): ModuleContribution<T> { return Object.freeze({ moduleId, id: `${moduleId}/${value.name}`, value }); }
function validateShader(assets: ModuleAssets, path: string): void {
  const text = assets.text(path);
  if (!text.trim() || new TextEncoder().encode(text).length > 256 * 1024) throw new Error('Shader must contain at most 256 KiB of text');
}
interface Contributions {
  input: InputSource; transport: TransportProvider; discovery: DiscoveryProvider; window: WindowDefinition;
  guide: GuidePage; material: MaterialDefinition; post: PostEffectDefinition;
}
export class ModuleCandidateV2 implements Disposable {
  /** Reuses validated deterministic/presentation hook capture; its private v1-shaped lock
   * is never serialized or used to derive an authoritative identity. */
  readonly core: ModuleCandidate;
  readonly hooks = new DeviceHooks();
  private readonly owned = new WeakSet<Disposable>();
  private readonly services = new Map<string, { version: string; value: unknown }>();
  private readonly lists: { [K in keyof Contributions]: ModuleContribution<Contributions[K]>[] } = {
    input: [], transport: [], discovery: [], window: [], guide: [], material: [], post: [],
  };
  private readonly actions: ActionDefinitionV2[] = [];
  readonly actionIds = new Set<string>();
  readonly guideDocuments = new Map<string, string>();
  private sealed = false;
  private disposed = false;
  constructor(readonly lock: ModuleLockV2, readonly soloPreview = false) {
    this.core = new ModuleCandidate({ format: 'space-sim-lock/1', profileId: lock.profileId, modules: lock.modules,
      order: lock.order, providers: lock.providers, settings: lock.settings });
    this.core.own(this.hooks);
  }
  get available(): boolean { return !this.disposed; }
  get actionDefinitions(): readonly ActionDefinitionV2[] { return Object.freeze([...this.actions]); }
  contributions<K extends keyof Contributions>(kind: K): readonly ModuleContribution<Contributions[K]>[] { return Object.freeze([...this.lists[kind]]); }
  assertInitializing(): void { if (this.sealed || this.disposed) throw new Error('Module candidate is sealed or disposed'); }
  own<T extends Disposable>(resource: T): T {
    if (!resource || typeof resource.dispose !== 'function') throw new Error('Owned resource must have a dispose method');
    if (this.owned.has(resource)) { this.assertInitializing(); return resource; }
    this.owned.add(resource);
    const dispose = resource.dispose.bind(resource);
    if (this.sealed || this.disposed) {
      try { dispose(); } finally { throw new Error('Module candidate is sealed or disposed'); }
    }
    this.core.own({ dispose }); return resource;
  }
  add<K extends keyof Contributions>(kind: K, item: ModuleContribution<Contributions[K]>, perModule: number, total = 4096): void {
    this.assertInitializing(); const list = this.lists[kind];
    if (list.length >= total || list.filter(c => c.moduleId === item.moduleId).length >= perModule) throw new Error(`Too many ${kind} contributions`);
    if (Object.values(this.lists).some(entries => entries.some((c: ModuleContribution<unknown>) => c.id === item.id))) throw new Error(`Duplicate contribution ${item.id}`);
    list.push(Object.freeze(item));
  }
  addActions(id: string, actions: readonly ActionDefinitionV2[]): void {
    this.assertInitializing();
    if (this.actions.filter(a => a.id.startsWith(`${id}/`)).length + actions.length > 128) throw new Error('At most 128 actions per module');
    for (const action of actions) { if (this.actionIds.has(action.id)) throw new Error(`Duplicate action ${action.id}`); this.actionIds.add(action.id); this.actions.push(action); }
  }
  provide<T>(key: ServiceKey<T>, service: T): void {
    this.assertInitializing(); if (service === undefined || this.services.has(key.slot)) throw new Error(`Duplicate or missing service ${key.slot}`);
    this.services.set(key.slot, { version: key.version, value: service });
  }
  /** Typed composition access after preparation; module access still requires a binding. */
  providedService<T>(key: ServiceKey<T>): T {
    const id = this.lock.providers[key.slot];
    if (!id) throw new Error(`No selected provider for ${key.slot}`);
    return this.boundService({ name: key.slot, version: key.version, provider: this.lock.modules.find(ref => ref.id === id)! });
  }
  boundService<T>(binding: CapabilityBinding): T {
    if (this.disposed) throw new Error('Module candidate is disposed');
    const service = this.services.get(binding.name);
    if (!service || service.version !== binding.version || this.lock.providers[binding.name] !== binding.provider.id) throw new Error(`Service ${binding.name}@${binding.version} is not available from ${binding.provider.id}`);
    return service.value as T;
  }
  seal(): void {
    this.assertInitializing();
    for (const [slot, id] of Object.entries(this.lock.providers)) if (!this.services.has(slot)) throw new Error(`Module ${id} did not provide service ${slot}`);
    for (const window of this.lists.window) for (const control of window.value.controls) if ('action' in control && !this.actionIds.has(control.action)) throw new Error(`Window ${window.id}: unknown action ${control.action}`);
    const bodies = new Map<string, string>();
    for (const material of this.lists.material) for (const id of material.value.bodyIds) {
      if (bodies.has(id)) throw new Error(`Body ${id} has conflicting materials ${bodies.get(id)} and ${material.id}`); bodies.set(id, material.id);
    }
    const order: ModuleContribution<PostEffectDefinition>[] = [], pending = new Map(this.lists.post.map(c => [c.id, c]));
    for (const item of pending.values()) for (const id of item.value.after) if (!pending.has(id)) throw new Error(`Post effect ${item.id}: missing dependency ${id}`);
    while (pending.size) {
      const id = [...pending.keys()].sort().find(id => pending.get(id)!.value.after.every(dep => !pending.has(dep)));
      if (!id) throw new Error('Post effect ordering cycle'); order.push(pending.get(id)!); pending.delete(id);
    }
    this.lists.post = order; this.sealed = true; this.core.seal();
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true; this.core.dispose(); this.services.clear(); this.actions.length = 0; this.actionIds.clear();
    this.guideDocuments.clear(); for (const list of Object.values(this.lists)) list.length = 0;
  }
}
export class ModuleRuntimeV2 implements Disposable {
  active: ModuleCandidateV2 | undefined;
  constructor(readonly registry: ModuleRegistryV2, readonly environment: ModuleEnvironment) {}
  prepare(profile: ModuleProfileV2, slots: readonly string[] = []): ModuleCandidateV2 { return this.registry.prepare(profile, this.environment, slots); }
  activate(candidate: ModuleCandidateV2): void {
    if (!candidate.available || !this.registry.preparedFor(candidate, this.environment)) throw new Error('Cannot activate an unprepared, foreign or disposed candidate');
    if (candidate === this.active) return; const old = this.active; this.active = candidate; old?.dispose();
  }
  dispose(): void { this.active?.dispose(); this.active = undefined; }
}
