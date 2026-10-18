import type {
  AudioProvider, CameraExtension, CameraInput, CameraTarget, ModuleManifest, ModuleProfile, ModuleReference, OverlayPrimitive,
  RegisteredModule, PresentationFault, PresentationSnapshot, PresentationView, RendererProvider,
} from '../../../packages/game-api/src/index';
import { ModuleRuntime, PresentationHooks, frozenSnapshot, type ModuleCandidate } from '../../../packages/game-runtime/src/index';
import {
  BUILTIN_RENDERERS, CANVAS_RENDERER, INSTRUMENTS, PROCEDURAL_AUDIO, WEBGL_RENDERER, createPresentationRegistry, presentationProfile,
} from '../../../packages/modules/src/browser';
import { PRESENTATION_EXAMPLES } from '../../../examples/modules/index';
import { Rendering } from './rendering';
import { environment } from './startup';
import { element, message, show } from './ui';
import { mountFlightAudio } from './audio';

type EventSink = (kind: string, detail: Record<string, unknown>) => void;
/** The viewer's own changes to the default modules: a per-browser convenience, never shared or
 * saved with worlds. Stored relative to the defaults, so new default instruments still appear. */
const STORAGE_KEY = 'space-sim.presentation/1';
interface Choices { readonly off: readonly string[]; readonly on: readonly string[] }
const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string').slice(0, 64) : [];
function stored(): Choices {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, unknown> | null;
    return { off: ids(value?.off), on: ids(value?.on) };
  } catch { return { off: [], on: [] }; }
}
function store(choices: Choices): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(choices)); } catch { /* storage unavailable: choices last for this page */ }
}

/** The instruments a new viewer starts with; their dependencies come along through the closure. */
const DEFAULTS: readonly string[] = [...INSTRUMENTS.map(i => i.id), PROCEDURAL_AUDIO.id];

/** A frozen copy of what the pilot sees: hooks can neither observe nor change live objects. */
export function presentationSnapshot(raw: PresentationSnapshot): PresentationSnapshot { return frozenSnapshot(raw); }

/** The browser's presentation profile: the selected renderer provider plus optional
 * presentation modules (layers, panels, camera modes) and their dependencies. Applying a
 * profile never touches the world, its fingerprint or saves; the renderer is rebuilt only
 * when its provider changes. */
export class Presentation {
  readonly audio = mountFlightAudio(element('sound-settings'));
  readonly registry = createPresentationRegistry(PRESENTATION_EXAMPLES);
  readonly runtime = new ModuleRuntime(this.registry, environment());
  readonly rendering: Rendering;
  hooks = new PresentationHooks([], [], []);
  profile: ModuleProfile | undefined;
  /** Primitives drawn by layers in the latest frame. */
  overlayCount = 0;
  /** Modules the viewer switched on; the profile adds what they depend on. */
  private explicit: readonly ModuleReference[] = [];
  private readonly examples = new Set(PRESENTATION_EXAMPLES.map(m => m.manifest.id));
  private imported: RegisteredModule[] = [];
  private readonly panels = new Map<string, { readonly card: HTMLElement; readonly rows: HTMLElement }>();

