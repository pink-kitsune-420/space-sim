import { APPEARANCE_TUNING, spinAngle, type AppearanceStyle, type AppearanceTuning, type BodyAppearance, type ResolvedBody } from '../../../packages/sim-core/src/index';
import type { World } from '../../../packages/sim-core/src/world';
import { PlanetPreview } from '../../../packages/render-2d/src/index';
import type { RenderBody } from '../../../packages/game-api/src/index';
import { COLOR_ROLES, PLANET_PRESETS, STAR_PRESETS, TUNING_LABELS, type PlanetPreset } from './planet-presets';
import { downloadBlob, message } from './ui';

type Look = BodyAppearance & { readonly colors: readonly [string, string, string, string] };

/** Designed looks: a per-browser convenience, never shared or saved with worlds. Keyed by
 * universe, system and body, so the same body id in another universe keeps its own look. */
const STORAGE_KEY = 'space-sim.planet-looks/1';
const STYLES: readonly AppearanceStyle[] = ['oceanic', 'arid', 'rocky', 'icy', 'volcanic', 'banded', 'hazy'];
const STYLE_NAMES: Record<AppearanceStyle, string> = { oceanic: 'Ocean world', arid: 'Desert', rocky: 'Rocky',
  icy: 'Icy', volcanic: 'Volcanic', banded: 'Banded giant', hazy: 'Cloud-covered', star: 'Star' };

/** A stored look, if it is still well formed (storage is the viewer's to edit). */
function validLook(value: unknown): Look | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  if (!(STYLES as readonly unknown[]).includes(v.style) && v.style !== 'star') return undefined;
  if (!Array.isArray(v.colors) || v.colors.length !== 4 || !v.colors.every(c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c))) return undefined;
  if (v.seed !== undefined && !(typeof v.seed === 'number' && v.seed >= 0 && v.seed <= 1000)) return undefined;
  for (const key of APPEARANCE_TUNING) if (v[key] !== undefined && !(typeof v[key] === 'number' && v[key] >= 0 && v[key] <= 1)) return undefined;
  return value as Look;
}

function loadLooks(): Record<string, Look> {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([key, look]) => validLook(look) ? [[key, validLook(look)!]] : []));
  } catch { return {}; }
}

const html = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/** Small random change to a colour, so a randomised planet is a sibling of its preset. */
function jitter(hex: string, amount: number, random: () => number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v + (random() - .5) * 2 * amount))).toString(16).padStart(2, '0');
  const k = 1 + (random() - .5) * amount / 128;
  return `#${c((n >> 16) * k)}${c(((n >> 8) & 255) * k)}${c((n & 255) * k)}`;
}

/** The planet designer: pick a body, start from a preset, tune its look, see it lit and spinning
 * in the game's own shader, and keep it (this browser) or export it (universe JSON, PNG).
 * Presentation only: physics, saves and multiplayer never see a designed look. */
export class PlanetDesigner {
  private looks = loadLooks();
  private preview: PlanetPreview | undefined;
  private bodyId = '';
  private look: Look | undefined;
  private frame = 0;
  private readonly started = performance.now();
  private readonly ui;

