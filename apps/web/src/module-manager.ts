import { normalizeLegacyModule } from '../../../packages/game-runtime/src/loader';
import { moduleAssets } from '../../../packages/game-runtime/src/modules-v2';
import type { RuntimeSelection } from '../../../packages/game-library/src/runtime-selection';
import type { ModuleProfileV2 } from '../../../packages/game-api/src/index';
import type { ModuleProfile, UniverseDefinition, ModMenuProfileView } from '../../../packages/game-api/src/index';
import { applyDataModules, createBuiltinRegistry, type DataModule } from '../../../packages/modules/src/index';
import { GAME_EXAMPLES } from '../../../examples/modules/index';
import { builtinUniverses, environment } from './startup';
import { moduleLibrary } from './module-library';
import type { Presentation } from './presentation';
import { element, message, show, downloadBytes } from './ui';
import { decodePackage, artifactModules, validatePackage, type PluginPackage } from '../../../packages/game-library/src/archive';
import { parseCodeArtifact } from '../../../packages/game-runtime/src/artifact';
import { decodeModulePackage, encodeModuleFiles, packageFiles, wrapLegacyCode, wrapLegacyData } from '../../../packages/game-library/src/portable';
import { isZip } from '../../../packages/game-library/src/zip';
import { DeviceModuleManager } from './device-module-manager';
import { ALLOW_RUNTIME_CODE } from '../../../packages/game-runtime/src/build-policy';
import {createModMenu} from '../../../modules/mod-menu/src/index';

