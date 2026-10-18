import { APPEARANCE_TUNING, type WorldRead, type AppearanceStyle, type AppearanceTuning, type BodyAppearance,
 type ResolvedBody, type BodyPreview, type RenderBody, type RotationMath, type PlanetDesignerOptions } from '@space-sim/game-api';
import { COLOR_ROLES, PLANET_PRESETS, STAR_PRESETS, TUNING_LABELS, type PlanetPreset } from './planet-presets';
const message = (error: unknown): string => error instanceof Error ? error.message : String(error);
export interface PlanetDesignerServices { readonly rotation: RotationMath; preview?(canvas: HTMLCanvasElement): BodyPreview }
export interface PlanetDesignerTuning { readonly previewSpinSeconds?: number; readonly sunDegrees?: number; readonly importMaxBytes?: number }

type Look = BodyAppearance & { readonly colors: readonly [string, string, string, string] };
/** A design kept in My planets. */
interface SavedDesign { readonly id: string; readonly name: string; readonly appearance: Look }

/** Looks applied to bodies, and the My planets library: per-browser conveniences, never shared or
 * saved with worlds. Applied looks are keyed by universe, system and body, so the same body id
 * in another universe keeps its own look. */
const APPLIED_KEY = 'space-sim.planet-looks/1';
const LIBRARY_KEY = 'space-sim.planet-library/1';
/** Exported library files. */
const LIBRARY_FORMAT = 'space-sim-planets/1';
const STYLES: readonly AppearanceStyle[] = ['oceanic', 'arid', 'rocky', 'icy', 'volcanic', 'banded', 'hazy'];
const STYLE_NAMES: Record<AppearanceStyle, string> = { oceanic: 'Ocean world', arid: 'Desert', rocky: 'Rocky',
  icy: 'Icy', volcanic: 'Volcanic', banded: 'Banded giant', hazy: 'Cloud-covered', star: 'Star' };

/** A stored or imported look, if it is well formed (storage and files are the viewer's to edit). */
function validLook(value: unknown): Look | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (!(STYLES as readonly unknown[]).includes(v.style) && v.style !== 'star') return undefined;
  if (!Array.isArray(v.colors) || v.colors.length !== 4 || !v.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return undefined;
  if (v.seed !== undefined && !(typeof v.seed === 'number' && v.seed >= 0 && v.seed <= 1000)) return undefined;
  for (const key of APPEARANCE_TUNING) if (v[key] !== undefined && !(typeof v[key] === 'number' && v[key] >= 0 && v[key] <= 1)) return undefined;
  return value as Look;
}

/** Only the appearance fields, in a stable order: what is stored, compared and exported. */
function clean(look: Look): Look {
  const out: Record<string, unknown> = { style: look.style, colors: [...look.colors] };
  if (look.seed !== undefined) out.seed = look.seed;
  for (const key of APPEARANCE_TUNING) if (look[key] !== undefined) out[key] = look[key];
  return out as unknown as Look;
}
const same = (a: Look | undefined, b: Look | undefined): boolean => !!a && !!b && JSON.stringify(clean(a)) === JSON.stringify(clean(b));

/** Designs from storage or an imported file; malformed entries are dropped. */
function validDesigns(value: unknown): SavedDesign[] {
  const list = Array.isArray(value) ? value : value && typeof value === 'object' ? (value as { designs?: unknown }).designs : undefined;
  if (!Array.isArray(list)) return [];
  return list.flatMap(item => {
    const d = item as Record<string, unknown> | null;
    const look = validLook(d?.appearance);
    const name = typeof d?.name === 'string' ? d.name.trim().slice(0, 40) : '';
    return look && name ? [{ id: typeof d!.id === 'string' ? d!.id : newId(), name, appearance: clean(look) }] : [];
  });
}
const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Small random change to a colour, so a randomised planet is a sibling of its preset. */
function jitter(hex: string, amount: number, random: () => number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + (random() - .5) * 2 * amount))).toString(16).padStart(2, '0');
  const k = 1 + (random() - .5) * amount / 128;
  return `#${c((n >> 16) * k)}${c(((n >> 8) & 255) * k)}${c((n & 255) * k)}`;
}

