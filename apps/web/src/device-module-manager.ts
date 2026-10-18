import { CORE_SESSION, type JoinOptions, type ManifestV2, type ModuleProfileV2 } from '../../../packages/game-api/src/index';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import { InstalledGameRuntime, type CandidateGame, type InstalledGamePlan } from '../../../packages/game-runtime/src/game-loader';
import { installPackage, type PackageStore } from '../../../packages/game-runtime/src/package-store';
import { previewModulesV2 } from '../../../packages/game-runtime/src/preview-v2';
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

/** App adapter around the shared v2 loader. Shipped v1 systems remain enabled as before;
 * imported device modules are scoped to this game and applied only at an explicit restart. */
export class DeviceModuleManager {
  readonly root = document.createElement('details');
  private readonly list = document.createElement('ul');
  private readonly status = document.createElement('p');
  private readonly apply = document.createElement('button');
  private readonly selected = new Map<string, string>();
  private readonly providers: Record<string, string> = Object.create(null);
  private readonly capabilities: Record<string, Record<string, string>> = Object.create(null);
  private readonly settings: Record<string, Record<string, number>> = Object.create(null);
  private readonly catalog = new Map<string, { manifest: ManifestV2; digest: string }>();
  private runtime: InstalledGameRuntime | undefined;
  private host: BrowserModuleHost | undefined;
  private activePlan: InstalledGamePlan | undefined;
  private activeSelection: RuntimeSelection | undefined;
  private mixed: CandidateGame | undefined;
  private busy = false;
  constructor(private readonly store: PackageStore, private readonly options: {
    readonly editable: () => boolean; readonly restart: () => void; readonly world: () => object; readonly activeLegacyIds: () => ReadonlySet<string>;
  }) {
    this.root.className = 'device-module-settings';
    const summary = document.createElement('summary'); summary.textContent = 'Device and network modules';
    const warning = document.createElement('p'); warning.textContent = 'Code modules have full access to this game, saved data, input and the network. Enable code only from people you trust. Applying starts a new world.';
    this.status.setAttribute('role', 'status'); this.status.id = 'device-module-status'; this.list.id = 'device-module-list';
    this.apply.type = 'button'; this.apply.textContent = 'Apply device modules and restart'; this.apply.id = 'apply-device-modules';
    this.apply.onclick = () => { void this.activate(); };
    const dependencies = document.createElement('button'); dependencies.type = 'button'; dependencies.textContent = 'Include required modules';
    dependencies.onclick = () => { this.preview(true); this.draw(); };
    this.root.append(summary, warning, this.list, dependencies, this.apply, this.status);
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
    await this.refresh(); this.status.textContent = 'Installed on this device. Code has not run. Select modules, review dependencies and apply to enable them.';
    this.root.open = true;
  }
  private draw(): void {
    const grouped = new Map<string, { manifest: ManifestV2; digest: string }[]>();
    for (const entry of this.catalog.values()) grouped.set(entry.manifest.id, [...grouped.get(entry.manifest.id) ?? [], entry]);
    this.list.replaceChildren(...[...grouped].map(([id, entries]) => {
      const item = document.createElement('li'), label = document.createElement('label'), checkbox = document.createElement('input'), versions = document.createElement('select');
      checkbox.type = 'checkbox'; checkbox.dataset.moduleId = id; checkbox.checked = this.selected.has(id);
      versions.setAttribute('aria-label', `Version of ${id}`);
      for (const entry of entries) { const option = document.createElement('option'); option.value = entry.digest; option.textContent = `${entry.manifest.version} · SHA-256 ${entry.digest}`; versions.append(option); }
      versions.value = this.selected.get(id) ?? entries[0]!.digest;
      checkbox.disabled = versions.disabled = this.busy || !!this.mixed || !this.options.editable();
      checkbox.onchange = () => { if (checkbox.checked) this.selected.set(id, versions.value); else this.selected.delete(id); this.preview(); };
      versions.onchange = () => { delete this.settings[id]; if (checkbox.checked) this.selected.set(id, versions.value); this.draw(); this.preview(); };
      const entry = entries.find(e => e.digest === versions.value)!;
      label.append(checkbox, ` ${entry.manifest.name} · ${entry.manifest.tier}`); item.append(label, versions);
      const needs = document.createElement('p'); needs.textContent = `Requires: ${[...entry.manifest.dependencies.map(d => `${d.id}@${d.version}`), ...entry.manifest.requires.map(c => `${c.name}@${c.version}${c.optional ? ' (optional)' : ''}`)].join(', ') || 'none'}.`; item.append(needs);
      for (const [key, schema] of Object.entries(entry.manifest.settings)) {
        const label = document.createElement('label'), input = document.createElement('input');
        input.type = 'number'; input.step = 'any'; input.min = String(schema.minimum); input.max = String(schema.maximum);
        input.value = String(this.settings[id]?.[key] ?? schema.default); input.disabled = checkbox.disabled;
        input.onchange = () => { (this.settings[id] ??= {})[key] = Number(input.value); this.preview(); };
        label.append(`${key} `, input); item.append(label);
      }
      for (const need of entry.manifest.requires.filter(need => !need.name.startsWith('core.'))) {
        const label = document.createElement('label'), select = document.createElement('select'), automatic = document.createElement('option');
        automatic.value = ''; automatic.textContent = 'Automatic among enabled modules'; select.append(automatic); select.disabled = checkbox.disabled;
        for (const provider of this.catalog.values()) if (provider.manifest.provides.some(capability => capability.name === need.name && satisfies(capability.version, need.version))) {
          const option = document.createElement('option'); option.value = provider.digest; option.textContent = `${provider.manifest.name}@${provider.manifest.version}`; select.append(option);
          if (this.capabilities[id]?.[need.name] === provider.manifest.id && this.selected.get(provider.manifest.id) === provider.digest) select.value = provider.digest;
        }
        select.onchange = () => {
          if (!select.value) delete (this.capabilities[id] ??= {})[need.name];
          else { const chosen = this.catalog.get(select.value)!; this.selected.set(chosen.manifest.id, chosen.digest); (this.capabilities[id] ??= {})[need.name] = chosen.manifest.id; }
          this.draw(); this.preview();
        };
        label.append(`Provider for ${need.name} `, select); item.append(label);
      }
      for (const slot of entry.manifest.slots) {
        const select = document.createElement('input'), label = document.createElement('label'); select.type = 'radio'; select.name = `device-provider-${slot}`;
        select.checked = this.providers[slot] === id; select.disabled = checkbox.disabled;
        select.onchange = () => { this.providers[slot] = id; this.selected.set(id, versions.value); this.draw(); this.preview(); };
        label.append(select, ` Use for ${slot}`); item.append(label);
      }
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove installed version';
      remove.disabled = this.busy || (this.runtime?.active ?? this.mixed)?.identity.packages.some(ref => ref.digest === versions.value) === true;
      remove.onclick = () => { void this.store.remove(versions.value).then(() => { if (this.selected.get(id) === versions.value) this.selected.delete(id); return this.refresh(); }).catch(error => { this.status.textContent = message(error); }); };
      item.append(remove); return item;
    }));
    this.apply.disabled = this.busy || !!this.mixed || !this.options.editable() || !this.catalog.size;
  }
  private profile(): ModuleProfileV2 {
    return { format: 'space-sim-profile/2', id: 'local.device-modules', modules: [...this.selected].map(([id, digest]) => ({ id, version: this.catalog.get(digest)!.manifest.version })),
      providers: Object.fromEntries(Object.entries(this.providers).filter(([, id]) => this.selected.has(id))),
      capabilities: Object.fromEntries(Object.entries(this.capabilities).filter(([id]) => this.selected.has(id))),
      settings: Object.fromEntries(Object.entries(this.settings).filter(([id]) => this.selected.has(id))) };
  }
  private manifests(): ReadonlyMap<string, ManifestV2> {
    const manifests = new Map<string, ManifestV2>();
    for (const entry of this.catalog.values()) if (!manifests.has(entry.manifest.id) || this.selected.get(entry.manifest.id) === entry.digest) manifests.set(entry.manifest.id, entry.manifest);
    return manifests;
  }
  private services(host: BrowserModuleHost) {
    return [...engineModuleServices(), ...host.hostServices(), { key: CORE_SESSION, service: browserSessionFactory,
      tiers: ['platform', 'network'] as const, environments: ['browser', 'offline'] as const }];
  }
  private preview(includeDependencies = false): void {
    const host = new BrowserModuleHost();
    try {
      const preview = previewModulesV2(this.manifests(), this.profile(), this.runtime?.active?.identity.lock, environment(), { includeDependencies, hostServices: this.services(host) });
      if (includeDependencies) for (const ref of preview.profile.modules) {
        if (!this.selected.has(ref.id)) {
          const entry = [...this.catalog.values()].find(entry => entry.manifest.id === ref.id && entry.manifest.version === ref.version)!;
          this.selected.set(ref.id, entry.digest);
        }
      }
      this.status.textContent = `New world required. Enable: ${preview.added.join(', ') || 'none'}. Remove: ${preview.removed.join(', ') || 'none'}. Dependency order: ${preview.lock.order.join(' → ') || 'none'}.`;
    } catch (error) {
      this.status.textContent = error instanceof ModuleResolutionError
        ? `${error.message} ${error.diagnostic.actions.join(' ')}${error.diagnostic.candidates.length ? ` Available: ${error.diagnostic.candidates.map(c => `${c.name} (${c.id}@${c.version})`).join(', ')}.` : ''}` : message(error);
    } finally { host.dispose(); }
  }
  private async activate(): Promise<void> {
    if (this.busy || !this.options.editable()) return;
    if (this.mixed) { this.status.textContent = 'This game uses a complete v2 selection. Load its game package to restart with all simulation and device modules.'; return; }
    this.busy = true; this.draw();
    const host = new BrowserModuleHost(error => { this.status.textContent = error; });
    const plan: InstalledGamePlan = { profile: this.profile(), packages: [...this.selected].map(([id, digest]) => ({ id, digest, version: this.catalog.get(digest)!.manifest.version })), requiredSlots: [] };
    try {
      for (const ref of plan.packages) if (this.options.activeLegacyIds().has(ref.id)) throw new Error(`Module ${ref.id} is already active in the legacy game profile. Disable it there before choosing another version.`);
      await this.replace(plan, () => this.options.restart(), host);
      this.status.textContent = 'Device modules enabled for this game after restart. Installed versions in other games remain disabled.';
    } catch (error) { host.dispose(); this.status.textContent = `Modules were not enabled: ${message(error)}`; }
    finally { this.busy = false; this.draw(); }
  }
  private async replace(plan: InstalledGamePlan, publish: () => void, host = new BrowserModuleHost(error => { this.status.textContent = error; })): Promise<void> {
    const world = this.options.world();
    const runtime = new InstalledGameRuntime(this.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE, approvedDigests: new Set(plan.packages.map(ref => ref.digest)) }, {
      hostServices: this.services(host), staticModules: [],
      inspect: async bytes => runtimePackage(await decodeModulePackage(Uint8Array.from(bytes)), browserModuleAssets),
      construct: (candidate, identity) => {
        // These hook families need a simulation/renderer game adapter, not the device sidecar.
        if (candidate.core.forceExtensions.length || candidate.core.worldRules.length || candidate.core.commands.length
          || candidate.core.layers.length || candidate.core.panels.length || candidate.core.cameras.length
          || identity.manifests.some(manifest => manifest.tier === 'authoritative'))
          throw new Error('This selection needs a full simulation or renderer game profile. Device modules cannot change simulation authority.');
        host.configure(candidate);
        return { async start(signal) { signal.throwIfAborted(); }, activate: () => {
          if (this.options.world() !== world || !this.options.editable()) throw new Error('The active session changed; review the selection again');
          publish(); host.activate(this.root);
        }, dispose: () => host.dispose() };
      },
    });
    try {
      await runtime.replace(plan);
      const previous = this.runtime; this.runtime = runtime; this.host = host; this.activePlan = plan; previous?.dispose();
    } catch (error) { runtime.dispose(); host.dispose(); throw error; }
  }
  /** Capture the committed selection, rather than unchecked edits in the manager. */
  async capture(): Promise<RuntimeSelection | undefined> {
    if (this.activeSelection) return this.activeSelection;
    const plan = this.activePlan;
    if (!plan || !plan.packages.length) return undefined;
    const files = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const ref of plan.packages) {
      const stored = await this.store.get(ref.digest);
      if (!stored) throw new Error(`Cannot export missing package ${ref.id}`);
      files.set(`modules/${ref.id}.spacemod`, Uint8Array.from(stored.bytes));
    }
    if (this.activePlan !== plan) throw new Error('The active module selection changed while exporting');
    const empty: InstalledGamePlan = { profile: { ...plan.profile, modules: [], providers: {}, capabilities: {}, settings: {} }, packages: [], requiredSlots: [] };
    // Device selections are local to the viewer. The headless target keeps the base game.
    const plans: RuntimeSelection['plans'] = { [environment()]: plan, node: empty };
    const other = environment() === 'browser' ? 'offline' : 'browser';
    if (plan.packages.every(ref => this.catalog.get(ref.digest)?.manifest.environments.includes(other))) Object.assign(plans, { [other]: plan });
    return attachRuntimeFiles(validateRuntimeSelection({ format: 'spacelab-runtime-selection/2', plans }), files);
  }
  loadLegacyGame(publish: () => void): void {
    if (this.busy) throw new Error('A module selection is already loading');
    publish(); this.clear();
  }
  /** Prepare simulation and device hooks together, before publishing either host's game. */
  async loadWorldGame(selection: RuntimeSelection, options: Omit<InstalledWorldOptions, 'hostServices' | 'inspect' | 'configure' | 'dispose'>,
    publish: (prepared: Awaited<ReturnType<typeof prepareInstalledWorld>>) => void): Promise<void> {
    if (this.busy) throw new Error('A module selection is already loading');
    const previousWorld = this.options.world(), previousHost = this.host;
    this.busy = true; this.draw();
    const host = new BrowserModuleHost(error => { this.status.textContent = error; });
    let prepared: Awaited<ReturnType<typeof prepareInstalledWorld>> | undefined;
    try {
      const plan = await installRuntimeSelection(selection, this.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE }, 'Game library');
      await this.refresh();
      prepared = await prepareInstalledWorld(plan, this.store, { environment: environment(), allowRuntimeCode: ALLOW_RUNTIME_CODE,
        approvedDigests: new Set(plan.packages.map(ref => ref.digest)) }, { ...options, hostServices: this.services(host),
        inspect: async bytes => runtimePackage(await decodeModulePackage(Uint8Array.from(bytes)), browserModuleAssets),
        configure(modules) {
          if (modules.core.layers.length || modules.core.panels.length || modules.core.cameras.length) throw new Error('V2 renderer contributions require the renderer adapter; use the legacy presentation profile for now');
          host.configure(modules);
        },
        dispose: () => host.dispose(),
      }, new AbortController().signal);
      await prepared.candidate.start(new AbortController().signal);
      if (this.options.world() !== previousWorld || !this.options.editable()) throw new Error('The active session changed while loading');
      publish(prepared); host.activate(this.root);
      const previousRuntime = this.runtime, previousMixed = this.mixed;
      this.runtime = undefined; this.mixed = prepared.candidate; this.host = host; this.activePlan = plan; this.activeSelection = selection;
      this.selected.clear(); for (const ref of plan.packages) this.selected.set(ref.id, ref.digest);
      previousRuntime?.dispose(); previousMixed?.dispose(); previousHost?.dispose();
      this.status.textContent = 'Game modules enabled after restart. Reload this game from the Library to keep its complete simulation selection.';
    } catch (error) { prepared?.candidate.dispose(); host.dispose(); throw error; }
    finally { this.busy = false; this.draw(); }
  }
  sample(elapsed: number, flightAllowed: boolean, shortcutsAllowed: boolean): void {
    if (this.mixed && !this.mixed.available) this.clear();
    this.host?.sample(elapsed, flightAllowed, shortcutsAllowed);
  }
  release(): void { this.host?.release(); }
  verifyCandidate(candidate: Parameters<NonNullable<JoinOptions['verifyCandidate']>>[0]) {
    return this.mixed ? verifyInstalledWorldCandidate(this.mixed, candidate) : { ok: false, reason: 'Load the exact game before joining this server.' };
  }
  clear(): void {
    this.runtime?.dispose(); this.mixed?.dispose(); this.host?.dispose(); this.runtime = undefined; this.mixed = undefined;
    this.host = undefined; this.activePlan = undefined; this.activeSelection = undefined; this.selected.clear();
    for (const record of [this.providers, this.capabilities, this.settings]) for (const key of Object.keys(record)) delete record[key];
    this.status.textContent = 'Device modules are disabled for this game. Installed files remain on this device.'; this.draw();
  }
}
