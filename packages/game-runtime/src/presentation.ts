import { validateTileChunkProfile } from '../../game-api/src/index';
/** Host-only (`packages/game-runtime`): presentation hook capture, output limits and fault isolation. Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); modules use `contributeLayer`, `contributePanel` and `contributeCamera`. */
import type {
  CameraExtension, CameraHook, CameraInput, CameraTarget, LayerExtension, LayerHook, MultiViewportCameraFrame, OverlayPrimitive, PanelExtension,
  PanelHook, PanelRow, PresentationContribution, PresentationFault, PresentationView, SubViewportCameraTarget, Vec,
} from '../../game-api/src/index';

/** Most layer, panel or camera hooks per module, for each kind (`8`; `Module <id>: at most 8 <kind> hooks`). Host-only (`packages/game-runtime`). */
export const MAX_PRESENTATION_HOOKS_PER_MODULE = 8;
/** Most primitives one layer may return per frame (`256`). Returning more disables that layer like a thrown error (`layers return at most 256 primitives`). Host-only (`packages/game-runtime`). */
export const MAX_OVERLAY_PRIMITIVES = 256;
/** Most line and clipping points one layer may return per frame, summed over its primitives (`4096`). Host-only (`packages/game-runtime`). */
export const MAX_OVERLAY_POINTS = 4096;
/** Most rows one panel may return per update (`16`). The browser host reads panels at most every 250 ms. Host-only (`packages/game-runtime`). */
export const MAX_PANEL_ROWS = 16;
const MAX_FAULTS = 64;
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const MODULE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/;
const COLOR = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
/** World coordinates reach a full-scale solar system; screen coordinates stay near the viewport. */
const LIMIT = { world: 1e18, screen: 1e6 } as const;

type Kind = PresentationFault['kind'];
const FIELDS: Record<Kind, readonly [label: string, method: string]> = {
  layer: ['label', 'draw'], panel: ['title', 'update'], camera: ['label', 'frame'],
};

function text(value: unknown, max: number, label: string, empty = false): string {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || CONTROL.test(value)) {
    throw new Error(`${label} must be ${empty ? 'at most' : '1–'}${max} printable characters`);
  }
  return value;
}
function record(value: unknown, allowed: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error(`${label}: unknown field ${key}`);
  return value as Record<string, unknown>;
}

/** Validate a presentation hook at registration and freeze its declaration. */
export function capturePresentation<T extends LayerHook | PanelHook | CameraHook>(kind: Kind, moduleId: string, version: string,
  raw: T): PresentationContribution<T> {
  if (!MODULE.test(moduleId)) throw new Error(`Module ${moduleId}: invalid ${kind} namespace`);
  const [labelField, method] = FIELDS[kind];
  const hook = record(raw, ['name', labelField, method], `Module ${moduleId} ${kind}`);
  if (typeof hook.name !== 'string' || !NAME.test(hook.name)) throw new Error(`Module ${moduleId} ${kind}: name must be 1–32 lowercase letters, digits or hyphens`);
  const id = `${moduleId}/${hook.name}`;
  const label = text(hook[labelField], 32, `${kind} ${id} ${labelField}`).trim();
  if (typeof hook[method] !== 'function') throw new Error(`${kind} ${id}: ${method} must be a function`);
  return Object.freeze({ moduleId, version, id, hook: Object.freeze({ name: hook.name, [labelField]: label, [method]: hook[method] }) as unknown as T });
}

function point(raw: unknown, space: 'world' | 'screen', label: string): Vec {
  const p = record(raw, ['x', 'y'], label);
  if (typeof p.x !== 'number' || typeof p.y !== 'number' || !(Math.abs(p.x) <= LIMIT[space]) || !(Math.abs(p.y) <= LIMIT[space])) {
    throw new Error(`${label} must have finite ${space} coordinates`);
  }
  return Object.freeze({ x: p.x, y: p.y });
}
function width(raw: unknown, label: string): number | undefined {
  if (raw === undefined) return undefined;
  if (typeof raw !== 'number' || !(raw >= .5 && raw <= 8)) throw new Error(`${label} width must be 0.5–8 CSS pixels`);
  return raw;
}
function color(raw: unknown, label: string): string {
  if (typeof raw !== 'string' || !COLOR.test(raw)) throw new Error(`${label} color must be #RRGGBB or #RRGGBBAA`);
  return raw;
}

