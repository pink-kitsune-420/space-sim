import type { CameraExtension, CameraHook, CommandExtension, CommandHook, Disposable, ForceExtension, ForceHook, LayerExtension, LayerHook,
  PanelExtension, PanelHook, PresentationContribution, WorldRuleExtension, WorldRuleHook, ModuleEnvironment, ModuleLock, ModuleManifest,
  ModuleProfile, ModuleReference, RegisteredModule } from '../../game-api/src/index';
import { freezeJson, settingValue, validateManifest, validateProfile } from './validation';
import { MAX_COMMANDS_PER_MODULE, captureCommand } from './commands';
import { MAX_PRESENTATION_HOOKS_PER_MODULE, capturePresentation } from './presentation';
import { type StateMigrationFn } from './authoritative';
import { validateModuleState } from './motion';
import type { ModuleState } from '../../game-api/src/index';
import { satisfies } from './semver';
export { validateManifest, validateProfile } from './validation';
export { compareVersions, parseVersion, satisfies, validRange } from './semver';
export * from './authoritative';
export * from './artifact';
export * from './commands';
export * from './presentation';

/** Static registration only. Installed modules have no effect until selected in a profile. */
export class ModuleRegistry {
  private readonly modules = new Map<string, RegisteredModule>();
  private readonly prepared = new WeakMap<ModuleCandidate, ModuleEnvironment>();
  getManifest(id: string): ModuleManifest | undefined { return this.modules.get(id)?.manifest; }
  get manifests(): ReadonlyMap<string, ModuleManifest> {
    return new Map([...this.modules.entries()].map(([id, m]) => [id, m.manifest]));
  }
  /** `modules` plus every transitive dependency at its installed version, which must satisfy
   * each declaring range, sorted by ID. Use it to enable a module together with what it needs. */
  closure(modules: readonly ModuleReference[]): ModuleReference[] {
    const out = new Map<string, string>();
    const visit = (id: string, range: string, from?: string): void => {
      const manifest = this.modules.get(id)?.manifest;
      if (!manifest) throw new Error(from ? `Module ${from}: missing dependency ${id}@${range}` : `Module ${id}: not installed`);
      if (!satisfies(manifest.version, range)) throw new Error(from
        ? `Module ${from}: dependency ${id}@${range} is not satisfied by installed version ${manifest.version}`
        : `Module ${id}: requires exact version ${range}; installed ${manifest.version}`);
      if (out.has(id)) return;
      out.set(id, manifest.version);
      for (const dependency of manifest.dependencies) visit(dependency.id, dependency.version, id);
    };
    for (const module of modules) visit(module.id, module.version);
    return [...out].sort(([a], [b]) => a.localeCompare(b)).map(([id, version]) => ({ id, version }));
  }
  register(module: RegisteredModule): void {
    const manifest = validateManifest(module.manifest);
    if (this.modules.has(manifest.id)) throw new Error(`Module ${manifest.id}: duplicate registration`);
    this.modules.set(manifest.id, { manifest, initialize: module.initialize, contentDigest: module.contentDigest, supportsMultiplayer: module.supportsMultiplayer });
  }
  /** Installation registry only; dispose active candidates before removing their modules. */
  unregister(id: string): void { this.modules.delete(id); }
  resolve(raw: unknown, environment: ModuleEnvironment, requiredSlots: readonly string[] = []): ModuleLock {
    const profile = validateProfile(raw);
    const selected = new Map(profile.modules.map(ref => {
      const module = this.modules.get(ref.id);
      if (!module) throw new Error(`Module ${ref.id}: not installed`);
      if (module.manifest.version !== ref.version) throw new Error(`Module ${ref.id}: requires exact version ${ref.version}; installed ${module.manifest.version}`);
      if (!module.manifest.environments.includes(environment)) throw new Error(`Module ${ref.id}: unsupported environment ${environment}`);
      return [ref.id, module] as const;
    }));
    const edges = new Map([...selected.keys()].map(id => [id, new Set<string>()]));
    const slots = new Map<string, string[]>();
    const settings: Record<string, Record<string, number>> = Object.create(null);
    for (const [id, { manifest: m }] of selected) {
      for (const dep of m.dependencies) {
        const target = selected.get(dep.id)?.manifest;
        if (!target) throw new Error(`Module ${id}: missing dependency ${dep.id}@${dep.version}`);
        if (!satisfies(target.version, dep.version)) throw new Error(`Module ${id}: dependency ${dep.id}@${dep.version} is not satisfied by enabled version ${target.version}`);
        // A presentation module never enters the authoritative lock, so authority cannot rely on one.
        if (m.authority === 'authoritative' && target.authority === 'presentation') throw new Error(`Module ${id}: authoritative modules cannot depend on presentation module ${dep.id}`);
        edges.get(dep.id)!.add(id);
      }
      for (const conflict of m.conflicts ?? []) {
        const other = selected.get(conflict.id)?.manifest;
        if (other && satisfies(other.version, conflict.version)) throw new Error(`Module ${id}: conflicts with ${conflict.id}@${other.version}`);
      }
      for (const target of m.before) {
        if (!selected.has(target)) throw new Error(`Module ${id}: before target ${target} is not enabled`);
        edges.get(id)!.add(target);
      }
      for (const target of m.after) {
        if (!selected.has(target)) throw new Error(`Module ${id}: after target ${target} is not enabled`);
        edges.get(target)!.add(id);
      }
      for (const slot of m.slots) slots.set(slot, [...(slots.get(slot) ?? []), id]);
      settings[id] = Object.create(null) as Record<string, number>;
      for (const key of Object.keys(profile.settings[id] ?? {})) if (!Object.hasOwn(m.settings, key)) throw new Error(`Module ${id} setting ${key}: unknown setting`);
      for (const [key, schema] of Object.entries(m.settings)) {
        const overrides = profile.settings[id] ?? {};
        const value = Object.hasOwn(overrides, key) ? overrides[key]! : schema.default;
        if (value < schema.minimum || value > schema.maximum) throw new Error(`Module ${id} setting ${key}: must be in [${schema.minimum}, ${schema.maximum}]`);
        if(!settingValue(value,schema))throw new Error(`Module ${id} setting ${key}: must follow increment ${schema.step}`);
        settings[id]![key] = value;
      }
    }
    for (const id of Object.keys(profile.settings)) if (!selected.has(id)) throw new Error(`Module ${id}: settings for a disabled module`);
    const providers: Record<string, string> = Object.create(null);
    for (const slot of requiredSlots) if (!slots.has(slot)) throw new Error(`Provider ${slot}: missing required provider`);
    for (const [slot, candidates] of slots) {
      const choice = Object.hasOwn(profile.providers, slot) ? profile.providers[slot] : (candidates.length === 1 ? candidates[0] : undefined);
      if (!choice) throw new Error(`Provider ${slot}: select one of ${candidates.sort().join(', ')}`);
      if (!candidates.includes(choice)) throw new Error(`Provider ${slot}: ${choice} does not provide this slot`);
      providers[slot] = choice;
    }
    for (const slot of Object.keys(profile.providers)) if (!slots.has(slot)) throw new Error(`Provider ${slot}: unknown slot`);
    const active = [...selected.values()].filter(m => m.manifest.kind === 'data'
      || !m.manifest.slots.length || Object.values(providers).includes(m.manifest.id));
    const capabilities = new Set(active.flatMap(m => [...m.manifest.provides]));
    for (const { manifest: m } of active) for (const cap of m.requires) {
      if (!capabilities.has(cap)) throw new Error(`Module ${m.id}: missing capability ${cap}`);
    }
    const incoming = new Map([...selected.keys()].map(id => [id, 0]));
    for (const targets of edges.values()) for (const id of targets) incoming.set(id, incoming.get(id)! + 1);
    const order: string[] = [];
    while (order.length < selected.size) {
      const next = [...incoming.keys()].filter(id => incoming.get(id) === 0).sort()[0];
      if (!next) throw new Error(`Profile ${profile.id}: dependency/ordering cycle`);
      order.push(next); incoming.delete(next);
      for (const target of edges.get(next)!) incoming.set(target, incoming.get(target)! - 1);
    }
    return freezeJson({ format: 'space-sim-lock/1', profileId: profile.id,
      modules: order.map(id => ({ id, version: selected.get(id)!.manifest.version })), order, providers, settings });
  }
  prepare(profile: ModuleProfile, environment: ModuleEnvironment, requiredSlots: readonly string[] = []): ModuleCandidate {
    const candidate = new ModuleCandidate(this.resolve(profile, environment, requiredSlots));
    try {
      for (const id of candidate.lock.order) {
        const module = this.modules.get(id)!;
        if (module.manifest.slots.length && !Object.values(candidate.lock.providers).includes(id)) continue;
        const presentation = (kind: 'layer' | 'panel' | 'camera', hook: LayerHook | PanelHook | CameraHook): void => {
          if (module.manifest.authority !== 'presentation') throw new Error(`Module ${id}: ${kind} hooks require presentation scope`);
          candidate.contributePresentation(kind, id, module.manifest.version, hook);
        };
        try {
          const result: unknown = module.initialize({ settings: candidate.lock.settings[id]!, assets: Object.freeze({}),
            migrateState: (fromVersion, migrate) => candidate.addMigration(id, fromVersion, migrate), own: resource => candidate.own(resource),
            contributeWorldRule: hook => {
              if (module.manifest.authority !== 'authoritative') throw new Error(`Module ${id}: world rules require authoritative scope`);
              candidate.contributeWorldRule(id, module.manifest.version, hook);
            },
            contributeForce: hook => {
              if (module.manifest.authority !== 'authoritative') throw new Error(`Module ${id}: force hooks require authoritative scope`);
              candidate.contributeForce(id, module.manifest.version, hook);
            },
            contributeCommand: hook => {
              if (module.manifest.authority !== 'authoritative') throw new Error(`Module ${id}: commands require authoritative scope`);
              candidate.contributeCommand(id, module.manifest.version, hook);
            },
            contributeLayer: hook => presentation('layer', hook),
            contributePanel: hook => presentation('panel', hook),
            contributeCamera: hook => presentation('camera', hook),
            expose: api => candidate.expose(id, api),
            dependency: <T extends object>(target: string): T => {
              if (!module.manifest.dependencies.some(d => d.id === target)) throw new Error(`Module ${id}: ${target} is not a declared dependency`);
              return candidate.exposed<T>(target);
            },
            selected: slot => candidate.lock.providers[slot] === id,
            provide: (slot, service) => {
              if (candidate.lock.providers[slot] !== id) throw new Error(`Module ${id}: not selected for provider ${slot}`);
              candidate.provide(slot, service);
            } });
          if (result && typeof (result as PromiseLike<unknown>).then === 'function') throw new Error('asynchronous initialization is unsupported in this API version');
        } catch (error) { throw new Error(`Module ${id} initialization: ${(error as Error).message}`, { cause: error }); }
      }
      for (const slot of Object.keys(candidate.lock.providers)) candidate.service(slot);
      candidate.seal();
      this.prepared.set(candidate, environment);
      return candidate;
    } catch (error) {
      candidate.dispose();
      throw error;
    }
  }
  preparedFor(candidate: ModuleCandidate, environment: ModuleEnvironment): boolean { return this.prepared.get(candidate) === environment; }
}
export class ModuleCandidate implements Disposable {
  private readonly resources: Disposable[] = [];
  private readonly services = new Map<string, unknown>();
  private disposed = false;
  private sealed = false;
  private readonly forces: ForceExtension[] = [];
  private readonly rules: WorldRuleExtension[] = [];
  private readonly commandList: CommandExtension[] = [];
  private readonly presentationHooks = { layer: [] as LayerExtension[], panel: [] as PanelExtension[], camera: [] as CameraExtension[] };
  /** APIs modules exposed for their dependents, by module ID. */
  private readonly apis = new Map<string, object>();
  expose(moduleId: string, api: object): void {
    if (this.disposed || this.sealed || this.apis.has(moduleId)) throw new Error(`Module ${moduleId}: duplicate or late API`);
    if (!api || (typeof api !== 'object' && typeof api !== 'function')) throw new Error(`Module ${moduleId}: an API must be an object`);
    this.apis.set(moduleId, Object.freeze(api));
  }
  exposed<T extends object>(moduleId: string): T {
    const api = this.apis.get(moduleId);
    if (!api) throw new Error(`Dependency ${moduleId} exposes no API (it is not initialized or not selected)`);
    return api as T;
  }
  /** Authoritative commands in resolved module order, then registration order. */
  get commands(): readonly CommandExtension[] { return Object.freeze([...this.commandList]); }
  get layers(): readonly LayerExtension[] { return Object.freeze([...this.presentationHooks.layer]); }
  get panels(): readonly PanelExtension[] { return Object.freeze([...this.presentationHooks.panel]); }
  get cameras(): readonly CameraExtension[] { return Object.freeze([...this.presentationHooks.camera]); }
  contributeCommand(moduleId: string, version: string, hook: CommandHook): void {
    if (this.disposed || this.sealed) throw new Error(`Module ${moduleId}: late command registration`);
    if (this.commandList.filter(c => c.moduleId === moduleId).length >= MAX_COMMANDS_PER_MODULE) throw new Error(`Module ${moduleId}: at most ${MAX_COMMANDS_PER_MODULE} commands`);
    const command = captureCommand(moduleId, version, hook);
    if (this.commandList.some(c => c.id === command.id)) throw new Error(`Command ${command.id}: duplicate registration`);
    const bound = command.hook.key ? this.commandList.find(c => c.hook.key === command.hook.key) : undefined;
    if (bound) throw new Error(`Command ${command.id}: key ${command.hook.key} is already bound to ${bound.id}`);
    this.commandList.push(command);
  }
  contributePresentation(kind: 'layer' | 'panel' | 'camera', moduleId: string, version: string, hook: LayerHook | PanelHook | CameraHook): void {
    if (this.disposed || this.sealed) throw new Error(`Module ${moduleId}: late ${kind} registration`);
    const list = this.presentationHooks[kind] as PresentationContribution<LayerHook | PanelHook | CameraHook>[];
    if (list.filter(h => h.moduleId === moduleId).length >= MAX_PRESENTATION_HOOKS_PER_MODULE) throw new Error(`Module ${moduleId}: at most ${MAX_PRESENTATION_HOOKS_PER_MODULE} ${kind} hooks`);
    const contribution = capturePresentation(kind, moduleId, version, hook);
    if (list.some(h => h.id === contribution.id)) throw new Error(`${kind} ${contribution.id}: duplicate registration`);
    list.push(contribution);
  }
  private readonly migrations = new Map<string, StateMigrationFn>();
  addMigration(id: string, from: number, fn: StateMigrationFn): void {
    const key = `${id}@${from}`;
    if (this.sealed || this.migrations.size >= 256 || !Number.isSafeInteger(from) || from < 1 || typeof fn !== 'function' || this.migrations.has(key)) throw new Error(`Module ${id}: invalid or duplicate migration`);
    this.migrations.set(key, fn);
  }
  migrateState = (id: string, state: ModuleState, target: number): ModuleState => {
    if (this.disposed) throw new Error('Module candidate is disposed');
    let current = state;
    while (current.version < target) {
      const fn = this.migrations.get(`${id}@${current.version}`);
      if (!fn) throw new Error(`Module ${id}: missing migration from version ${current.version} to ${current.version + 1}`);
      current = validateModuleState({ version: current.version + 1, value: fn(structuredClone(current.value)) });
    }
    if (current.version !== target) throw new Error(`Module ${id}: unsupported state version ${current.version}`);
    return current;
  };
  get worldRules(): readonly WorldRuleExtension[] { return Object.freeze([...this.rules]); }
  contributeWorldRule(moduleId: string, version: string, hook: WorldRuleHook): void {
    if (this.disposed || this.sealed || this.rules.some(f => f.moduleId === moduleId)) throw new Error(`Module ${moduleId}: duplicate or late rule registration`);
    this.rules.push(Object.freeze({ moduleId, version, hook: Object.freeze({ ...hook }) }));
  }
  get forceExtensions(): readonly ForceExtension[] { return Object.freeze([...this.forces]); }
  contributeForce(moduleId: string, version: string, hook: ForceHook): void {
    if (this.disposed || this.sealed || this.forces.some(f => f.moduleId === moduleId)) throw new Error(`Module ${moduleId}: duplicate or late force registration`);
    this.forces.push(Object.freeze({ moduleId, version, hook: Object.freeze({ ...hook }) }));
  }
  seal(): void { this.sealed = true; }
  /** Disposal failures are recorded after every resource has been given a chance to close. */
  readonly disposalErrors: unknown[] = [];
  constructor(readonly lock: ModuleLock) {}
  own<T extends Disposable>(resource: T): T {
    if (this.disposed) { resource.dispose(); throw new Error('Module candidate is disposed'); }
    this.resources.push(resource); return resource;
  }
  provide(slot: string, service: unknown): void {
    if (this.disposed || this.services.has(slot) || service === undefined) throw new Error(`Provider ${slot}: duplicate, missing or disposed service`);
    this.services.set(slot, service);
  }
  service<T>(slot: string): T {
    if (this.disposed || !this.services.has(slot)) throw new Error(`Provider ${slot}: unavailable`);
    return this.services.get(slot) as T;
  }
  get available(): boolean { return !this.disposed; }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const resource of this.resources.reverse()) {
      try { resource.dispose(); } catch (error) { this.disposalErrors.push(error); }
    }
    this.resources.length = 0; this.services.clear(); this.forces.length = 0; this.rules.length = 0; this.commandList.length = 0;
    this.apis.clear(); this.migrations.clear();
    for (const list of Object.values(this.presentationHooks)) list.length = 0;
  }
}
/** Call prepare, construct/own the candidate world, then activate. Failures leave active intact. */
export class ModuleRuntime implements Disposable {
  active: ModuleCandidate | undefined;
  constructor(readonly registry: ModuleRegistry, readonly environment: ModuleEnvironment) {}
  prepare(profile: ModuleProfile, slots: readonly string[] = []): ModuleCandidate { return this.registry.prepare(profile, this.environment, slots); }
  activate(candidate: ModuleCandidate): void {
    if (!candidate.available || !this.registry.preparedFor(candidate, this.environment)) throw new Error('Cannot activate an unprepared, foreign or disposed candidate');
    if (candidate === this.active) return;
    const previous = this.active;
    this.active = candidate;
    previous?.dispose();
  }
  dispose(): void { this.active?.dispose(); this.active = undefined; }
}
export * from './validation-v2';
export * from './resolver-v2';
export * from './modules-v2';
export * from './loader';
