import { CORE_DOM, CORE_THEME, CORE_UI, type ActionDefinitionV2, type ActionSink, type Disposable,
  type HostServiceAccess, type InputFrame, type InputSource, type ModuleAssets, type ModuleContribution,
  type ThemeService, type TrustedDomShell, type UiShell, type WindowDefinition } from '../../../packages/game-api/src/index';
import type { ModuleCandidateV2 } from '../../../packages/game-runtime/src/modules-v2';
import { moduleAssets } from '../../../packages/game-runtime/src/modules-v2';
import { getActiveTheme, onThemeChange, saveThemeSettings } from '../../../packages/render-2d/src/theme';
import { registerModuleGuides } from './manual';

function themeSettings(value: Parameters<ThemeService['set']>[0]): Parameters<ThemeService['set']>[0] {
  const current = getActiveTheme(), checked: Record<string, unknown> = Object.create(null);
  const enums: Record<string, readonly string[]> = {
    backdropStyle: ['spacelab', 'nebula', 'carina', 'galactic', 'aurora', 'supernova', 'void', 'pillars', 'helix', 'asteroids'],
    gridStyle: ['cartesian', 'polar', 'dots', 'hex', 'off'], counterTheme: ['spacelab', 'cyber', 'apollo', 'tactical', 'aurora', 'solar', 'custom'],
    windowStyle: ['classic', 'cyber', 'apollo', 'tactical', 'aurora', 'solar', 'void', 'crimson'],
  };
  for (const [key, item] of Object.entries(value)) {
    if (enums[key]) { if (typeof item !== 'string' || !enums[key]!.includes(item)) throw new Error(`Invalid theme setting ${key}`); }
    else if (['gridColor', 'windowColor', 'hudColor'].includes(key)) { if (typeof item !== 'string' || !/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(item)) throw new Error(`Invalid theme color ${key}`); }
    else if (['worldSeed', 'shaderSeed'].includes(key)) { if (!Number.isSafeInteger(item) || (item as number) < 0) throw new Error(`Invalid theme seed ${key}`); }
    else {
      const previous: unknown = current[key as keyof typeof current];
      if (typeof previous === 'boolean' ? typeof item !== 'boolean' : typeof previous === 'number'
        ? typeof item !== 'number' || !Number.isFinite(item) || item < 0 : true) throw new Error(`Invalid theme setting ${key}`);
    }
    checked[key] = item;
  }
  return Object.freeze(checked);
}

/** Scoped URL ownership is additionally captured by ModuleRegistryV2 during initialization. */
export function browserModuleAssets(files: ReadonlyMap<string, Uint8Array>): ModuleAssets {
  return moduleAssets(files, bytes => {
    const href = URL.createObjectURL(new Blob([Uint8Array.from(bytes)])); let active = true;
    return Object.freeze({ href, dispose() { if (active) { active = false; URL.revokeObjectURL(href); } } });
  });
}
/** Temporary app adapter for declarative device UI. It prepares off-DOM, then publishes
 * synchronously with its candidate. Imported titles/content are always text nodes. */