/** One layer's output: a detached, frozen, bounded draw list. At most 256 primitives and 4,096 line/clipping points;
 * lines need two points (three when filled), widths are 0.5–8 CSS pixels, colours `#RRGGBB` or `#RRGGBBAA`,
 * text at most 80 printable characters, world coordinates within 1e18 m and screen coordinates within 1e6 px.
 * Host-only (`packages/game-runtime`). */
export function validateOverlay(raw: unknown): readonly OverlayPrimitive[] {
  if (!Array.isArray(raw) || raw.length > MAX_OVERLAY_PRIMITIVES) throw new Error(`layers return at most ${MAX_OVERLAY_PRIMITIVES} primitives`);
  let points = 0;
  return Object.freeze(raw.map((value, i): OverlayPrimitive => {
    const label = `primitive ${i}`;
    const kind = (value as { kind?: unknown } | null)?.kind;
    const fields = kind === 'line' ? ['kind', 'space', 'points', 'color', 'width', 'closed', 'fill']
      : kind === 'circle' ? ['kind', 'space', 'center', 'radius', 'color', 'width', 'fill']
      : kind === 'text' ? ['kind', 'space', 'at', 'text', 'color', 'align']
      : kind === 'tile-chunk' ? ['kind', 'space', 'origin', 'tileMetres', 'size', 'tiles', 'walls', 'light', 'lightEncoding', 'paletteId', 'color', 'rotationRadians', 'clipPolygon'] : undefined;
    if (!fields) throw new Error(`${label}: kind must be line, circle, text or tile-chunk`);
    const p = record(value, fields, label);
    if (p.space !== 'world' && p.space !== 'screen') throw new Error(`${label}: space must be world or screen`);
    const space = p.space;
    if (kind === 'tile-chunk') {
      if (space !== 'world') throw new Error(`${label}: tile-chunk space must be world`);
      if (typeof p.tileMetres !== 'number' || !(p.tileMetres > 0 && Number.isFinite(p.tileMetres))) {
        throw new Error(`${label}: tileMetres must be positive and finite`);
      }
      if (p.size !== 32) throw new Error(`${label}: size must be 32`);
      if (!(p.tiles instanceof Uint16Array) || p.tiles.length !== 1024) {
        throw new Error(`${label}: tiles must be a Uint16Array of length 1024`);
      }
      if (p.walls !== undefined && (!(p.walls instanceof Uint16Array) || p.walls.length !== 1024)) throw new Error(`${label}: walls must be a Uint16Array of length 1024`);
      if (p.lightEncoding !== undefined && p.lightEncoding !== 'nibble') throw new Error(`${label}: lightEncoding must be nibble`);
      if (p.light !== undefined && (!(p.light instanceof Uint8Array) || p.light.length !== 1024)) {
        throw new Error(`${label}: light must be a Uint8Array of length 1024`);
      }
      if (p.paletteId !== undefined && (typeof p.paletteId !== 'string' || !p.paletteId.length || p.paletteId.length > 64)) {
        throw new Error(`${label}: paletteId must be 1–64 characters`);
      }
      if (p.rotationRadians !== undefined && (typeof p.rotationRadians !== 'number' || !Number.isFinite(p.rotationRadians))) {
        throw new Error(`${label}: rotationRadians must be finite`);
      }
      let clipPolygon: readonly Vec[] | undefined;
      if (p.clipPolygon !== undefined) {
        if (!Array.isArray(p.clipPolygon) || p.clipPolygon.length < 3) throw new Error(`${label}: clipPolygon needs at least three points`);
        points += p.clipPolygon.length;
        if (points > MAX_OVERLAY_POINTS) throw new Error(`layers return at most ${MAX_OVERLAY_POINTS} points`);
        clipPolygon = Object.freeze(p.clipPolygon.map((q, j) => point(q, 'world', `${label} clip point ${j}`)));
      }
      validateTileChunkProfile(p as unknown as Extract<OverlayPrimitive, { kind: 'tile-chunk' }>);
      const c = p.color !== undefined ? color(p.color, label) : undefined;
      return Object.freeze({
        kind,
        space: 'world',
        origin: point(p.origin, 'world', `${label} origin`),
        tileMetres: p.tileMetres,
        ...(p.rotationRadians !== undefined ? { rotationRadians: p.rotationRadians } : {}),
        ...(clipPolygon !== undefined ? { clipPolygon } : {}),
        size: 32 as const,
        tiles: p.tiles,
        ...(p.walls !== undefined ? { walls: p.walls } : {}),
        ...(p.lightEncoding !== undefined ? { lightEncoding: p.lightEncoding } : {}),
        ...(p.light !== undefined ? { light: p.light } : {}),
        ...(p.paletteId !== undefined ? { paletteId: p.paletteId } : {}),
        ...(c !== undefined ? { color: c } : {}),
      });
    }
    const c = color(p.color, label);
    if (kind === 'line') {
      if (!Array.isArray(p.points) || p.points.length < 2) throw new Error(`${label}: lines need at least two points`);
      points += p.points.length;
      if (points > MAX_OVERLAY_POINTS) throw new Error(`layers return at most ${MAX_OVERLAY_POINTS} points`);
      if (p.closed !== undefined && typeof p.closed !== 'boolean') throw new Error(`${label}: closed must be boolean`);
      if (p.fill !== undefined && typeof p.fill !== 'boolean') throw new Error(`${label}: fill must be boolean`);
      if (p.fill && p.points.length < 3) throw new Error(`${label}: filled shapes need at least three points`);
      const w = width(p.width, label);
      return Object.freeze({ kind, space, color: c, points: Object.freeze(p.points.map((q, j) => point(q, space, `${label} point ${j}`))),
        ...(w !== undefined ? { width: w } : {}), ...(p.closed ? { closed: true } : {}), ...(p.fill ? { fill: true } : {}) });
    }
    if (kind === 'circle') {
      if (typeof p.radius !== 'number' || !(p.radius > 0 && p.radius <= LIMIT[space])) throw new Error(`${label}: radius must be positive and finite`);
      if (p.fill !== undefined && typeof p.fill !== 'boolean') throw new Error(`${label}: fill must be boolean`);
      const w = width(p.width, label);
      return Object.freeze({ kind, space, color: c, center: point(p.center, space, `${label} center`), radius: p.radius,
        ...(w !== undefined ? { width: w } : {}), ...(p.fill ? { fill: true } : {}) });
    }
    if (p.align !== undefined && p.align !== 'left' && p.align !== 'center' && p.align !== 'right') throw new Error(`${label}: align must be left, center or right`);
    return Object.freeze({ kind: 'text', space, color: c, at: point(p.at, space, `${label} anchor`), text: text(p.text, 80, `${label} text`),
      ...(p.align ? { align: p.align as 'left' | 'center' | 'right' } : {}) });
  }));
}

