import type { WorldRead } from '../../../packages/game-api/src/index';
import { APPEARANCE_TUNING, spinAngle, type AppearanceStyle, type AppearanceTuning, type BodyAppearance, type ResolvedBody } from '../../../packages/sim-core/src/index';

import { PlanetPreview } from '../../../packages/render-2d/src/index';
import type { RenderBody } from '../../../packages/game-api/src/index';
import { COLOR_ROLES, PLANET_PRESETS, STAR_PRESETS, TUNING_LABELS, type PlanetPreset } from './planet-presets';
import { download, downloadBlob, message } from './ui';

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

function read(key: string): unknown {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') as unknown; } catch { return null; }
}
function write(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable: kept for this page */ }
}

function loadApplied(): Record<string, Look> {
  const value = read(APPLIED_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([key, look]) => validLook(look) ? [[key, clean(validLook(look)!)]] : []));
}

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

const html = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};
const swatch = (look: Look): HTMLSpanElement => {
  const node = html('span', { className: 'designer-swatch' });
  const [a, b, c] = look.colors;
  node.style.background = `conic-gradient(${a} 0 50%, ${b} 50% 75%, ${c} 75%)`;
  return node;
};

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
  private applied = loadApplied();
  private library = validDesigns(read(LIBRARY_KEY));
  private preview: PlanetPreview | undefined;
  private bodyId = '';
  private draft: Look | undefined;
  private frame = 0;
  private readonly started = performance.now();
  private readonly ui;

  /** `current` names the body the pilot is at, which the designer opens on. */
  constructor(private readonly root: HTMLElement, private readonly world: () => WorldRead,
    private readonly current: () => string | undefined = () => undefined) {
    const canvas = html('canvas', { className: 'planet-preview', width: 260, height: 260 });
    canvas.setAttribute('aria-label', 'Planet preview');
    const button = (text: string, onclick: () => void, title = '') => html('button', { type: 'button', textContent: text, onclick, title });
    const status = html('p', { className: 'designer-status' });
    status.setAttribute('role', 'status');
    const importFile = html('input', { type: 'file', accept: '.json,application/json', hidden: true });
    const ui = {
      canvas, status, importFile,
      body: html('select', { id: 'designer-body' }),
      style: html('select', { id: 'designer-style' }),
      presets: html('div', { className: 'designer-presets' }),
      colors: html('div', { className: 'designer-colors' }),
      tuning: html('div', { className: 'designer-tuning' }),
      seed: html('input', { type: 'number', min: '0', max: '1000', step: '0.1', id: 'designer-seed', placeholder: 'auto' }),
      sun: html('input', { type: 'range', min: '0', max: '360', value: '120', id: 'designer-sun' }),
      spin: html('input', { type: 'checkbox', checked: true, id: 'designer-spin' }),
      lit: html('input', { type: 'checkbox', checked: true, id: 'designer-lit' }),
      apply: button('Apply', () => this.apply(), 'Put this design on the selected body'),
      restore: button('Restore original', () => this.restore(), 'Take the design off and show the body as it was made'),
      name: html('input', { type: 'text', maxLength: 40, placeholder: 'Name this design', id: 'designer-name' }),
      library: html('div', { className: 'designer-library' }),
    };
    ui.apply.className = 'primary';
    this.ui = ui;

    root.append(
      html('p', { className: 'designer-intro', textContent: 'Edit a design in the preview, then Apply it to a body. Save designs to My planets to reuse them or share them as a file. Designs are kept in this browser and never change physics.' }),
      html('label', {}, 'Body ', ui.body),
      html('div', { className: 'designer-stage' }, canvas,
        html('div', { className: 'designer-view' },
          html('label', {}, 'Sun ', ui.sun),
          html('label', {}, ui.lit, ' Lit'), html('label', {}, ui.spin, ' Spin'))),
      html('h3', { textContent: 'Presets' }), ui.presets,
      html('div', { className: 'designer-row' }, html('label', {}, 'Style ', ui.style),
        html('label', {}, 'Seed ', ui.seed), button('🎲', () => this.edit({ seed: Math.round(Math.random() * 10000) / 10 }), 'New random seed'),
        button('Randomise', () => this.randomise(), 'A random design of a kind that suits this body')),
      ui.colors, ui.tuning,
      html('div', { className: 'designer-actions' }, ui.apply, ui.restore),
      html('h3', { textContent: 'My planets' }),
      html('div', { className: 'designer-row' }, ui.name, button('Save design', () => this.save(), 'Keep this design in My planets')),
      ui.library,
      html('div', { className: 'designer-actions' },
        button('Export My planets', () => this.exportLibrary(), 'Save every design to a file you can share'),
        button('Import…', () => ui.importFile.click(), 'Add designs from a file'), importFile,
        button('Copy JSON', () => void this.copy(), 'Copy the appearance block for a universe file'),
        button('Download PNG', () => this.png(), 'Save the preview as an image')),
      status);

    ui.body.onchange = () => this.select(ui.body.value);
    ui.style.onchange = () => this.edit({ style: ui.style.value as AppearanceStyle });
    ui.seed.onchange = () => { const v = Number(ui.seed.value); if (v >= 0 && v <= 1000) this.edit({ seed: v }); };
    for (const input of [ui.sun, ui.lit, ui.spin]) input.oninput = () => this.loop();
    importFile.onchange = () => void this.importLibrary();
    root.closest('details')?.addEventListener('toggle', () => this.open());
  }

  /** The look to draw a body with: the applied design, else its own. */
  appearanceFor(world: WorldRead, body: ResolvedBody): ResolvedBody['appearance'] {
    return (this.applied[this.key(world, body.id)] as ResolvedBody['appearance'] | undefined) ?? body.appearance;
  }

  /** Rebuild the body list, for example after the world or system changed. */
  refresh(): void {
    const world = this.world(), bodies = world.system.getAllBodies();
    const here = this.current();
    const keep = bodies.some(b => b.id === this.bodyId) ? this.bodyId : bodies.some(b => b.id === here) ? here!
      : (bodies.find(b => b.surfaceFeatures !== 'star') ?? bodies[0])!.id;
    this.ui.body.replaceChildren(...bodies.map(b => html('option', { value: b.id,
      textContent: `${b.name}${this.applied[this.key(world, b.id)] ? ' · designed' : ''}` })));
    this.select(keep);
  }

  private key(world: WorldRead, bodyId: string): string { return `${world.universe.id}/${world.systemId}/${bodyId}`; }
  private target(): ResolvedBody { return this.world().body(this.bodyId); }
  private isStar(): boolean { return this.target().surfaceFeatures === 'star'; }
  /** What the body shows now: its applied design, else its own look. */
  private shown(): Look { return (this.applied[this.key(this.world(), this.bodyId)] ?? clean(this.target().appearance)) as Look; }

  private open(): void {
    const details = this.root.closest('details');
    if (details && !details.open) { cancelAnimationFrame(this.frame); return; }
    if (!this.preview) {
      try { this.preview = new PlanetPreview(this.ui.canvas); }
      catch (error) { this.ui.status.textContent = `${message(error)} Designs still apply in flight.`; }
    }
    this.bodyId = ''; // open on the body the pilot is at
    this.refresh();
  }

  private loop(): void {
    cancelAnimationFrame(this.frame);
    const tick = () => {
      // Only while the designer can be seen.
      if (!this.root.isConnected || !this.root.closest('details')?.open || this.root.offsetParent === null) return;
      this.draw();
      if (this.preview?.error) { this.ui.status.textContent = `Preview unavailable: ${this.preview.error} Designs still apply in flight.`; return; }
      if (this.ui.spin.checked || !this.preview?.ready) this.frame = requestAnimationFrame(tick);
    };
    tick();
  }

  private select(bodyId: string): void {
    this.bodyId = bodyId;
    this.ui.body.value = bodyId;
    this.draft = this.shown();
    this.ui.presets.replaceChildren(...(this.isStar() ? STAR_PRESETS : PLANET_PRESETS).map(p => this.presetButton(p)));
    this.ui.style.replaceChildren(...(this.isStar() ? ['star' as const] : STYLES).map(s => html('option', { value: s, textContent: STYLE_NAMES[s] })));
    this.syncLibrary();
    this.sync();
  }

  private presetButton(preset: PlanetPreset): HTMLButtonElement {
    return html('button', { type: 'button', className: 'designer-preset', title: `Start from ${preset.name}`,
      onclick: () => {
        this.ui.name.value = preset.name;
        this.setDraft({ ...preset.appearance, seed: this.draft?.seed ?? Math.round(Math.random() * 10000) / 10 });
      } },
    swatch(preset.appearance), preset.name);
  }

  /** Show the draft in the controls. */
  private sync(): void {
    const look = this.draft!;
    this.ui.style.value = look.style;
    this.ui.seed.value = String(look.seed ?? '');
    const roles = COLOR_ROLES[look.style];
    this.ui.colors.replaceChildren(...look.colors.map((color, i) => {
      const input = html('input', { type: 'color', value: color });
      input.oninput = () => {
        const colors = [...this.draft!.colors] as [string, string, string, string];
        colors[i] = input.value;
        this.edit({ colors });
      };
      return html('label', {}, input, ` ${roles[i]}`);
    }));
    const labels = TUNING_LABELS[look.style];
    this.ui.tuning.replaceChildren(...APPEARANCE_TUNING.filter(k => labels[k]).map(key => {
      const input = html('input', { type: 'range', min: '0', max: '100', value: String(Math.round((look[key] ?? .5) * 100)) });
      input.oninput = () => this.edit({ [key]: Number(input.value) / 100 } as Partial<Record<AppearanceTuning, number>>);
      return html('label', {}, `${labels[key]} `, input);
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
    this.ui.status.textContent = message ?? (pending ? `Draft not applied: ${name} still shows ${designed ? 'your earlier design' : 'its own look'}.`
      : designed ? `${name} shows your design.` : `${name} shows its own look.`);
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
    write(APPLIED_KEY, this.applied);
    this.syncState(`${this.target().name} now shows this design.`);
  }

  private restore(): void {
    delete this.applied[this.key(this.world(), this.bodyId)];
    write(APPLIED_KEY, this.applied);
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

  private storeLibrary(): void { write(LIBRARY_KEY, this.library); }

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
      this.ui.library.replaceChildren(html('p', { className: 'designer-intro',
        textContent: star ? 'No saved stars yet.' : 'No saved planets yet. Name a design above and save it.' }));
      return;
    }
    this.ui.library.replaceChildren(...fitting.map(design => {
      const load = html('button', { type: 'button', className: 'designer-preset', title: `Edit ${design.name}`,
        onclick: () => { this.ui.name.value = design.name; this.setDraft(design.appearance); } },
      swatch(design.appearance), design.name);
      const applyIt = html('button', { type: 'button', textContent: 'Apply', title: `Show ${design.name} on the selected body`,
        onclick: () => { this.ui.name.value = design.name; this.setDraft(design.appearance); this.apply(); } });
      const remove = html('button', { type: 'button', textContent: '×', title: `Delete ${design.name}`,
        onclick: () => {
          if (!confirm(`Delete “${design.name}” from My planets?`)) return;
          this.library = this.library.filter(d => d.id !== design.id);
          this.storeLibrary();
          this.syncLibrary();
          this.syncState(`Deleted “${design.name}”.`);
        } });
      remove.setAttribute('aria-label', `Delete ${design.name}`);
      return html('div', { className: 'designer-saved' }, load, applyIt, remove);
    }));
  }

  private exportLibrary(): void {
    if (!this.library.length) { this.syncState('My planets is empty: save a design first.'); return; }
    download('my-planets.json', JSON.stringify({ format: LIBRARY_FORMAT,
      designs: this.library.map(({ name, appearance }) => ({ name, appearance })) }, null, 2));
  }

  private async importLibrary(): Promise<void> {
    const file = this.ui.importFile.files?.[0];
    this.ui.importFile.value = '';
    if (!file) return;
    try {
      if (file.size > 1024 * 1024) throw new Error('The file is larger than 1 MiB.');
      const designs = validDesigns(JSON.parse(await file.text()) as unknown);
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
      this.syncState(`Could not import ${file.name}: ${message(error)}`);
    }
  }

  private async copy(): Promise<void> {
    const text = JSON.stringify({ appearance: clean(this.draft!) }, null, 2);
    try { await navigator.clipboard.writeText(text); this.syncState('Copied the appearance JSON. Paste it into a body in a universe file.'); }
    catch { this.syncState(text); }
  }

  private png(): void {
    if (!this.preview?.ready) return;
    this.draw();
    const name = (this.ui.name.value.trim() || this.target().name).toLowerCase().replace(/\W+/g, '-');
    this.ui.canvas.toBlob(blob => { if (blob) downloadBlob(`${name}.png`, blob); }, 'image/png');
  }

  private draw(): void {
    if (!this.preview || !this.draft) return;
    if (!this.world().hasBody(this.bodyId)) { this.refresh(); return; } // the world changed underneath
    const body = this.target(), seconds = (performance.now() - this.started) / 1000;
    const angle = Number(this.ui.sun.value) * Math.PI / 180;
    // A turn every 20 s in the preview, whatever the body's real day.
    const turn = this.ui.spin.checked ? seconds * Math.PI / 10 : spinAngle(body, this.world().time);
    const drawn: RenderBody = {
      id: body.id, name: body.name, position: { x: 0, y: 0 }, radius: body.radius,
      color: body.color, accentColor: body.accentColor, atmosphereColor: body.atmosphereColor,
      horizonColor: body.horizonColor, skyColor: body.skyColor, surfaceFeatures: body.surfaceFeatures,
      rotation: -turn, appearance: this.draft,
      ...(this.ui.lit.checked && body.surfaceFeatures !== 'star' ? { sunDirection: { x: Math.cos(angle), y: Math.sin(angle) } } : {}),
    };
    this.preview.draw(drawn, body.surfaceFeatures === 'star' ? 0.55 : 0.8);
  }
}