/** Installation never enables code. Authority is applied as a complete new-world profile. */
export class ModuleManager {
  readonly devices: DeviceModuleManager;
  private readonly modMenu=createModMenu();
  private profileEditor:ModMenuProfileView;
  private editWorld:object;
  private data = new Map<string, DataModule>();
  private universes = new Map<string, UniverseDefinition>();
  resetData(data: readonly DataModule[]): void { this.data = new Map([...this.data,...moduleLibrary.data,...data.map(m => [m.manifest.id,m] as const)]); }
  constructor(private readonly presentation: Presentation, private readonly options: {
    readonly current: () => { readonly profile: ModuleProfile; readonly data: readonly DataModule[]; readonly editable: boolean;
      readonly universe: UniverseDefinition; readonly resolvedUniverse: UniverseDefinition; readonly universeKey: string; readonly systemId: string };
    readonly apply: (profile: ModuleProfile, data: readonly DataModule[], selection: { universe: string; system: string }, runtime?: RuntimeSelection,signal?:AbortSignal) => Promise<void>;
    readonly pilots: import('../../../packages/game-api/src/index').PilotRegistry; readonly world: () => object;
  }) {
    this.editWorld=options.world();this.profileEditor=this.createProfileEditor(options.current().profile);
    this.devices = new DeviceModuleManager(moduleLibrary.store, { pilots: options.pilots, editable: () => this.options.current().editable, world: options.world,
      base: () => this.base(), editBase: profile => {
        this.profileEditor.select(profile.modules);
      }, apply: (runtime,signal) => this.applyProfile(runtime,signal) });
    element('plugin-manager').append(this.devices.root);
    element('plugin-universe').addEventListener('change', () => this.syncSystems());
    const preview = document.createElement('p'); preview.id = 'module-change-preview'; preview.setAttribute('role', 'status');
    const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Dependency details';details.append(summary,preview);element('apply-code-modules').after(details);
    void moduleLibrary.open().then(() => {
      for (const data of moduleLibrary.data.values()) if (!this.data.has(data.manifest.id)) this.data.set(data.manifest.id, data);
      for (const artifact of moduleLibrary.artifacts) if (artifact.manifest.authority === 'presentation' && !this.presentation.registry.getManifest(artifact.manifest.id))
        this.presentation.install(artifactModules([artifact], environment())[0]!);
      this.refresh();
      show('code-module-status', moduleLibrary.storageStatus);
      return this.devices.refresh().catch(() => { /* The library already reports storage denial. */ });
    });
    const input = element<HTMLInputElement>('code-module-file');
    element('install-code-module').addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      try {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > 32 * 1024 * 1024) throw new Error('Module package must be at most 32 MiB');
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (await this.installDevicePackage(bytes, file.name)) return;
        if (isZip(bytes)) {
          const plugin = await decodePackage(bytes);
          if (plugin.format !== 'space-lab-plugin/1') throw new Error('Import game collections in ModMenu');
          this.install(plugin); return;
        }
        const artifact = parseCodeArtifact(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        this.install({ format: 'space-lab-plugin/1', info: { id: artifact.manifest.id, name: artifact.manifest.name, description: '' }, data: [], code: [artifact] });
      } catch (error) { show('code-module-status', `Module was not installed: ${message(error)}`); }
      finally { input.value = ''; }
    });
    element('apply-code-modules').addEventListener('click', () => { void this.applyProfile().catch(error => show('code-module-status', `Profile was not enabled: ${message(error)}`)); });
  }
  private createProfileEditor(profile:ModuleProfile):ModMenuProfileView {
    return this.modMenu.profile({list:element('authoritative-module-list'),providers:element('authoritative-providers'),installed:element('installed-code-modules'),apply:element<HTMLButtonElement>('apply-code-modules')},{
      changed:()=>{this.syncUniverses(element<HTMLSelectElement>('plugin-universe').value,element<HTMLSelectElement>('plugin-system').value);this.preview();},error:text=>show('code-module-status',text),
      exportModule:async(id,signal)=>{signal.throwIfAborted();const artifact=this.installedArtifact(id),manifest=artifact.manifest;const files=packageFiles(artifact)??(artifact.format==='space-sim-data-module/1'?wrapLegacyData(artifact,`Legacy data; declared license: ${manifest.license}`):wrapLegacyCode(artifact));const bytes=await encodeModuleFiles(files);signal.throwIfAborted();downloadBytes(`${manifest.id}.${manifest.kind==='data'?'spacedata':'spacemod'}`,bytes);},
      removeModule:async(id,signal)=>{signal.throwIfAborted();const artifact=this.installedArtifact(id),manifest=artifact.manifest;if(this.isActive(artifact))throw new Error('Disable the module before removing it');if(artifact.format==='space-sim-data-module/1')this.data.delete(id);else if(manifest.authority==='presentation')this.presentation.remove(id);moduleLibrary.remove(id);this.refresh();},
      presentationSettings:async(id,values,signal)=>{signal.throwIfAborted();this.presentation.setSettings(id,values);}
    },profile);
  }
  private async applyProfile(runtime?: RuntimeSelection,signal?:AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (!this.options.current().editable) throw new Error('Change authoritative modules in your solo world');
    const universe = element<HTMLSelectElement>('plugin-universe').value;
    const draft = this.base().profile;
    const refs = draft.modules.filter(ref => this.registry().manifests.has(ref.id));
    const content = [...this.data.values()].find(m => m.data.universes?.some(u => !u.target && `${m.manifest.id}/${u.definition.id}` === universe));
    if (content && !refs.some(ref => ref.id === content.manifest.id)) refs.push({ id: content.manifest.id, version: content.manifest.version });
    const modules = this.registry().closure(refs), enabled = new Set(modules.map(m => m.id));
    const profile: ModuleProfile = { format: 'space-sim-profile/1', id: this.options.current().profile.id, modules,
      providers: Object.fromEntries(Object.entries(draft.providers).filter(([, id]) => enabled.has(id))),
      settings: Object.fromEntries(Object.entries(draft.settings).filter(([id]) => enabled.has(id))) };
    // Mixed resolution validates the complete graph. Legacy-only games retain v1 identities.
    runtime ??= await this.devices.proposal();
    if (!runtime) this.registry().resolve(profile, environment(), ['motion', 'content']);
    signal?.throwIfAborted();await this.options.apply(profile, [...this.data.values()].filter(m => enabled.has(m.manifest.id)),
      { universe, system: element<HTMLSelectElement>('plugin-system').value }, runtime,signal);
    this.refresh();
    show('code-module-status', 'Profile enabled in a new world. Save or export a game to share this complete selection.');
  }
  /** Inert normalization used only by the common full-game dependency preview. */
  private base(): { profile: ModuleProfileV2; applied: ModuleProfileV2; manifests: ReadonlyMap<string, import('../../../packages/game-api/src/index').ManifestV2> } {
    const registry = this.registry();
    const manifests = new Map([...registry.manifests, ...this.presentation.registry.manifests].map(([id, manifest]) =>
      [id, normalizeLegacyModule({ manifest, initialize() {} }, moduleAssets()).manifest]));
    const {modules,settings,providers}=this.profileEditor.draft();
    const display = this.presentation.profile;
    const current = this.options.current().profile;
    const applied: ModuleProfileV2 = { format: 'space-sim-profile/2', id: current.id,
      modules: [...current.modules, ...display?.modules ?? []], providers: { ...current.providers, ...display?.providers },
      settings: { ...current.settings, ...display?.settings }, capabilities: {} };
    return { manifests, applied, profile: { format: 'space-sim-profile/2', id: this.options.current().profile.id,
      modules: [...modules, ...display?.modules ?? []], settings: { ...settings, ...display?.settings },
      providers: { ...providers, ...display?.providers }, capabilities: {} } };
  }

  async installDevicePackage(bytes: Uint8Array, source: string): Promise<boolean> {
    if (!isZip(bytes)) return false;
    let checked;
    try { checked = await decodeModulePackage(Uint8Array.from(bytes)); } catch { return false; }
    if (checked.descriptor.manifest.format !== 'space-sim-module/2') return false;
    await this.devices.install(bytes, source);
    show('code-module-status', 'Installed on this device. Code has not run. Open Device and network modules to review and enable it.');
    return true;
  }
  install(plugin: PluginPackage): void {
    const checked = validatePackage(plugin);
    if (checked.format !== 'space-lab-plugin/1') throw new Error('Expected a plugin package');
    if (!ALLOW_RUNTIME_CODE && checked.code.length) throw new Error('This build does not allow imported code');
    plugin = checked;
    this.refreshData();
    const registry = this.registry();
    for (const entry of [...plugin.data, ...plugin.code]) {
      if (registry.getManifest(entry.manifest.id) || this.presentation.registry.getManifest(entry.manifest.id))
        throw new Error(`Module ${entry.manifest.id}: duplicate installed ID; disable and remove it first`);
    }
    // All IDs and artifacts have been inspected before mutating either registry.
    for (const data of plugin.data) { this.data.set(data.manifest.id, data); moduleLibrary.installData(data); }
    for (const artifact of plugin.code) {
      moduleLibrary.install(artifact);
      if (artifact.manifest.authority === 'presentation') this.presentation.install(artifactModules([artifact], environment())[0]!);
    }
    show('code-module-status', `Installed ${plugin.info.name}. Code has not run. Select plugins and apply to enable them. Save as a game to keep the selection.`);
    this.refresh();
    void moduleLibrary.flush().then(() => show('code-module-status', `Installed ${plugin.info.name}. Code has not run. ${moduleLibrary.storageStatus}`));
  }
  private refreshData(): void {
    for (const data of this.options.current().data) this.data.set(data.manifest.id, data);
  }
  private preview(announce = true): void {
    show('module-change-preview', this.devices.preview(false, false, announce));
  }
  private registry() {
    return createBuiltinRegistry([...this.data.values()],
      [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')]);
  }
  refresh(): void {
    this.refreshData();
    const current = this.options.current(), registry = this.registry();
    const world=this.options.world();if(world!==this.editWorld){this.profileEditor.dispose();this.editWorld=world;this.profileEditor=this.createProfileEditor(current.profile);}
    const manifests = [...registry.manifests.values()].filter(m => m.authority === 'authoritative' || m.kind === 'data');
    this.profileEditor.refresh({applied:current.profile,available:manifests,editable:current.editable,installed:[...this.data.values(),...moduleLibrary.artifacts].map(artifact=>{
      const manifest=artifact.manifest,active=this.isActive(artifact);
      return {manifest,active,...('digest' in artifact?{digest:artifact.digest}:{}),...('inputs' in artifact?{inputs:artifact.inputs}:{}),...(manifest.authority==='presentation'&&active&&this.presentation.profile?{values:this.presentation.profile.settings[manifest.id]??{}}:{})};
    })});
    const imported=this.data.size+moduleLibrary.artifacts.length;
    element('installed-code-empty').hidden=imported>0;
    show('plugin-overview',`${manifests.length} simulation options · ${this.presentation.installed.length} display options · ${imported} imported plugins`);
    this.syncUniverses(current.universeKey,current.systemId);
    this.preview(false);
  }
  private syncUniverses(preferred: string, system?: string): void {
    const current = this.options.current();
    const base = new Map([...builtinUniverses().values()].map(u => [`builtin.content/${u.id}`, u]));
    base.set(`builtin.content/${current.universe.id}`, current.universe);
    const refs=this.profileEditor.draft().modules;
    try {
      const enabled = new Set(this.registry().closure(refs).map(m => m.id));
      this.universes = new Map(applyDataModules(base, [...this.data.values()].filter(m => enabled.has(m.manifest.id))));
    } catch { this.universes = base; /* Apply reports dependency/content errors without replacing the world. */ }
    // Added worlds are discoverable before enabling their owning content plugin.
    for (const m of this.data.values()) for (const u of m.data.universes ?? []) if (!u.target) {
      const key = `${m.manifest.id}/${u.definition.id}`;
      if (!this.universes.has(key)) this.universes.set(key, u.definition);
    }
    if (!this.universes.has(current.universeKey)) this.universes.set(current.universeKey, current.resolvedUniverse);
    const select = element<HTMLSelectElement>('plugin-universe');
    select.replaceChildren(...[...this.universes].map(([key, universe]) => {
      const owner=key.split('/')[0]!,source=owner==='builtin.content'?'Built-in':this.data.get(owner)?.manifest.name??owner;
      const option = document.createElement('option'); option.value = key; option.textContent = `${universe.name} · ${source}`; option.title=key; return option;
    }));
    select.value = this.universes.has(preferred) ? preferred : select.options[0]?.value ?? '';
    select.disabled = !current.editable;
    this.syncSystems(system);
  }
  private syncSystems(preferred?: string): void {
    const universe = this.universes.get(element<HTMLSelectElement>('plugin-universe').value);
    const select = element<HTMLSelectElement>('plugin-system');
    select.replaceChildren(...(universe?.systems ?? []).map(system => {
      const option = document.createElement('option'); option.value = system.id; option.textContent = system.name; return option;
    }));
    select.value = universe?.systems.some(system => system.id === preferred) ? preferred! : universe?.defaultSystemId ?? '';
    select.disabled = !this.options.current().editable;
  }
  private installedArtifact(id:string):DataModule|import('../../../packages/game-runtime/src/artifact').CodeArtifact {
    const artifact=this.data.get(id)??moduleLibrary.artifacts.find(artifact=>artifact.manifest.id===id);if(!artifact)throw new Error('This module is no longer installed');return artifact;
  }
  private isActive(artifact:ReturnType<ModuleManager['installedArtifact']>):boolean {
    return artifact.format!=='space-sim-data-module/1'&&artifact.manifest.authority==='presentation'?this.presentation.isEnabled(artifact.manifest.id):this.options.current().profile.modules.some(ref=>ref.id===artifact.manifest.id);
  }
}