/** Validates one panel update: at most 16 rows of `label` (1–32 printable characters), `value` (up to 64) and optional `unit` (up to 32); returns a frozen copy. Host-only (`packages/game-runtime`). */
export function validatePanelRows(raw: unknown): readonly PanelRow[] {
  if (!Array.isArray(raw) || raw.length > MAX_PANEL_ROWS) throw new Error(`panels return at most ${MAX_PANEL_ROWS} rows`);
  return Object.freeze(raw.map((value, i) => {
    const row = record(value, ['label', 'value', 'unit'], `row ${i}`);
    return Object.freeze({ label: text(row.label, 32, `row ${i} label`), value: text(row.value, 64, `row ${i} value`, true),
      ...(row.unit !== undefined ? { unit: text(row.unit, 32, `row ${i} unit`, true) } : {}) });
  }));
}

/** Validates a camera hook result: a world-space `center` in metres (each coordinate within 1e18) and an optional finite `rotation` in radians, or a `MultiViewportCameraFrame` with non-overlapping viewports within [0..1]. Host-only (`packages/game-runtime`). */
export function validateCameraTarget(raw: unknown): CameraTarget | MultiViewportCameraFrame {
  if (raw && typeof raw === 'object' && 'viewports' in (raw as Record<string, unknown>)) {
    const frame = record(raw, ['viewports'], 'multi-viewport camera frame');
    if (!Array.isArray(frame.viewports)) {
      throw new Error('multi-viewport camera frame viewports must be an array');
    }
    if (frame.viewports.length === 0) {
      throw new Error('multi-viewport camera frame viewports must not be empty');
    }
    const validatedViewports: SubViewportCameraTarget[] = [];
    for (let i = 0; i < frame.viewports.length; i++) {
      const v = record(frame.viewports[i], ['seatSlot', 'center', 'rotation', 'rect', 'scale'], `viewport ${i}`);
      if (typeof v.seatSlot !== 'number' || !Number.isInteger(v.seatSlot) || v.seatSlot < 0) {
        throw new Error(`viewport ${i}: seatSlot must be a non-negative integer`);
      }
      const center = point(v.center, 'world', `viewport ${i} center`);
      if (v.rotation !== undefined && (typeof v.rotation !== 'number' || !Number.isFinite(v.rotation))) {
        throw new Error(`viewport ${i}: rotation must be finite radians`);
      }
      if (v.scale !== undefined && (typeof v.scale !== 'number' || !Number.isFinite(v.scale) || v.scale <= 0)) {
        throw new Error(`viewport ${i}: scale must be a positive finite number`);
      }
      const r = record(v.rect, ['x', 'y', 'width', 'height'], `viewport ${i} rect`);
      const x = r.x, y = r.y, w = r.width, h = r.height;
      if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x >= 1) {
        throw new Error(`viewport ${i}: rect x must be in [0, 1)`);
      }
      if (typeof y !== 'number' || !Number.isFinite(y) || y < 0 || y >= 1) {
        throw new Error(`viewport ${i}: rect y must be in [0, 1)`);
      }
      if (typeof w !== 'number' || !Number.isFinite(w) || w <= 0 || w > 1) {
        throw new Error(`viewport ${i}: rect width must be in (0, 1]`);
      }
      if (typeof h !== 'number' || !Number.isFinite(h) || h <= 0 || h > 1) {
        throw new Error(`viewport ${i}: rect height must be in (0, 1]`);
      }
      if (x + w > 1.000001) {
        throw new Error(`viewport ${i}: rect overflows horizontal bounds (x + width > 1)`);
      }
      if (y + h > 1.000001) {
        throw new Error(`viewport ${i}: rect overflows vertical bounds (y + height > 1)`);
      }
      validatedViewports.push(Object.freeze({
        seatSlot: v.seatSlot as number,
        center,
        ...(v.rotation !== undefined ? { rotation: v.rotation as number } : {}),
        ...(v.scale !== undefined ? { scale: v.scale as number } : {}),
        rect: Object.freeze({ x: x as number, y: y as number, width: w as number, height: h as number }),
      }));
    }

    for (let i = 0; i < validatedViewports.length; i++) {
      for (let j = i + 1; j < validatedViewports.length; j++) {
        const a = validatedViewports[i]!.rect;
        const b = validatedViewports[j]!.rect;
        if (a.x < b.x + b.width - 1e-6 && a.x + a.width > b.x + 1e-6 &&
            a.y < b.y + b.height - 1e-6 && a.y + a.height > b.y + 1e-6) {
          throw new Error(`viewport rects must not overlap: viewport ${i} and viewport ${j}`);
        }
      }
    }

    return Object.freeze({ viewports: Object.freeze(validatedViewports) });
  }

  const target = record(raw, ['center', 'rotation'], 'camera target');
  if (target.rotation !== undefined && (typeof target.rotation !== 'number' || !Number.isFinite(target.rotation))) {
    throw new Error('camera rotation must be finite radians');
  }
  return Object.freeze({ center: point(target.center, 'world', 'camera center'),
    ...(target.rotation !== undefined ? { rotation: target.rotation as number } : {}) });
}

