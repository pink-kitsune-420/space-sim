import { moduleVehicleArtwork, rememberWorldArtwork } from './world-presentation';
import { universeSaveFormatService } from '../../../packages/game-library/src/universe-save-services';
import { progressConfiguration } from '../../../packages/game-library/src/progress-configuration';
import { DEFAULT_PROFILE } from '../../../packages/modules/src/index';
import { CORE_SESSION, type JoinOptions, type ManifestV2, type ModuleProfileV2 } from '../../../packages/game-api/src/index';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { GameTransition, type CandidateGame, type InstalledGamePlan } from '../../../packages/game-runtime/src/game-loader';
import { installPackage, type PackageStore } from '../../../packages/game-runtime/src/package-store';
import { previewModulesV2, removeModuleDependents } from '../../../packages/game-runtime/src/preview-v2';
import { ModuleResolutionError } from '../../../packages/game-runtime/src/resolver-v2';
import { satisfies } from '../../../packages/game-runtime/src/semver';
import { decodeModulePackage } from '../../../packages/game-library/src/portable';
import { runtimePackage, inspectRuntimePackage } from '../../../packages/game-library/src/runtime-package';
import { attachRuntimeFiles, installRuntimeSelection, validateRuntimeSelection, type RuntimeSelection } from '../../../packages/game-library/src/runtime-selection';
import { engineModuleServices } from '../../../packages/sim-core/src/module-services';
import { BrowserModuleHost, browserModuleAssets } from './module-host';
import { browserSessionFactory } from './module-session';
import { environment } from './startup';
import { message } from './ui';
import { prepareInstalledWorld, verifyInstalledWorldCandidate, type InstalledWorldOptions } from '../../../packages/modules/src/installed';
import {moduleLogs} from './module-logging';
import {createModMenu} from '../../../modules/mod-menu/src/index';
import type {ModMenuModuleView} from '../../../packages/game-api/src/index';

/** App adapter around the shared v2 loader. Shipped v1 systems remain enabled as before;
 * imported device modules are scoped to this game and applied only at an explicit restart. */