/** The planet designer. Edits change a draft shown in the preview; Apply puts it on the selected
 * body, Restore original takes it off, and My planets keeps named designs to reuse, export and
 * import. The preview uses the game's own scene shader. Presentation only: physics, saves and
 * multiplayer never see a design. */
export class PlanetDesigner {
  private applied: Record<string, Look> = {};
  private library: SavedDesign[] = [];
  private preview: BodyPreview | undefined;
  private previewStatus = '';
  private disposed = false;
  private readonly root: HTMLElement;
  private readonly events: AbortController;
  private readonly prefix: string;
  private readonly view: Window;
  private readonly previewSpinSeconds: number;
  private readonly importMaxBytes: number;
  private readonly previous: Node[];
  private read(key: string): unknown { try { return JSON.parse(this.options.storage?.getItem(key) ?? 'null') as unknown; } catch { return null; } }
  private write(key: string, value: unknown): void { try { this.options.storage?.setItem(key, JSON.stringify(value)); } catch { /* viewer storage unavailable: keep this instance */ } }
  private world(): WorldRead { return this.options.world(); }
  private current(): string | undefined { return this.options.current?.(); }
  private html = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
    const node = this.root.ownerDocument.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), event => { if (!this.disposed && node.isConnected) (value as EventListener).call(node, event); });
      else Object.assign(node, { [key]: value });
    }
    node.append(...children); return node;
  };
  private swatch(look: Look): HTMLSpanElement {
    const node = this.html('span', { className: 'designer-swatch' }), [a,b,c] = look.colors;
    node.style.background = `conic-gradient(${a} 0 50%, ${b} 50% 75%, ${c} 75%)`; return node;
  }
  private bodyId = '';
  private draft: Look | undefined;
  private frame = 0;
  private readonly started = performance.now();
  private readonly ui;

  constructor(private readonly services: PlanetDesignerServices, private readonly options: PlanetDesignerOptions, tuning: PlanetDesignerTuning = {}) {
    this.view = options.root.ownerDocument.defaultView!;
    this.events = new (this.view as unknown as { AbortController: typeof AbortController }).AbortController();
    this.root = options.root.ownerDocument.createElement('div'); this.root.className = 'planet-designer-content';
    this.prefix = options.idPrefix ?? 'designer';
    this.previewSpinSeconds = tuning.previewSpinSeconds ?? 20; this.importMaxBytes = tuning.importMaxBytes ?? 1048576;
    const sun = tuning.sunDegrees ?? 120;
    if (!Number.isFinite(this.previewSpinSeconds) || this.previewSpinSeconds < 1 || this.previewSpinSeconds > 120 || !Number.isFinite(sun) || sun < 0 || sun > 360 || !Number.isInteger(this.importMaxBytes) || this.importMaxBytes < 1024 || this.importMaxBytes > 8388608) throw new Error('Invalid planet designer configuration');
    const stored = this.read(APPLIED_KEY);
    if (stored && typeof stored === 'object' && !Array.isArray(stored)) this.applied = Object.fromEntries(Object.entries(stored).flatMap(([key,value]) => { const look = validLook(value); return look ? [[key,clean(look)]] : []; }));
    this.library = validDesigns(this.read(LIBRARY_KEY));
    this.previous = [...options.root.childNodes];
    const canvas = this.html('canvas', { className: 'planet-preview', width: 260, height: 260 });
    canvas.setAttribute('aria-label', 'Planet preview');
    const button = (text: string, onclick: () => void, title = '') => this.html('button', { type: 'button', textContent: text, onclick, title });
    const status = this.html('p', { className: 'designer-status' });
    status.setAttribute('role', 'status');
    const importFile = this.html('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const ui = {
      canvas, status, importFile,
      body: this.html('select', { id: this.prefix + '-body' }),
      style: this.html('select', { id: this.prefix + '-style' }),
      presets: this.html('div', { className: 'designer-presets' }),
      colors: this.html('div', { className: 'designer-colors' }),
      tuning: this.html('div', { className: 'designer-tuning' }),
      seed: this.html('input', { type: 'number', min: '0', max: '1000', step: '0.1', id: this.prefix + '-seed', placeholder: 'auto' }),
      sun: this.html('input', { type: 'range', min: '0', max: '360', value: String(sun), id: this.prefix + '-sun' }),
      spin: this.html('input', { type: 'checkbox', checked: true, id: this.prefix + '-spin' }),
      lit: this.html('input', { type: 'checkbox', checked: true, id: this.prefix + '-lit' }),
      apply: button('Apply', () => this.apply(), 'Put this design on the selected body'),
      restore: button('Restore original', () => this.restore(), 'Take the design off and show the body as it was made'),
      name: this.html('input', { type: 'text', maxLength: 40, placeholder: 'Name this design', id: this.prefix + '-name' }),
      library: this.html('div', { className: 'designer-library' }),
    };
    ui.apply.className = 'primary';
    this.ui = ui;

    this.root.append(
      this.html('p', { className: 'designer-intro', textContent: 'Edit a design in the preview, then Apply it to a body. Save designs to My planets to reuse them or share them as a file. Designs are kept in this browser and never change physics.' }),
      this.html('label', {}, 'Body ', ui.body),
      this.html('div', { className: 'designer-stage' }, canvas,
        this.html('div', { className: 'designer-view' },
          this.html('label', {}, 'Sun ', ui.sun),
          this.html('label', {}, ui.lit, ' Lit'), this.html('label', {}, ui.spin, ' Spin'))),
      this.html('h3', { textContent: 'Presets' }), ui.presets,
      this.html('div', { className: 'designer-row' }, this.html('label', {}, 'Style ', ui.style),
        this.html('label', {}, 'Seed ', ui.seed), button('🎲', () => this.edit({ seed: Math.round(Math.random() * 10000) / 10 }), 'New random seed'),
        button('Randomise', () => this.randomise(), 'A random design of a kind that suits this body')),
      ui.colors, ui.tuning,
      this.html('div', { className: 'designer-actions' }, ui.apply, ui.restore),
      this.html('h3', { textContent: 'My planets' }),
      this.html('div', { className: 'designer-row' }, ui.name, button('Save design', () => this.save(), 'Keep this design in My planets')),
      ui.library,
      this.html('div', { className: 'designer-actions' },
        button('Export My planets', () => this.exportLibrary(), 'Save every design to a file you can share'),
        button('Import…', () => ui.importFile.click(), 'Add designs from a file'), importFile,
        button('Copy JSON', () => void this.copy(), 'Copy the appearance block for a universe file'),
        button('Download PNG', () => this.png(), 'Save the preview as an image')),
      status);

    ui.body.addEventListener('change', () => this.select(ui.body.value), { signal: this.events.signal });
    ui.style.addEventListener('change', () => this.edit({ style: ui.style.value as AppearanceStyle }), { signal: this.events.signal });
    ui.seed.addEventListener('change', () => { const v = Number(ui.seed.value); if (v >= 0 && v <= 1000) this.edit({ seed: v }); }, { signal: this.events.signal });
    for (const input of [ui.sun, ui.lit, ui.spin]) input.addEventListener('input', () => this.loop(), { signal: this.events.signal });
    importFile.addEventListener('change', () => void this.importLibrary(), { signal: this.events.signal });
    options.root.replaceChildren(this.root);
    this.root.closest('details')?.addEventListener('toggle', () => this.open(), { signal: this.events.signal });
  }

  /** The look to draw a body with: the applied design, else its own. */
  appearanceFor(world: WorldRead, body: ResolvedBody): ResolvedBody['appearance'] {
    if (this.disposed) return body.appearance;
    return (this.applied[this.key(world, body.id)] as ResolvedBody['appearance'] | undefined) ?? body.appearance;
  }

  /** Rebuild the body list, for example after the world or system changed. */
  refresh(): void {
    if (this.disposed) return;
    const world = this.world(), bodies = world.system.getAllBodies();
    const here = this.current();
    const keep = bodies.some(b => b.id === this.bodyId) ? this.bodyId : bodies.some(b => b.id === here) ? here!
      : (bodies.find(b => b.surfaceFeatures !== 'star') ?? bodies[0])!.id;
    this.ui.body.replaceChildren(...bodies.map(b => this.html('option', { value: b.id,
      textContent: `${b.name}${this.applied[this.key(world, b.id)] ? ' · designed' : ''}` })));
    this.select(keep);
  }

  private key(world: WorldRead, bodyId: string): string { return `${world.universe.id}/${world.systemId}/${bodyId}`; }
  private target(): ResolvedBody { return this.world().body(this.bodyId); }
  private isStar(): boolean { return this.target().surfaceFeatures === 'star'; }
  /** What the body shows now: its applied design, else its own look. */
  private shown(): Look { return (this.applied[this.key(this.world(), this.bodyId)] ?? clean(this.target().appearance)) as Look; }

  open(): void {
    if (this.disposed) return;
    const details = this.root.closest('details');
    if (details && !details.open) { this.view.cancelAnimationFrame(this.frame); return; }
    if (!this.preview) {
      try { this.preview = this.services.preview?.(this.ui.canvas); this.previewStatus = this.preview ? '' : 'Preview provider absent. Designs still apply in flight.'; }
      catch (error) { this.previewStatus = `Preview failed: ${message(error)} Designs still apply in flight.`; }
    }
    this.bodyId = ''; // open on the body the pilot is at
    this.refresh();
  }

  private loop(): void {
    this.view.cancelAnimationFrame(this.frame);
    const tick = () => {
      // Only while the designer can be seen.
      if (this.disposed || !this.root.isConnected || this.root.closest('details')?.open === false || this.root.offsetParent === null) return;
      this.draw();
      if (this.preview?.error) { this.ui.status.textContent = `Preview unavailable: ${this.preview.error} Designs still apply in flight.`; return; }
      if (this.preview && (this.ui.spin.checked || !this.preview.ready)) this.frame = this.view.requestAnimationFrame(tick);
    };
    tick();
  }

  private select(bodyId: string): void {
    this.bodyId = bodyId;
    this.ui.body.value = bodyId;
    this.draft = this.shown();
    this.ui.presets.replaceChildren(...(this.isStar() ? STAR_PRESETS : PLANET_PRESETS).map(p => this.presetButton(p)));
    this.ui.style.replaceChildren(...(this.isStar() ? ['star' as const] : STYLES).map(s => this.html('option', { value: s, textContent: STYLE_NAMES[s] })));
    this.syncLibrary();
    this.sync();
  }

  private presetButton(preset: PlanetPreset): HTMLButtonElement {
    return this.html('button', { type: 'button', className: 'designer-preset', title: `Start from ${preset.name}`,
      onclick: () => {
        this.ui.name.value = preset.name;
        this.setDraft({ ...preset.appearance, seed: this.draft?.seed ?? Math.round(Math.random() * 10000) / 10 });
      } },
    this.swatch(preset.appearance), preset.name);
  }

  /** Show the draft in the controls. */
  private sync(): void {
    const look = this.draft!;
    this.ui.style.value = look.style;
    this.ui.seed.value = String(look.seed ?? '');
    const roles = COLOR_ROLES[look.style];
    this.ui.colors.replaceChildren(...look.colors.map((color, i) => {
      const input = this.html('input', { type: 'color', value: color });
      input.oninput = () => { if (this.disposed || !input.isConnected) return;
        const colors = [...this.draft!.colors] as [string, string, string, string];
        colors[i] = input.value;
        this.edit({ colors });
      };
      return this.html('label', {}, input, ` ${roles[i]}`);
    }));
    const labels = TUNING_LABELS[look.style];
    this.ui.tuning.replaceChildren(...APPEARANCE_TUNING.filter(k => labels[k]).map(key => {
      const input = this.html('input', { type: 'range', min: '0', max: '100', value: String(Math.round((look[key] ?? .5) * 100)) });
      input.oninput = () => { if (!this.disposed && input.isConnected) this.edit({ [key]: Number(input.value) / 100 } as Partial<Record<AppearanceTuning, number>>); };
      return this.html('label', {}, `${labels[key]} `, input);
    }));
    this.syncState();
    this.loop();
  }

  /** Apply button, status line and body list markers. */
  private syncState(message?: string): void {
    const name = this.target().name, designed = !!this.applied[this.key(this.world(), this.bodyId)];
    const pending = !same(this.draft, this.shown());
    this.ui.apply.disabled = !pending;
    this.ui.apply.textContent = `Apply to ${name}`;
    this.ui.restore.disabled = !designed;
    this.ui.status.textContent = (message ?? (pending ? `Draft not applied: ${name} still shows ${designed ? 'your earlier design' : 'its own look'}.`
      : designed ? `${name} shows your design.` : `${name} shows its own look.`)) + (this.previewStatus ? ` ${this.previewStatus}` : '');
    for (const option of this.ui.body.options) {
      const body = this.world().system.getAllBodies().find(b => b.id === option.value);
      if (body) option.textContent = `${body.name}${this.applied[this.key(this.world(), body.id)] ? ' · designed' : ''}`;
    }
  }

  private edit(change: Partial<Look>): void {
    const next = { ...this.draft!, ...change } as Look;
    if (next.style !== this.draft!.style) { this.setDraft(next); return; }
    this.draft = next;
    if (change.seed !== undefined) this.ui.seed.value = String(change.seed);
    this.syncState();
    this.draw();
  }

  /** Replace the whole draft (presets, style changes, loaded designs) and refresh every control. */
  private setDraft(look: Look): void {
    this.draft = clean({ ...look, style: this.isStar() ? 'star' : look.style === 'star' ? 'rocky' : look.style });
    this.sync();
  }

  private apply(): void {
    this.applied[this.key(this.world(), this.bodyId)] = clean(this.draft!);
    this.write(APPLIED_KEY, this.applied);
    this.syncState(`${this.target().name} now shows this design.`);
  }

  private restore(): void {
    delete this.applied[this.key(this.world(), this.bodyId)];
    this.write(APPLIED_KEY, this.applied);
    this.draft = this.shown();
    this.sync();
    this.syncState(`${this.target().name} shows its own look again.`);
  }

  private randomise(): void {
    const pool = this.isStar() ? STAR_PRESETS : PLANET_PRESETS;
    const random = Math.random;
    const base = pool[Math.floor(random() * pool.length)]!;
    const tuning: Partial<Record<AppearanceTuning, number>> = {};
    for (const key of APPEARANCE_TUNING) tuning[key] = Math.round(Math.max(0, Math.min(1, (base.appearance[key] ?? .5) + (random() - .5) * .4)) * 100) / 100;
    this.ui.name.value = `${base.name} variant`;
    this.setDraft({ ...base.appearance, ...tuning, colors: base.appearance.colors.map(c => jitter(c, 28, random)) as unknown as Look['colors'],
      seed: Math.round(random() * 10000) / 10 });
  }

  // ---- My planets ----

  private storeLibrary(): void { this.write(LIBRARY_KEY, this.library); }

  private save(): void {
    const kind = this.isStar() ? 'star' : 'planet';
    const name = this.ui.name.value.trim().slice(0, 40)
      || `My ${kind} ${this.library.filter(d => (d.appearance.style === 'star') === this.isStar()).length + 1}`;
    const existing = this.library.findIndex(d => d.name === name && (d.appearance.style === 'star') === this.isStar());
    const design: SavedDesign = { id: existing >= 0 ? this.library[existing]!.id : newId(), name, appearance: clean(this.draft!) };
    if (existing >= 0) this.library[existing] = design; else this.library.push(design);
    this.storeLibrary();
    this.ui.name.value = name;
    this.syncLibrary();
    this.syncState(existing >= 0 ? `Updated “${name}” in My planets.` : `Saved “${name}” to My planets.`);
  }

  /** The designs that suit the selected body: stars for stars, planets for everything else. */
  private syncLibrary(): void {
    const star = this.isStar();
    const fitting = this.library.filter(d => (d.appearance.style === 'star') === star);
    if (!fitting.length) {
      this.ui.library.replaceChildren(this.html('p', { className: 'designer-intro',
        textContent: star ? 'No saved stars yet.' : 'No saved planets yet. Name a design above and save it.' }));
      return;
    }
    this.ui.library.replaceChildren(...fitting.map(design => {
      const load = this.html('button', { type: 'button', className: 'designer-preset', title: `Edit ${design.name}`,
        onclick: () => { this.ui.name.value = design.name; this.setDraft(design.appearance); } },
      this.swatch(design.appearance), design.name);
      const applyIt = this.html('button', { type: 'button', textContent: 'Apply', title: `Show ${design.name} on the selected body`,
        onclick: () => { this.ui.name.value = design.name; this.setDraft(design.appearance); this.apply(); } });
      const remove = this.html('button', { type: 'button', textContent: '×', title: `Delete ${design.name}`,
        onclick: () => {
          if (!this.options.confirm(`Delete “${design.name}” from My planets?`)) return;
          this.library = this.library.filter(d => d.id !== design.id);
          this.storeLibrary();
          this.syncLibrary();
          this.syncState(`Deleted “${design.name}”.`);
        } });
      remove.setAttribute('aria-label', `Delete ${design.name}`);
      return this.html('div', { className: 'designer-saved' }, load, applyIt, remove);
    }));
  }

  private exportLibrary(): void {
    if (!this.library.length) { this.syncState('My planets is empty: save a design first.'); return; }
    this.options.download('my-planets.json', new Blob([JSON.stringify({ format: LIBRARY_FORMAT,
      designs: this.library.map(({ name, appearance }) => ({ name, appearance })) }, null, 2)], { type: 'application/json' }));
  }

  private async importLibrary(): Promise<void> {
    const file = this.ui.importFile.files?.[0];
    this.ui.importFile.value = '';
    if (!file) return;
    try {
      if (file.size > this.importMaxBytes) throw new Error(`The file exceeds the ${this.importMaxBytes}-byte import limit.`);
      const text = await file.text(); if (this.disposed) return;
      const designs = validDesigns(JSON.parse(text) as unknown);
      if (!designs.length) throw new Error('It holds no planet designs.');
      for (const design of designs) {
        let name = design.name, n = 2;
        while (this.library.some(d => d.name === name)) name = `${design.name} (${n++})`;
        this.library.push({ id: newId(), name, appearance: design.appearance });
      }
      this.storeLibrary();
      this.syncLibrary();
      this.syncState(`Imported ${designs.length} design${designs.length === 1 ? '' : 's'} into My planets.`);
    } catch (error) {
      if (this.disposed) return;
      this.syncState(`Could not import ${file.name}: ${message(error)}`);
    }
  }

  private async copy(): Promise<void> {
    const text = JSON.stringify({ appearance: clean(this.draft!) }, null, 2);
    try { if (!this.options.copy) { this.syncState(text); return; } await this.options.copy(text); if (this.disposed) return; this.syncState('Copied the appearance JSON. Paste it into a body in a universe file.'); }
    catch { if (!this.disposed) this.syncState(text); }
  }

  private png(): void {
    if (!this.preview?.ready) return;
    this.draw();
    const name = (this.ui.name.value.trim() || this.target().name).toLowerCase().replace(/\W+/g, '-');
    this.ui.canvas.toBlob(blob => { if (blob && !this.disposed) this.options.download(`${name}.png`, blob); }, 'image/png');
  }

  private draw(): void {
    if (this.disposed || !this.preview || !this.draft) return;
    if (!this.world().hasBody(this.bodyId)) { this.refresh(); return; } // the world changed underneath
    const body = this.target(), seconds = (performance.now() - this.started) / 1000;
    const angle = Number(this.ui.sun.value) * Math.PI / 180;
    // A turn every configured preview period (20 s by default) in the preview, whatever the body's real day.
    const turn = this.ui.spin.checked ? seconds * 2 * Math.PI / this.previewSpinSeconds : this.services.rotation.spinAngle(body, this.world().time);
    const drawn: RenderBody = {
      id: body.id, name: body.name, position: { x: 0, y: 0 }, radius: body.radius,
      color: body.color, accentColor: body.accentColor, atmosphereColor: body.atmosphereColor,
      horizonColor: body.horizonColor, skyColor: body.skyColor, surfaceFeatures: body.surfaceFeatures,
      rotation: -turn, appearance: this.draft,
      ...(this.ui.lit.checked && body.surfaceFeatures !== 'star' ? { sunDirection: { x: Math.cos(angle), y: Math.sin(angle) } } : {}),
    };
    this.preview.draw(drawn, body.surfaceFeatures === 'star' ? 0.55 : 0.8);
  }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    this.events.abort(); this.view.cancelAnimationFrame(this.frame); this.frame = 0;
    const preview = this.preview; this.preview = undefined; this.draft = undefined; this.applied = {}; this.library = [];
    try { preview?.dispose(); } finally {
      if (this.root.parentNode === this.options.root) this.root.replaceWith(...this.previous);
      else this.root.remove();
      this.previous.length = 0;
    }
  }

}
