import type { ModuleManifest, ModuleProfile, UniverseDefinition } from '../../../packages/game-api/src/index';
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

/** Installation never enables code. Authority is applied as a complete new-world profile. */
export class ModuleManager {
  readonly devices: DeviceModuleManager;
  private data = new Map<string, DataModule>();
  private universes = new Map<string, UniverseDefinition>();
  resetData(data: readonly DataModule[]): void { this.data = new Map(data.map(m => [m.manifest.id, m])); }
  constructor(private readonly presentation: Presentation, private readonly options: {
    readonly current: () => { readonly profile: ModuleProfile; readonly data: readonly DataModule[]; readonly editable: boolean;
      readonly universe: UniverseDefinition; readonly resolvedUniverse: UniverseDefinition; readonly universeKey: string; readonly systemId: string };
    readonly apply: (profile: ModuleProfile, data: readonly DataModule[], selection: { universe: string; system: string }) => void;
    readonly world: () => object;
  }) {
    this.devices = new DeviceModuleManager(moduleLibrary.store, { editable: () => this.options.current().editable, world: options.world,
      activeLegacyIds: () => new Set([...this.options.current().profile.modules, ...(this.presentation.profile?.modules ?? [])].map(ref => ref.id)), restart: () => {
      const current = this.options.current();
      this.options.apply(current.profile, current.data, { universe: current.universeKey, system: current.systemId });
    } });
    element('plugin-manager').append(this.devices.root);
    element('plugin-universe').addEventListener('change', () => this.syncSystems());
    element('authoritative-module-list').addEventListener('change', () => this.syncUniverses(
      element<HTMLSelectElement>('plugin-universe').value, element<HTMLSelectElement>('plugin-system').value));
    const preview = document.createElement('p'); preview.id = 'module-change-preview'; preview.setAttribute('role', 'status');
    element('authoritative-module-list').after(preview);
    element('authoritative-module-list').addEventListener('change', () => this.preview());
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
          if (plugin.format !== 'space-lab-plugin/1') throw new Error('Import game collections in the Library');
          this.install(plugin); return;
        }
        const artifact = parseCodeArtifact(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        this.install({ format: 'space-lab-plugin/1', info: { id: artifact.manifest.id, name: artifact.manifest.name, description: '' }, data: [], code: [artifact] });
      } catch (error) { show('code-module-status', `Module was not installed: ${message(error)}`); }
      finally { input.value = ''; }
    });
    element('apply-code-modules').addEventListener('click', () => {
      try {
        if (!this.options.current().editable) throw new Error('Change authoritative modules in your solo world');
        const refs = [...element('authoritative-module-list').querySelectorAll<HTMLInputElement>('input[data-enable]:checked')]
          .map(input => ({ id: input.dataset.enable!, version: input.dataset.version! }));
        const universe = element<HTMLSelectElement>('plugin-universe').value;
        const content = [...this.data.values()].find(m => m.data.universes?.some(u => !u.target && `${m.manifest.id}/${u.definition.id}` === universe));
        if (content && !refs.some(ref => ref.id === content.manifest.id)) refs.push({ id: content.manifest.id, version: content.manifest.version });
        const registry = this.registry();
        const modules = registry.closure(refs), enabled = new Set(modules.map(m => m.id));
        const settings: Record<string, Record<string, number>> = {};
        for (const input of element('authoritative-module-list').querySelectorAll<HTMLInputElement>('input[data-setting]')) {
          if (!enabled.has(input.dataset.owner!)) continue;
          (settings[input.dataset.owner!] ??= {})[input.dataset.setting!] = Number(input.value);
        }
        const providers: Record<string, string> = {};
        for (const select of element('authoritative-providers').querySelectorAll<HTMLSelectElement>('select')) {
          if (enabled.has(select.value)) providers[select.dataset.slot!] = select.value;
        }
        const profile: ModuleProfile = { format: 'space-sim-profile/1', id: 'local.custom', modules, providers, settings };
        // Resolution precedes any initializer, including source evaluation.
        registry.resolve(profile, environment(), ['motion', 'content']);
        this.options.apply(profile, [...this.data.values()].filter(m => enabled.has(m.manifest.id)),
          { universe, system: element<HTMLSelectElement>('plugin-system').value });
        this.refresh();
        show('code-module-status', 'Profile enabled in a new world. Save or export a game to share this complete selection.');
      } catch (error) { show('code-module-status', `Profile was not enabled: ${message(error)}`); }
    });
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
  private preview(): void {
    const current = this.options.current();
    const refs = [...element('authoritative-module-list').querySelectorAll<HTMLInputElement>('input[data-enable]:checked')]
      .map(input => ({ id: input.dataset.enable!, version: input.dataset.version! }));
    try {
      const closure = this.registry().closure(refs), selected = new Set(closure.map(ref => ref.id));
      const added = closure.filter(ref => !refs.some(request => request.id === ref.id)).map(ref => ref.id);
      const removed = current.profile.modules.filter(ref => !selected.has(ref.id)).map(ref => ref.id);
      const parts = ['Applying this selection starts a new world.'];
      if (added.length) parts.push(`Required dependencies will also be enabled: ${added.join(', ')}.`);
      if (removed.length) parts.push(`Modules removed from the new world: ${removed.join(', ')}.`);
      parts.push(`Dependency order: ${closure.map(ref => ref.id).join(' → ')}.`);
      show('module-change-preview', parts.join(' '));
    } catch (error) { show('module-change-preview', `Selection cannot be applied: ${message(error)}`); }
  }
  private registry() {
    return createBuiltinRegistry([...this.data.values()],
      [...GAME_EXAMPLES, ...moduleLibrary.modules(environment()).filter(m => m.manifest.authority === 'authoritative')]);
  }
  refresh(): void {
    this.refreshData();
    const current = this.options.current(), registry = this.registry();
    const manifests = [...registry.manifests.values()].filter(m => m.authority === 'authoritative' || m.kind === 'data');
    const list = element('authoritative-module-list');
    list.replaceChildren(...manifests.map(manifest => {
      const item = document.createElement('li'), label = document.createElement('label'), box = document.createElement('input');
      box.type = 'checkbox'; box.dataset.enable = manifest.id; box.dataset.version = manifest.version;
      box.checked = current.profile.modules.some(m => m.id === manifest.id); box.disabled = !current.editable;
      label.append(box, ` ${manifest.name} · ${manifest.id}@${manifest.version}`);
      item.append(label);
      if (manifest.dependencies.length) {
        const note = document.createElement('p'); note.className = 'module-note';
        note.textContent = `Requires ${manifest.dependencies.map(d => `${d.id}@${d.version}`).join(', ')}`; item.append(note);
      }
      item.append(...this.settings(manifest, current.profile, input => { input.dataset.owner = manifest.id; input.disabled = !current.editable; }));
      return item;
    }));
    this.syncUniverses(current.universeKey, current.systemId);
    const slots = [...new Set(manifests.flatMap(m => [...m.slots]))];
    element('authoritative-providers').replaceChildren(...slots.map(slot => {
      const label = document.createElement('label'), select = document.createElement('select');
      select.dataset.slot = slot; select.disabled = !current.editable;
      const none = document.createElement('option'); none.value = ''; none.textContent = 'Automatic'; select.append(none);
      for (const m of manifests.filter(m => m.slots.includes(slot))) {
        const option = document.createElement('option'); option.value = m.id; option.textContent = m.name; select.append(option);
      }
      select.value = current.profile.providers[slot] ?? ''; label.append(`${slot} `, select); return label;
    }));
    element<HTMLButtonElement>('apply-code-modules').disabled = !current.editable;
    element('installed-code-modules').replaceChildren(...[...this.data.values(), ...moduleLibrary.artifacts].map(artifact => {
      const item = document.createElement('li'), detail = document.createElement('p');
      const m = artifact.manifest;
      const active = artifact.format !== 'space-sim-data-module/1' && m.authority === 'presentation' ? this.presentation.isEnabled(m.id) : current.profile.modules.some(ref => ref.id === m.id);
      detail.textContent = `${m.name} · ${m.id}@${m.version} · ${active ? 'active' : 'installed'} · ${m.authority} · ${m.license} · ${'digest' in artifact ? `SHA-256 ${artifact.digest}` : 'data'}`;
      item.append(detail);
      if ('inputs' in artifact) {
        const notices = document.createElement('details'), summary = document.createElement('summary'), text = document.createElement('pre');
        summary.textContent = 'Bundled inputs and attribution';
        text.textContent = artifact.inputs.map(i => `${i.path} · ${i.license}\n${i.attribution}`).join('\n\n'); notices.append(summary, text); item.append(notices);
      }
      const exportButton = document.createElement('button'); exportButton.textContent = 'Export plugin'; exportButton.type = 'button';
      exportButton.onclick = async () => {
        try {
          const files = packageFiles(artifact) ?? (artifact.format === 'space-sim-data-module/1'
            ? wrapLegacyData(artifact, `Legacy data; declared license: ${artifact.manifest.license}`) : wrapLegacyCode(artifact));
          downloadBytes(`${m.id}.${m.kind === 'data' ? 'spacedata' : 'spacemod'}`, await encodeModuleFiles(files));
        }
        catch (error) { show('code-module-status', message(error)); }
      };
      const remove = document.createElement('button'); remove.textContent = 'Remove'; remove.type = 'button'; remove.disabled = active;
      remove.title = active ? 'Disable the module before removing it' : 'Remove this installed artifact';
      remove.onclick = () => {
        try { if (artifact.format === 'space-sim-data-module/1') { this.data.delete(m.id); moduleLibrary.remove(m.id); }
          else { if (m.authority === 'presentation') this.presentation.remove(m.id); moduleLibrary.remove(m.id); }
          this.refresh(); }
        catch (error) { show('code-module-status', message(error)); }
      };
      item.append(exportButton, remove);
      if (m.authority === 'presentation' && Object.keys(m.settings).length && active && this.presentation.profile) {
        const inputs: HTMLInputElement[] = [];
        item.append(...this.settings(m, this.presentation.profile, input => inputs.push(input)));
        const apply = document.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply presentation settings';
        apply.onclick = () => {
          try { this.presentation.setSettings(m.id, Object.fromEntries(inputs.map(input => [input.dataset.setting!, Number(input.value)]))); }
          catch (error) { show('code-module-status', message(error)); }
        }; item.append(apply);
      }
      return item;
    }));
    this.preview();
  }
  private syncUniverses(preferred: string, system?: string): void {
    const current = this.options.current();
    const base = new Map([...builtinUniverses().values()].map(u => [`builtin.content/${u.id}`, u]));
    base.set(`builtin.content/${current.universe.id}`, current.universe);
    const refs = [...element('authoritative-module-list').querySelectorAll<HTMLInputElement>('input[data-enable]:checked')]
      .map(input => ({ id: input.dataset.enable!, version: input.dataset.version! }));
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
      const option = document.createElement('option'); option.value = key; option.textContent = `${universe.name} · ${key}`; return option;
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
  private settings(manifest: ModuleManifest, profile: ModuleProfile, setup: (input: HTMLInputElement) => void): HTMLElement[] {
    return Object.entries(manifest.settings).map(([key, schema]) => {
      const label = document.createElement('label'), input = document.createElement('input');
      input.type = 'number'; input.step = 'any'; input.min = String(schema.minimum); input.max = String(schema.maximum);
      input.value = String(profile.settings[manifest.id]?.[key] ?? schema.default); input.dataset.setting = key; setup(input);
      label.append(`${key} [${schema.minimum}, ${schema.maximum}] `, input); return label;
    });
  }
}