export class DeviceModuleManager {
  /** Borrow an explicitly selected optional platform/presentation service. Its
   * candidate owns its lifetime; hosts must release instances when it changes. */
  service<T>(key: import('../../../packages/game-api/src/index').ServiceKey<T>): T | undefined {
    const candidate = this.mixed;
    return candidate?.available && candidate.modules.lock.providers[key.slot] ? candidate.modules.providedService(key) : undefined;
  }
  readonly root = document.createElement('details');
  private readonly modMenu=createModMenu();
  private readonly editor:ModMenuModuleView;
  private readonly selected = new Map<string, string>();
  private readonly providers: Record<string, string> = Object.create(null);
  private readonly capabilities: Record<string, Record<string, string>> = Object.create(null);
  private readonly settings: Record<string, Record<string, number>> = Object.create(null);
  private readonly catalog = new Map<string, { manifest: ManifestV2; digest: string }>();
  private readonly transition = new GameTransition();
  private generation = 0;
  private host: BrowserModuleHost | undefined;
  private activePlan: InstalledGamePlan | undefined;
  private activeSelection: RuntimeSelection | undefined;
  private mixed: CandidateGame | undefined;
  private busy = false;
  constructor(private readonly store: PackageStore, private readonly options: {
    readonly pilots: import('../../../packages/game-api/src/index').PilotRegistry; readonly editable: () => boolean; readonly world: () => object;
    readonly base: () => { profile: ModuleProfileV2; applied: ModuleProfileV2; manifests: ReadonlyMap<string, ManifestV2> };
    readonly editBase: (profile: ModuleProfileV2) => void;
    readonly apply: (selection: RuntimeSelection,signal?:AbortSignal) => Promise<void>;
  }) {
    this.root.className='device-module-settings';
    this.editor=this.modMenu.modules(this.root,{
      state:()=>({installed:[...this.catalog.values()],selected:Object.fromEntries(this.selected),providers:this.providers,capabilities:this.capabilities,settings:this.settings,activeDigests:this.mixed?.identity.packages.map(ref=>ref.digest)??[],editable:this.options.editable(),busy:this.busy}),
      compatible:need=>[...this.catalog.values()].filter(provider=>provider.manifest.provides.some(capability=>capability.name===need.name&&satisfies(capability.version,need.version))),
      select:(id,digest)=>{if(digest)this.selected.set(id,digest);else this.selected.delete(id);this.preview();},
      version:(id,digest)=>{delete this.settings[id];if(this.selected.has(id))this.selected.set(id,digest);this.preview();},
      setting:(id,key,value)=>{(this.settings[id]??={})[key]=value;this.preview();},
      capability:(id,name,digest)=>{if(!digest)delete(this.capabilities[id]??={})[name];else{const chosen=this.catalog.get(digest);if(!chosen)throw new Error('This provider is no longer installed');this.selected.set(chosen.manifest.id,digest);(this.capabilities[id]??={})[name]=chosen.manifest.id;}this.preview();},
      provider:(slot,id,digest)=>{this.providers[slot]=id;this.selected.set(id,digest);this.preview();},
      includeRequired:()=>{this.preview(true);},removeDependents:()=>{this.preview(false,true);},cancel:()=>this.transition.cancel(),apply:signal=>this.activate(signal),
      remove:async(digest,signal)=>{signal.throwIfAborted();if(this.mixed?.identity.packages.some(ref=>ref.digest===digest))throw new Error('Disable this version before removing it');const entry=this.catalog.get(digest);await this.store.remove(digest);signal.throwIfAborted();if(entry&&this.selected.get(entry.manifest.id)===digest)this.selected.delete(entry.manifest.id);await this.refresh();}
    },{prefix:'device-module',title:'Device and network modules',notice:'Code modules have full access to this game, saved data, input and the network. Enable code only from people you trust. Applying starts a new world.',applyLabel:'Apply device modules and restart',ids:{list:'device-module-list',status:'device-module-status',apply:'apply-device-modules',cancel:'cancel-device-modules'}});
  }
  async refresh(): Promise<void> {
    this.catalog.clear();
    for (const entry of await this.store.list()) {
      const stored = await this.store.get(entry.digest); if (!stored) continue;
      try {
        const checked = await decodeModulePackage(Uint8Array.from(stored.bytes));
        if (checked.integrity.digest === entry.digest && checked.descriptor.manifest.format === 'space-sim-module/2') this.catalog.set(entry.digest, { manifest: checked.descriptor.manifest, digest: entry.digest });
      } catch { /* Invalid storage never becomes an executable selection. */ }
    }
    this.draw();
  }
  async install(bytes: Uint8Array, source: string): Promise<void> {
    await installPackage(bytes, this.store, inspectRuntimePackage, { source, installedAt: new Date().toISOString() },
      { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE });
    await this.refresh(); this.editor.status('Installed on this device. Code has not run. Select modules, review dependencies and apply to enable them.');
    this.root.open = true;
  }
  private draw(): void {this.editor.refresh();}
  private profile(): ModuleProfileV2 {
    return { format: 'space-sim-profile/2', id: this.activePlan?.profile.id ?? 'local.device-modules', modules: [...this.selected].map(([id, digest]) => ({ id, version: this.catalog.get(digest)!.manifest.version })),
      providers: Object.fromEntries(Object.entries(this.providers).filter(([, id]) => this.selected.has(id))),
      capabilities: Object.fromEntries(Object.entries(this.capabilities).filter(([id]) => this.selected.has(id))),
      settings: Object.fromEntries(Object.entries(this.settings).filter(([id]) => this.selected.has(id))) };
  }
  private manifests(): ReadonlyMap<string, ManifestV2> {
    const manifests = new Map<string, ManifestV2>(this.options.base().manifests);
    for (const entry of this.catalog.values()) if (!manifests.has(entry.manifest.id) || this.selected.get(entry.manifest.id) === entry.digest) manifests.set(entry.manifest.id, entry.manifest);
    return manifests;
  }
  private services(host: BrowserModuleHost) {
    return [universeSaveFormatService, ...engineModuleServices(), ...host.hostServices(), { key: CORE_SESSION, service: browserSessionFactory,
      tiers: ['platform', 'network'] as const, environments: ['browser', 'offline'] as const }];
  }
  /** Shared full-game metadata preview, including the legacy authority/viewer profile. */
  preview(includeDependencies = false, removeDependents = false, announce = true): string {
    let text = '';
    const host = new BrowserModuleHost(() => {}, this.options.pilots);
    try {
      const base = this.options.base(), device = this.profile();
      const combined: ModuleProfileV2 = { ...device, modules: [...base.profile.modules, ...device.modules],
        providers: { ...base.profile.providers, ...device.providers }, settings: { ...base.profile.settings, ...device.settings },
        capabilities: { ...base.profile.capabilities, ...device.capabilities } };
      const manifests = this.manifests();
      const applied = this.activePlan?.profile;
      const currentProfile = { ...base.applied, modules: [...base.applied.modules, ...applied?.modules ?? []],
        providers: { ...base.applied.providers, ...applied?.providers }, settings: { ...base.applied.settings, ...applied?.settings },
        capabilities: applied?.capabilities ?? {} };
      const currentManifests = new Map(manifests);
      for (const manifest of this.mixed?.identity.manifests ?? []) currentManifests.set(manifest.id, manifest);
      const current = previewModulesV2(currentManifests, currentProfile, undefined, environment(), { hostServices: this.services(host) }).lock;
      let proposed = combined;
      if (removeDependents) proposed = removeModuleDependents(manifests, proposed, current);
      const preview = previewModulesV2(manifests, proposed, current, environment(),
        { includeDependencies, requiredSlots: ['motion', 'content', 'renderer'], hostServices: this.services(host) });
      if (includeDependencies || removeDependents) {
        this.options.editBase({ ...preview.profile, modules: preview.profile.modules.filter(ref => base.manifests.has(ref.id)) });
        this.selected.clear();
        for (const ref of preview.profile.modules) if (!base.manifests.has(ref.id)) {
          const entry = [...this.catalog.values()].find(entry => entry.manifest.id === ref.id && entry.manifest.version === ref.version);
          if (entry) this.selected.set(ref.id, entry.digest);
        }
      }
      text = `New world required. Enable: ${preview.added.join(', ') || 'none'}. Remove: ${preview.removed.join(', ') || 'none'}. Replace: ${[...new Set([...preview.replaced, ...[...this.selected].filter(([id, digest]) => this.activePlan?.packages.some(ref => ref.id === id && ref.digest !== digest)).map(([id]) => id)])].join(', ') || 'none'}. Provider changes: ${preview.providerChanges.join(', ') || 'none'}. Dependency order: ${preview.lock.order.join(' → ') || 'none'}. Dependencies: ${preview.dependencies.map(d => `${d.requester} → ${d.provider} (${d.reason})`).join('; ') || 'none'}.`;
    } catch (error) {
      text = error instanceof ModuleResolutionError
        ? `${error.message} ${error.diagnostic.actions.join(' ')}${error.diagnostic.candidates.length ? ` Available: ${error.diagnostic.candidates.map(c => `${c.name} (${c.id}@${c.version})`).join(', ')}.` : ''}` : message(error);
    } finally { host.dispose(); }
    if (announce) this.editor.status(text);
    return text;
  }
  /** Capture pending exact edits only for an explicit Apply action. */
  async proposal(): Promise<RuntimeSelection | undefined> {
    if (!this.activePlan && !this.selected.size) return undefined;
    const plan: InstalledGamePlan = { profile: this.profile(), packages: [...this.selected].map(([id, digest]) => ({ id, digest, version: this.catalog.get(digest)!.manifest.version })), requiredSlots: this.activePlan?.requiredSlots ?? [] };
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    const plans = { ...this.activeSelection?.plans, [environment()]: plan };
    // Apply the same edit to another target only when its previous exact plan matched.
    // Distinct target configurations remain explicit and unchanged.
    for (const target of ['browser', 'offline', 'node'] as const) {
      if (target === environment()) continue;
      const previous = this.activeSelection?.plans[target];
      if ((!previous && target !== 'node' || previous && JSON.stringify(previous) === JSON.stringify(this.activePlan))
        && plan.packages.every(ref => this.catalog.get(ref.digest)!.manifest.environments.includes(target))) plans[target] = plan;
    }
    if (!plans.node) plans.node = { profile: { ...plan.profile, modules: [], providers: {}, capabilities: {}, settings: {} }, packages: [], requiredSlots: [] };
    for (const target of Object.values(plans)) for (const ref of target.packages) {
      const stored = await this.store.get(ref.digest);
      if (!stored) throw new Error(`Install exact package ${ref.id}@${ref.version} (${ref.digest}) before applying`);
      files.set(`modules/${ref.id}.spacemod`, Uint8Array.from(stored.bytes));
    }
    return attachRuntimeFiles(validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans }), files);
  }
  private async activate(signal?:AbortSignal): Promise<void> {
    if (this.busy || !this.options.editable()) return;
    try {
      signal?.throwIfAborted();const selection = await this.proposal();signal?.throwIfAborted();
      if (selection) await this.options.apply(selection,signal);
    } catch (error) { this.editor.status(`Modules were not enabled: ${message(error)}`); }
  }
  /** Capture the committed selection, rather than unchecked edits in the manager. */
  async capture(): Promise<RuntimeSelection | undefined> { if (this.mixed && !this.mixed.available) this.clear(); return this.activeSelection; }
  loadLegacyGame(publish: () => void): void {
    this.transition.cancel(); publish(); this.clear();
  }
  /** Prepare simulation and device hooks together, before publishing either host's game. */
  async loadWorldGame(selection: RuntimeSelection, options: Omit<InstalledWorldOptions, 'hostServices' | 'inspect' | 'configure' | 'dispose'> & { readonly install?: () => Promise<void> },
    publish: (prepared: Awaited<ReturnType<typeof prepareInstalledWorld>>) => void,signal?:AbortSignal): Promise<void> {
    const generation = ++this.generation;
    const previousWorld = this.options.world(), previousHost = this.host;
    this.busy = true; this.draw();
    const host = new BrowserModuleHost(error => { this.editor.status(error); }, this.options.pilots);
    let prepared: Awaited<ReturnType<typeof prepareInstalledWorld>> | undefined;
    try {
      let plan!: InstalledGamePlan;
      await this.transition.replace(async signal => {
      signal.throwIfAborted();
      await options.install?.();
      signal.throwIfAborted();
      plan = await installRuntimeSelection(selection, this.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, 'Game library');
      signal.throwIfAborted();
      await this.refresh();
      signal.throwIfAborted();
      prepared = await prepareInstalledWorld(plan, this.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE,
        approvedDigests: new Set(plan.packages.map(ref => ref.digest)) }, { ...options,logs:options.logs??moduleLogs,configuration: options.configuration ?? progressConfiguration(options.profile ?? DEFAULT_PROFILE, options.data ?? [], options.code ?? [], selection), hostServices: this.services(host),
        inspect: async bytes => runtimePackage(await decodeModulePackage(Uint8Array.from(bytes)), browserModuleAssets),
        configure(modules) {
          host.configure(modules);
        },
        dispose: () => host.dispose(),
      }, signal);
      rememberWorldArtwork(prepared.loaded.world, moduleVehicleArtwork(prepared.candidate.modules));
      return prepared.candidate;
      }, () => {
      if (!prepared) throw new Error('Game candidate was not prepared');
      if (this.options.world() !== previousWorld || !this.options.editable()) throw new Error('The active session changed while loading');
      host.activate(document.querySelector<HTMLElement>('#flight-console .viewport') ?? this.root); publish(prepared); host.commit();
      const previousMixed = this.mixed;
      this.mixed = prepared.candidate; this.host = host; this.activePlan = plan; this.activeSelection = selection;
      this.selected.clear(); for (const ref of plan.packages) this.selected.set(ref.id, ref.digest);
      for (const record of [this.providers, this.capabilities, this.settings]) for (const key of Object.keys(record)) delete record[key];
      Object.assign(this.providers, plan.profile.providers);
      for (const [id, choices] of Object.entries(plan.profile.capabilities)) this.capabilities[id] = { ...choices };
      for (const [id, values] of Object.entries(plan.profile.settings)) this.settings[id] = { ...values };
      previousMixed?.dispose(); previousHost?.dispose();
      this.editor.status('Game modules enabled for this game after restart. Save or export to keep the applied selection.');
      },signal);
    } catch (error) { prepared?.candidate.dispose(); host.dispose(); throw error; }
    finally { if (this.generation === generation) { this.busy = false; this.draw(); } }
  }
  sample(elapsed: number, flightAllowed: boolean, shortcutsAllowed: boolean): void {
    if (this.mixed && !this.mixed.available) this.clear();
    this.host?.sample(elapsed, flightAllowed, shortcutsAllowed);
  }
  release(pilot?: number): void { this.host?.release(pilot); }
  verifyCandidate(candidate: Parameters<NonNullable<JoinOptions['verifyCandidate']>>[0]) {
    return this.mixed ? verifyInstalledWorldCandidate(this.mixed, candidate) : { ok: false, reason: 'Load the exact game before joining this server.' };
  }
  clear(): void {
    ++this.generation; this.busy = false; this.transition.cancel(); this.mixed?.dispose(); this.host?.dispose(); this.mixed = undefined;
    this.host = undefined; this.activePlan = undefined; this.activeSelection = undefined; this.selected.clear();
    for (const record of [this.providers, this.capabilities, this.settings]) for (const key of Object.keys(record)) delete record[key];
    this.editor.status('Device modules are disabled for this game. Installed files remain on this device.'); this.draw();
  }
}