/** One validated panel update: the panel contribution and its rows. Host-only (`packages/game-runtime`). */
export interface PanelOutput { readonly extension: PanelExtension; readonly rows: readonly PanelRow[] }

/** A detached, deep-frozen copy of plain snapshot data in one pass. Built every drawn frame,
 * so it avoids structuredClone, which costs several times more for small object graphs. */
export function frozenSnapshot<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return value;
  if (typeof (value as { getPage?: unknown }).getPage === 'function') {
    const store = value as unknown as {
      readonly pageSizeBytes: 1024 | 2048 | 4096;
      getPage(key: string): Uint8Array | undefined;
      hasPage?(key: string): boolean;
      keys?(): IterableIterator<string>;
    };
    return Object.freeze({
      pageSizeBytes: store.pageSizeBytes,
      getPage: (key: string) => store.getPage(key),
      hasPage: (key: string) => (typeof store.hasPage === 'function' ? store.hasPage(key) : store.getPage(key) !== undefined),
      keys: () => (typeof store.keys === 'function' ? store.keys() : [][Symbol.iterator]()),
    }) as unknown as T;
  }
  if (Array.isArray(value)) return Object.freeze(value.map(frozenSnapshot)) as T;
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(value)) copy[key] = frozenSnapshot((value as Record<string, unknown>)[key]);
  return Object.freeze(copy) as T;
}