  /** `current` names the body the pilot is at, which the designer opens on. */
  constructor(private readonly root: HTMLElement, private readonly world: () => World,
    private readonly current: () => string | undefined = () => undefined) {
    const canvas = html('canvas', { className: 'planet-preview', width: 260, height: 260 });
    canvas.setAttribute('aria-label', 'Planet preview');
    const body = html('select', { id: 'designer-body' });
    const style = html('select', { id: 'designer-style' });
    const presets = html('div', { className: 'designer-presets' });
    const colors = html('div', { className: 'designer-colors' });
    const tuning = html('div', { className: 'designer-tuning' });
    const seed = html('input', { type: 'number', min: '0', max: '1000', step: '0.1', id: 'designer-seed' });
    const sun = html('input', { type: 'range', min: '0', max: '360', value: '120', id: 'designer-sun' });
    const spin = html('input', { type: 'checkbox', checked: true, id: 'designer-spin' });
    const lit = html('input', { type: 'checkbox', checked: true, id: 'designer-lit' });
    const status = html('p', { className: 'designer-status' });
    status.setAttribute('role', 'status');
    const button = (text: string, onclick: () => void, title = '') => html('button', { type: 'button', textContent: text, onclick, title });
    this.ui = { canvas, body, style, presets, colors, tuning, seed, sun, spin, lit, status };

    root.append(
      html('p', { className: 'designer-intro', textContent: 'Design how a planet looks: start from a preset, then tune it. Changes show in flight straight away and are kept in this browser; physics never changes.' }),
      html('label', {}, 'Body ', body),
      html('div', { className: 'designer-stage' }, canvas,
        html('div', { className: 'designer-view' },
          html('label', {}, 'Sun ', sun),
          html('label', {}, lit, ' Lit'), html('label', {}, spin, ' Spin'))),
      html('h3', { textContent: 'Presets' }), presets,
      html('div', { className: 'designer-row' }, html('label', {}, 'Style ', style),
        html('label', {}, 'Seed ', seed), button('🎲', () => this.edit({ seed: Math.round(Math.random() * 10000) / 10 }), 'New random seed')),
      colors, tuning,
      html('div', { className: 'designer-actions' },
        button('Randomise', () => this.randomise(), 'A random planet of a kind that suits this body'),
        button('Restore original', () => this.restore(), 'Drop the designed look'),
        button('Copy JSON', () => void this.copy(), 'Copy the appearance block for a universe file'),
        button('Download PNG', () => this.png(), 'Save the preview as an image')),
      status);

    body.onchange = () => this.select(body.value);
    style.onchange = () => this.edit({ style: style.value as AppearanceStyle });
    seed.onchange = () => { const v = Number(seed.value); if (v >= 0 && v <= 1000) this.edit({ seed: v }); };
    for (const input of [sun, lit, spin]) input.oninput = () => this.draw();
    root.closest('details')?.addEventListener('toggle', () => this.open());
  }

  /** The look to draw a body with: the designed one, else its own. */
  appearanceFor(world: World, body: ResolvedBody): ResolvedBody['appearance'] {
    return (this.looks[this.key(world, body.id)] as ResolvedBody['appearance'] | undefined) ?? body.appearance;
  }

  /** Rebuild the body list, for example after the world or system changed. */
  refresh(): void {
    const world = this.world(), bodies = world.system.getAllBodies();
    const here = this.current();
    const keep = bodies.some(b => b.id === this.bodyId) ? this.bodyId : bodies.some(b => b.id === here) ? here!
      : (bodies.find(b => b.surfaceFeatures !== 'star') ?? bodies[0])!.id;
    this.ui.body.replaceChildren(...bodies.map(b => html('option', { value: b.id,
      textContent: `${b.name}${this.looks[this.key(world, b.id)] ? ' · designed' : ''}` })));
    this.select(keep);
  }

  private key(world: World, bodyId: string): string { return `${world.universe.id}/${world.systemId}/${bodyId}`; }
  private target(): ResolvedBody { return this.world().body(this.bodyId); }
  private isStar(): boolean { return this.target().surfaceFeatures === 'star'; }

  private open(): void {
    const details = this.root.closest('details');
    if (details && !details.open) { cancelAnimationFrame(this.frame); return; }
    this.bodyId = ''; // open on the body the pilot is at
    if (!this.preview) {
      try { this.preview = new PlanetPreview(this.ui.canvas); }
      catch (error) { this.ui.status.textContent = `${message(error)} Designs still apply in flight.`; }
    }
    this.refresh();
    this.loop();
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
    const world = this.world(), body = this.target();
    this.look = (this.looks[this.key(world, bodyId)] as Look | undefined) ?? body.appearance;
    this.ui.presets.replaceChildren(...(this.isStar() ? STAR_PRESETS : PLANET_PRESETS).map(p => this.presetButton(p)));
    this.ui.style.replaceChildren(...(this.isStar() ? ['star' as const] : STYLES).map(s => html('option', { value: s, textContent: STYLE_NAMES[s] })));
    this.sync();
  }

  private presetButton(preset: PlanetPreset): HTMLButtonElement {
    const swatch = html('span', { className: 'designer-swatch' });
    const [a, b, c] = preset.appearance.colors;
    swatch.style.background = `conic-gradient(${a} 0 50%, ${b} 50% 75%, ${c} 75%)`;
    return html('button', { type: 'button', className: 'designer-preset', title: `Start from ${preset.name}`,
      onclick: () => this.apply({ ...preset.appearance, seed: this.look?.seed ?? Math.round(Math.random() * 10000) / 10 }) },
    swatch, preset.name);
  }