  constructor(canvas: HTMLCanvasElement, private readonly options: {
    readonly perViewInstruments?: readonly string[];
    readonly onCanvas: (canvas: HTMLCanvasElement) => void; readonly release: () => void; readonly event: EventSink;
  }) {
    const name = (provider: RendererProvider): string => this.registry.getManifest(provider.id)?.name ?? provider.label;
    this.rendering = new Rendering(canvas, name, () => {
      const shaders = BUILTIN_RENDERERS.find(p => p.capabilities.shaders);
      return shaders && name(shaders);
    });
    this.rendering.bindControls({
      toggle: () => this.toggleRenderer(),
      useShaderRenderer: () => {
        const provider = BUILTIN_RENDERERS.find(p => p.capabilities.shaders);
        if (!provider) throw new Error('No installed renderer accepts shader packs.');
        this.useRenderer(provider);
      },
      event: (kind, detail) => options.event(kind, detail),
    });
    element('presentation-list').addEventListener('change', event => {
      const input = event.target as HTMLInputElement;
      if (input.dataset.module) this.setEnabled(input.dataset.module, input.checked);
    });
    element('instruments').addEventListener('click', event => {
      const id = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-instrument]')?.dataset.instrument;
      if (id) this.setEnabled(id, !this.isEnabled(id));
    });
  }

  install(module: RegisteredModule): void {
    if (module.manifest.authority !== 'presentation') throw new Error('Expected a presentation module');
    this.registry.register(module);
    this.imported.push(module);
    this.syncControls();
  }
  remove(id: string): void {
    if (this.isEnabled(id)) throw new Error(`Disable ${id} before removing it`);
    this.registry.unregister(id);
    this.imported = this.imported.filter(m => m.manifest.id !== id);
    this.syncControls();
  }
  /** Replace a game's imported presentation plugins as one candidate. Failed preparation
   * restores the registry and leaves the currently active hooks intact. */
  applyGame(modules: readonly RegisteredModule[], profile: ModuleProfile): void {
    const previous = this.imported;
    for (const module of previous) this.registry.unregister(module.manifest.id);
    const added: string[] = [];
    try {
      for (const module of modules) { this.registry.register(module); added.push(module.manifest.id); }
      this.apply(profile);
      this.imported = [...modules];
      this.explicit = this.enabled;
    } catch (error) {
      for (const id of added) this.registry.unregister(id);
      for (const module of previous) this.registry.register(module);
      throw error;
    }
  }
  compatibleGameProfile(profile: ModuleProfile): ModuleProfile {
    if (profile.providers.renderer !== WEBGL_RENDERER.id || !this.rendering.unavailable.has(WEBGL_RENDERER.id)) return profile;
    return { ...profile, providers: { ...profile.providers, renderer: CANVAS_RENDERER.id },
      modules: profile.modules.some(m => m.id === CANVAS_RENDERER.id) ? profile.modules
        : [...profile.modules, { id: CANVAS_RENDERER.id, version: CANVAS_RENDERER.version }] };
  }
  setSettings(id: string, settings: Readonly<Record<string, number>>): void {
    if (!this.profile) throw new Error('Presentation has not started');
    this.apply({ ...this.profile, settings: { ...this.profile.settings, [id]: settings } });
  }
  get provider(): RendererProvider { return this.rendering.provider!; }
  /** Optional presentation modules installed in this build (renderer providers excluded). */
  get installed(): readonly ModuleManifest[] {
    return [...this.registry.manifests.values()].filter(m => !m.slots.includes('renderer')).sort((a, b) => a.id.localeCompare(b.id));
  }
  /** Enabled optional modules, dependencies included. */
  get enabled(): readonly ModuleReference[] {
    return (this.profile?.modules ?? []).filter(m => !this.registry.getManifest(m.id)?.slots.includes('renderer'));
  }
  isEnabled(id: string): boolean { return this.enabled.some(m => m.id === id); }
  get cameras(): readonly CameraExtension[] { return this.hooks.cameras.filter(c => this.hooks.enabled(c.id)); }

  /** The default instruments, less any this viewer switched off, plus any they (or `requested`,
   * from `?presentation=`) switched on. `none` starts from no optional modules at all.
   * WebGL first, then Canvas. */
  start(requested: readonly string[] = []): void {
    const choices = stored();
    const base = requested.includes('none') ? [] : DEFAULTS.filter(id => !choices.off.includes(id));
    const ids = [...new Set([...base, ...(requested.includes('none') ? [] : choices.on), ...requested.filter(id => id !== 'none')])];
    const wanted = ids.flatMap(id => { const m = this.registry.getManifest(id); return m && !m.slots.includes('renderer') ? [{ id, version: m.version }] : []; });
    const unknown = ids.filter(id => !wanted.some(m => m.id === id));
    let moduleError: unknown = unknown.length ? new Error(`not installed: ${unknown.join(', ')}`) : undefined, last: unknown;
    // Then the default instruments, then the bare renderer, so a broken module never blocks play.
    const defaults = DEFAULTS.flatMap(id => { const m = this.registry.getManifest(id); return m ? [{ id, version: m.version }] : []; });
    const key = (refs: readonly ModuleReference[]): string => refs.map(m => m.id).join();
    const attempts = [wanted, defaults, []].filter((a, i, all) => all.findIndex(b => key(b) === key(a)) === i);
    for (const explicit of attempts) {
      for (const provider of [WEBGL_RENDERER, CANVAS_RENDERER]) {
        try {
          this.apply(presentationProfile(provider.id, this.registry.closure(explicit)));
          this.explicit = explicit;
          if (explicit !== wanted || moduleError) show('presentation-status', `Some presentation modules were not enabled: ${message(moduleError)}`);
          return;
        } catch (error) {
          last = error;
          if (explicit === wanted && provider === CANVAS_RENDERER) moduleError ??= error;
        }
      }
    }
    throw last;
  }

  /** Resolve and build a candidate, then swap. Any failure leaves the active presentation intact. */
  apply(profile: ModuleProfile): void {
    const candidate: ModuleCandidate = this.runtime.prepare(profile, ['renderer']);
    try {
      const provider = candidate.service<RendererProvider>('renderer');
      const hooks = new PresentationHooks(candidate.layers.filter(layer=>!this.options.perViewInstruments?.includes(layer.moduleId)), candidate.panels, candidate.cameras, fault => this.fault(fault));
      if (provider !== this.rendering.provider) {
        const previous = this.rendering.provider;
        this.rendering.replace(provider, this.options.release);
        this.options.onCanvas(this.rendering.canvas);
        if (previous) this.options.event('renderer-switch', { renderer: provider.id });
      }
      this.runtime.activate(candidate);
      this.audio.setProvider(candidate.lock.providers.audio ? candidate.service<AudioProvider>('audio') : undefined);
      this.hooks = hooks;
      this.profile = profile;
    } catch (error) {
      if (this.runtime.active !== candidate) candidate.dispose();
      throw error;
    }
    this.overlayCount = 0;
    this.buildPanels();
    this.syncControls();
  }

  useRenderer(provider: RendererProvider): void {
    if (provider === this.rendering.provider) return;
    this.apply({ ...presentationProfile(provider.id, this.enabled, this.profile?.providers.audio), settings: this.profile?.settings ?? {} });
  }
  toggleRenderer(): void {
    const index = BUILTIN_RENDERERS.indexOf(this.provider);
    this.useRenderer(BUILTIN_RENDERERS[(index + 1) % BUILTIN_RENDERERS.length]!);
  }

  /** Switch one optional module without touching the renderer or the world. Enabling also
   * enables what it depends on; disabling also disables the modules that need it, and drops
   * dependencies nothing else needs. */
  setEnabled(id: string, on: boolean): void {
    const manifest = this.registry.getManifest(id);
    const before = new Set(this.enabled.map(m => m.id));
    let next = this.explicit.filter(m => m.id !== id), dependents: string[] = [];
    try {
      if (!manifest || manifest.slots.includes('renderer')) throw new Error(`Module ${id} is not an optional presentation module`);
      if (on) next = [...next, { id, version: manifest.version }];
      else {
        dependents = next.filter(m => this.registry.closure([m]).some(d => d.id === id)).map(m => m.id);
        next = next.filter(m => !dependents.includes(m.id));
      }
      const audio = manifest.slots.includes('audio') ? (on ? id : undefined) : this.profile?.providers.audio;
      const profile = presentationProfile(this.provider.id, this.registry.closure(next), audio);
      this.apply({ ...profile, settings: Object.fromEntries(Object.entries(this.profile?.settings ?? {}).filter(([id]) => profile.modules.some(m => m.id === id))) });
    } catch (error) {
      show('presentation-status', `${manifest?.name ?? id} could not be ${on ? 'enabled' : 'disabled'}: ${message(error)}`);
      this.syncControls();
      return;
    }
    this.explicit = next;
    const chosen = next.map(m => m.id);
    store({ off: DEFAULTS.filter(m => !chosen.includes(m)), on: chosen.filter(m => !DEFAULTS.includes(m)) });
    const after = new Set(this.enabled.map(m => m.id));
    const added = [...after].filter(m => !before.has(m) && m !== id), removed = [...before].filter(m => !after.has(m) && m !== id);
    show('presentation-status', on
      ? `${manifest.name} enabled${added.length ? ` with ${this.names(added)}, which it needs` : ''}. The world and its saves are unchanged.`
      : `${manifest.name} disabled${dependents.length ? `, with ${this.names(dependents)}, which ${dependents.length === 1 ? 'needs' : 'need'} it` : ''}`
        + `${removed.filter(m => !dependents.includes(m)).length ? `; ${this.names(removed.filter(m => !dependents.includes(m)))} no longer needed` : ''}.`);
    this.options.event('presentation-module', { module: id, enabled: on, modules: [...after] });
  }

  /** This frame's validated layer output; undefined (and no snapshot built) when no layer draws. */
  overlays(view: () => PresentationView): readonly OverlayPrimitive[] | undefined {
    if (!this.hooks.drawsLayers) { this.overlayCount = 0; return undefined; }
    const primitives = this.hooks.overlays(view());
    this.overlayCount = primitives.length;
    return primitives.length ? primitives : undefined;
  }
  camera(id: string, input: () => CameraInput): CameraTarget | undefined {
    return this.hooks.enabled(id) && this.hooks.cameras.some(c => c.id === id) ? this.hooks.camera(id, input()) : undefined;
  }
  /** Panel rows at most four times a second; text is written only when it changes. */
  updatePanels(view: () => PresentationView): void {
    if (!this.hooks.updatesPanels) return;
    for (const { extension, rows } of this.hooks.panelRows(view())) {
      const panel = this.panels.get(extension.id);
      if (!panel) continue;
      while (panel.rows.children.length > rows.length) panel.rows.lastElementChild!.remove();
      rows.forEach((row, i) => {
        let line = panel.rows.children[i] as HTMLElement | undefined;
        if (!line) {
          line = document.createElement('div');
          line.className = 'flight-state';
          line.append(document.createElement('span'), document.createElement('output'));
          panel.rows.append(line);
        }
        const value = row.unit ? `${row.value} ${row.unit}` : row.value;
        const [label, output] = [line.firstElementChild!, line.lastElementChild!];
        if (label.textContent !== row.label) label.textContent = row.label;
        if (output.textContent !== value) output.textContent = value;
      });
    }
  }

  diagnostics(): Record<string, unknown> {
    return { profile: this.profile?.id ?? null, renderer: this.provider.id, modules: this.enabled.map(m => m.id),
      chosen: this.explicit.map(m => m.id),
      layers: this.hooks.layers.filter(l => this.hooks.enabled(l.id)).map(l => l.id),
      panels: this.hooks.panels.filter(p => this.hooks.enabled(p.id)).map(p => p.id),
      cameras: this.cameras.map(c => c.id), overlayPrimitives: this.overlayCount, faults: this.hooks.faults };
  }

  dispose(): void {
    this.audio.dispose();
    this.runtime.dispose();
    this.rendering.dispose();
    for (const { card } of this.panels.values()) card.remove();
    this.panels.clear();
  }

  private names(ids: readonly string[]): string {
    const names = ids.map(id => this.registry.getManifest(id)?.name ?? id);
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  }

  private buildPanels(): void {
    for (const { card } of this.panels.values()) card.remove();
    this.panels.clear();
    const container = element('module-panels');
    for (const panel of this.hooks.panels) {
      const card = document.createElement('section');
      card.className = 'card module-panel';
      card.dataset.panel = panel.id;
      card.setAttribute('aria-label', panel.hook.title);
      const eyebrow = document.createElement('p');
      eyebrow.className = 'eyebrow';
      // Base instruments read as part of the console; anything else is labelled as an add-on.
      eyebrow.textContent = panel.moduleId.startsWith('builtin.') ? 'INSTRUMENT'
        : `ADD-ON · ${(this.registry.getManifest(panel.moduleId)?.name ?? panel.moduleId).toUpperCase()}`;
      const title = document.createElement('h2');
      title.textContent = panel.hook.title;
      const rows = document.createElement('div');
      rows.className = 'module-rows';
      card.append(eyebrow, title, rows);
      container.append(card);
      this.panels.set(panel.id, { card, rows });
    }
    container.hidden = this.panels.size === 0;
  }

  /** The instrument switches and the full module list, with what each module needs. */
  private syncControls(): void {
    const enabled = new Set(this.enabled.map(m => m.id));
    element('instruments').replaceChildren(...INSTRUMENTS.filter(i => this.registry.getManifest(i.id)).map(instrument => {
      const button = document.createElement('button');
      button.type = 'button'; button.dataset.instrument = instrument.id; button.title = instrument.title;
      button.setAttribute('aria-pressed', String(enabled.has(instrument.id)));
      button.textContent = instrument.label;
      return button;
    }));
    const installed = this.installed;
    element('presentation-list').replaceChildren(...installed.map(m => {
      const item = document.createElement('li');
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox'; box.dataset.module = m.id; box.checked = enabled.has(m.id);
      const detail = document.createElement('small');
      detail.textContent = `${m.id} ${m.version}`;
      label.append(box, ` ${m.name}`, detail);
      const users = installed.filter(other => enabled.has(other.id) && other.dependencies.some(d => d.id === m.id)).map(o => o.id);
      const notes = [
        ...(this.examples.has(m.id) ? ['Example'] : []),
        ...(m.dependencies.length ? [`Needs ${this.names(m.dependencies.map(d => d.id))}`] : []),
        ...(users.length ? [`Used by ${this.names(users)}`] : []),
      ];
      item.append(label);
      if (notes.length) {
        const note = document.createElement('p');
        note.className = 'module-note';
        note.textContent = notes.join(' · ');
        item.append(note);
      }
      return item;
    }));
    show('presentation-name', installed.filter(m => enabled.has(m.id)).map(m => m.name).join(', ') || 'Built-in');
  }

  private fault(fault: PresentationFault): void {
    this.panels.get(fault.hook)?.card.remove();
    this.panels.delete(fault.hook);
    show('presentation-status', `${fault.kind} ${fault.hook} was disabled: ${fault.message}`);
    this.options.event('presentation-fault', { ...fault });
  }
}