/** Runs captured presentation hooks with per-contribution fault isolation. DOM-free: the
 * application turns its output into drawing and panels. A failed contribution stays
 * disabled until a new presentation candidate replaces this one. */
export class PresentationHooks {
  private readonly disabled = new Set<string>();
  private readonly failures: PresentationFault[] = [];
  constructor(readonly layers: readonly LayerExtension[], readonly panels: readonly PanelExtension[],
    readonly cameras: readonly CameraExtension[], private readonly onFault: (fault: PresentationFault) => void = () => {}) {}
  get faults(): readonly PresentationFault[] { return this.failures; }
  enabled(id: string): boolean { return !this.disabled.has(id); }
  /** Whether any layer still draws, so callers can skip building a snapshot. */
  get drawsLayers(): boolean { return this.layers.some(l => !this.disabled.has(l.id)); }
  get updatesPanels(): boolean { return this.panels.some(p => !this.disabled.has(p.id)); }
  overlays(view: PresentationView): readonly OverlayPrimitive[] {
    const output: OverlayPrimitive[] = [];
    for (const layer of this.layers) {
      if (this.disabled.has(layer.id)) continue;
      try { output.push(...validateOverlay(layer.hook.draw(view))); } catch (error) { this.fail('layer', layer, error); }
    }
    return output;
  }
  panelRows(view: PresentationView): readonly PanelOutput[] {
    const output: PanelOutput[] = [];
    for (const panel of this.panels) {
      if (this.disabled.has(panel.id)) continue;
      try { output.push({ extension: panel, rows: validatePanelRows(panel.hook.update(view)) }); } catch (error) { this.fail('panel', panel, error); }
    }
    return output;
  }
  /** Undefined when the mode is unknown or has been disabled by a fault. */
  camera(id: string, input: CameraInput): CameraTarget | MultiViewportCameraFrame | undefined {
    const camera = this.cameras.find(c => c.id === id);
    if (!camera || this.disabled.has(id)) return undefined;
    try { return validateCameraTarget(camera.hook.frame(input)); } catch (error) { this.fail('camera', camera, error); return undefined; }
  }
  private fail(kind: Kind, extension: PresentationContribution<unknown>, error: unknown): void {
    this.disabled.add(extension.id);
    const fault = Object.freeze({ moduleId: extension.moduleId, hook: extension.id, kind,
      message: error instanceof Error ? error.message : String(error) });
    if (this.failures.length < MAX_FAULTS) this.failures.push(fault);
    this.onFault(fault);
  }
}