  /** Show the current look in the controls. */
  private sync(): void {
    const look = this.look!;
    this.ui.style.value = look.style;
    this.ui.seed.value = String(look.seed ?? '');
    const roles = COLOR_ROLES[look.style];
    this.ui.colors.replaceChildren(...look.colors.map((color, i) => {
      const input = html('input', { type: 'color', value: color });
      input.oninput = () => {
        const colors = [...this.look!.colors] as [string, string, string, string];
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
    const designed = !!this.looks[this.key(this.world(), this.bodyId)];
    this.ui.status.textContent = designed ? `${this.target().name} uses your design.` : `${this.target().name} uses its own look.`;
    this.draw();
  }

  private edit(change: Partial<Look>): void {
    this.apply({ ...this.look!, ...change } as Look, false);
  }

  /** Make `look` the body's design and store it. `full` refreshes every control (presets, style). */
  private apply(look: Look, full = true): void {
    const style = this.isStar() ? 'star' : look.style;
    this.look = { ...look, style };
    this.looks[this.key(this.world(), this.bodyId)] = this.look;
    this.save();
    if (full || look.style !== this.ui.style.value) this.sync(); else this.draw();
    const option = [...this.ui.body.options].find(o => o.value === this.bodyId);
    if (option && !option.textContent!.endsWith(' · designed')) option.textContent += ' · designed';
    this.ui.status.textContent = `${this.target().name} uses your design.`;
  }

  private restore(): void {
    delete this.looks[this.key(this.world(), this.bodyId)];
    this.save();
    this.refresh();
  }

  private randomise(): void {
    const pool = this.isStar() ? STAR_PRESETS : PLANET_PRESETS;
    const random = Math.random;
    const base = pool[Math.floor(random() * pool.length)]!.appearance;
    const tuning: Partial<Record<AppearanceTuning, number>> = {};
    for (const key of APPEARANCE_TUNING) tuning[key] = Math.round(Math.max(0, Math.min(1, (base[key] ?? .5) + (random() - .5) * .4)) * 100) / 100;
    this.apply({ ...base, ...tuning, colors: base.colors.map(c => jitter(c, 28, random)) as unknown as Look['colors'],
      seed: Math.round(random() * 10000) / 10 });
  }

  private exported(): Look {
    const { style, colors, seed } = this.look!;
    const out: Record<string, unknown> = { style, colors: [...colors] };
    if (seed !== undefined) out.seed = seed;
    for (const key of APPEARANCE_TUNING) if (this.look![key] !== undefined) out[key] = this.look![key];
    return out as unknown as Look;
  }

  private async copy(): Promise<void> {
    const text = JSON.stringify({ appearance: this.exported() }, null, 2);
    try { await navigator.clipboard.writeText(text); this.ui.status.textContent = 'Copied the appearance JSON. Paste it into a body in a universe file.'; }
    catch { this.ui.status.textContent = text; }
  }

  private png(): void {
    if (!this.preview) return;
    this.draw();
    this.ui.canvas.toBlob(blob => { if (blob) downloadBlob(`${this.target().name.toLowerCase().replace(/\W+/g, '-')}.png`, blob); }, 'image/png');
  }

  private save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.looks)); } catch { /* storage unavailable: designs last for this page */ }
  }

  private draw(): void {
    if (!this.preview || !this.look) return;
    if (!this.world().hasBody(this.bodyId)) { this.refresh(); return; } // the world changed underneath
    const body = this.target(), seconds = (performance.now() - this.started) / 1000;
    const angle = Number(this.ui.sun.value) * Math.PI / 180;
    // A turn every 20 s in the preview, whatever the body's real day.
    const turn = this.ui.spin.checked ? seconds * Math.PI / 10 : spinAngle(body, this.world().time);
    const drawn: RenderBody = {
      id: body.id, name: body.name, position: { x: 0, y: 0 }, radius: body.radius,
      color: body.color, accentColor: body.accentColor, atmosphereColor: body.atmosphereColor,
      horizonColor: body.horizonColor, skyColor: body.skyColor, surfaceFeatures: body.surfaceFeatures,
      rotation: -turn, appearance: this.look,
      ...(this.ui.lit.checked && body.surfaceFeatures !== 'star' ? { sunDirection: { x: Math.cos(angle), y: Math.sin(angle) } } : {}),
    };
    this.preview.draw(drawn, body.surfaceFeatures === 'star' ? 0.55 : 0.8);
  }
}