export class BrowserModuleHost implements Disposable {
  readonly root = document.createElement('section');
  private readonly windows = new Map<string, HTMLDetailsElement>();
  private readonly controls = new Map<string, HTMLElement>();
  private readonly callbacks = new Map<string, Set<(value: string | number | boolean) => void>>();
  private readonly opens = new Set<string>();
  private readonly resources: Disposable[] = [];
  private readonly mounts: { id: string; mount: (root: HTMLElement) => Disposable; active: boolean; resource?: Disposable }[] = [];
  private candidate: ModuleCandidateV2 | undefined;
  private theme: Parameters<ThemeService['set']>[0] | undefined;
  private sources: readonly ModuleContribution<InputSource>[] = [];
  private actions: readonly ActionDefinitionV2[] = [];
  private readonly indices = new Map<string, number>();
  private values = new Float64Array(0);
  private previous = new Float64Array(0);
  private readonly frame: { -readonly [K in keyof InputFrame]: InputFrame[K] } = { elapsed: 0, pilot: 0, flightAllowed: false, shortcutsAllowed: false };
  private readonly sink: ActionSink = { set: (action, value) => { const index = this.indices.get(action); if (index !== undefined) this.values[index] = value; } };
  private disposed = false;
  private attached = false;
  readonly shell: UiShell = Object.freeze<UiShell>({
    open: id => { this.assertLive(); this.opens.add(id); const window = this.windows.get(id); if (window) window.open = true; },
    close: id => { this.assertLive(); this.opens.delete(id); const window = this.windows.get(id); if (window) window.open = false; },
    set: (id, value) => {
      this.assertLive(); const control = this.controls.get(id); if (!control) throw new Error(`Unknown module control ${id}`);
      if (control instanceof HTMLInputElement) {
        if (control.type === 'checkbox') { if (typeof value !== 'boolean') throw new Error('Toggle value must be boolean'); control.checked = value; }
        else { const number = Number(value); if (!Number.isFinite(number) || number < Number(control.min) || number > Number(control.max)) throw new Error('Slider value is out of bounds'); control.value = String(number); }
      } else control.textContent = String(value);
    },
    onAction: (id, callback) => {
      this.assertLive(); const callbacks = this.callbacks.get(id) ?? new Set(); callbacks.add(callback); this.callbacks.set(id, callbacks);
      return { dispose: () => { callbacks.delete(callback); } };
    },
  });
  readonly dom: TrustedDomShell = Object.freeze<TrustedDomShell>({ mountTrusted: (id, mount) => {
    this.assertLive(); const entry: typeof this.mounts[number] = { id, mount, active: true }; this.mounts.push(entry);
    const lease = { dispose: () => { if (!entry.active) return; entry.active = false; entry.resource?.dispose(); } };
    this.resources.push(lease); return lease;
  } });
  constructor(private readonly fault: (message: string) => void = () => {}) {
    this.root.setAttribute('aria-label', 'Module windows'); this.root.className = 'module-windows';
  }
  private assertLive(): void { if (this.disposed) throw new Error('Module UI is disposed'); }
  /** Candidate theme settings are checked before they can affect the active viewer. */
  hostServices(): readonly HostServiceAccess[] {
    const theme: ThemeService = Object.freeze<ThemeService>({ current: () => Object.freeze({ ...getActiveTheme() }),
      set: value => { this.assertLive(); const checked = themeSettings(value); if (this.attached) saveThemeSettings(checked); else this.theme = checked; },
      subscribe: change => { this.assertLive(); const unsubscribe = onThemeChange(value => { if (this.attached && !this.disposed) change(value); }); const resource = { dispose: unsubscribe }; this.resources.push(resource); return resource; } });
    const access = { tiers: ['platform', 'presentation'] as const, environments: ['browser', 'offline'] as const };
    return [{ ...access, key: CORE_UI, service: this.shell }, { ...access, key: CORE_DOM, service: this.dom }, { ...access, key: CORE_THEME, service: theme }];
  }
  configure(candidate: ModuleCandidateV2): void {
    this.assertLive(); this.candidate = candidate; this.actions = candidate.actionDefinitions; this.sources = candidate.contributions('input');
    this.actions.forEach((action, index) => this.indices.set(action.id, index));
    this.values = new Float64Array(this.actions.length); this.previous = new Float64Array(this.actions.length);
    for (const window of candidate.contributions('window')) this.createWindow(window.id, window.value);
    for (const id of this.callbacks.keys()) if (!this.indices.has(id)) throw new Error(`Module UI subscribed to unknown action ${id}`);
    for (const id of this.opens) if (!this.windows.has(id)) throw new Error(`Unknown module window ${id}`);
    for (const entry of this.mounts) if (entry.active) {
      const window = this.windows.get(entry.id); if (!window) throw new Error(`Unknown trusted DOM window ${entry.id}`);
      entry.resource = entry.mount(window);
    }
    if (candidate.contributions('material').length || candidate.contributions('post').length) throw new Error('The selected renderer does not provide material/post effects. Choose a compatible renderer before enabling this module.');
  }
  private createWindow(id: string, definition: WindowDefinition): void {
    const window = document.createElement('details'), title = document.createElement('summary');
    title.textContent = definition.title; window.append(title); window.open = this.opens.has(id); this.windows.set(id, window);
    for (const control of definition.controls) {
      const key = `${id}/${control.id}`;
      let node: HTMLElement;
      if (control.kind === 'text') { node = document.createElement('p'); node.textContent = control.text; }
      else if (control.kind === 'canvas') { const canvas = document.createElement('canvas'); canvas.setAttribute('aria-label', control.label); node = canvas; }
      else {
        const label = document.createElement('label'); label.append(document.createTextNode(control.label));
        if (control.kind === 'button') {
          const button = document.createElement('button'); button.type = 'button'; button.textContent = control.label;
          button.addEventListener('click', () => this.emit(control.action, 1)); node = button;
        } else {
          const input = document.createElement('input'); input.type = control.kind === 'toggle' ? 'checkbox' : 'range';
          if (control.kind === 'slider') { input.min = String(control.minimum); input.max = String(control.maximum); input.step = String(control.step); input.value = String(control.minimum); }
          input.addEventListener('input', () => this.emit(control.action, control.kind === 'toggle' ? input.checked : Number(input.value)));
          label.append(input); this.controls.set(key, input); window.append(label); continue;
        }
      }
      this.controls.set(key, node); window.append(node);
    }
    this.root.append(window);
  }
  private emit(id: string, value: string | number | boolean): void {
    if (this.disposed) return;
    const callbacks = this.callbacks.get(id); if (!callbacks) return;
    for (const callback of callbacks) {
      try { callback(value); } catch (error) { this.callbacks.get(id)?.delete(callback); this.release(); this.fault(`Module action ${id} failed: ${String(error)}`); }
    }
  }
  /** All arrays/frame/sink are allocated at activation; no per-sample objects. */
  sample(elapsed: number, flightAllowed: boolean, shortcutsAllowed: boolean): void {
    if (this.disposed || !this.attached) return;
    if (!flightAllowed && !shortcutsAllowed) { this.release(); return; }
    this.frame.elapsed = elapsed; this.frame.flightAllowed = flightAllowed; this.frame.shortcutsAllowed = shortcutsAllowed;
    this.values.fill(0);
    for (const source of this.sources) source.value.sample(this.frame, this.sink);
    for (let i = 0; i < this.actions.length; i++) {
      const value = this.values[i]!, previous = this.previous[i]!;
      if (value !== previous && (this.actions[i]!.mode !== 'press' || value !== 0)) this.emit(this.actions[i]!.id, value);
    }
    this.previous.set(this.values);
  }
  release(): void {
    for (const source of this.sources) source.value.release();
    this.values.fill(0);
    for (let i = 0; i < this.actions.length; i++) if (this.previous[i] !== 0) {
      this.previous[i] = 0;
      if (this.actions[i]!.mode !== 'press') this.emit(this.actions[i]!.id, 0);
    }
  }
  activate(container: HTMLElement): void {
    this.assertLive(); container.append(this.root); this.attached = true;
    if (this.candidate) this.resources.push(registerModuleGuides(this.candidate));
    if (this.theme) saveThemeSettings(this.theme);
  }
  dispose(): void {
    if (this.disposed) return; this.release(); this.disposed = true; this.root.remove();
    for (const resource of this.resources.reverse()) { try { resource.dispose(); } catch { /* Continue closing owned resources. */ } }
    this.resources.length = 0; this.callbacks.clear(); this.controls.clear(); this.windows.clear();
  }
}
