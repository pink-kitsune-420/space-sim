/** Licensed local renderer helper; first-party MIT source, see NOTICE. */
/** Screen-space layout shared by the renderers: label decluttering and body ordering. */

/** Approximate advance of one character of the 11 px monospace label font. */
export const LABEL_CHAR_WIDTH = 6.7;
export const LABEL_HEIGHT = 13;
/** Most labels drawn in one frame; beyond this the view is a crowd anyway. */
export const MAX_LABELS = 64;

export interface LabelRect { readonly x: number; readonly y: number; readonly w: number; readonly h: number }

/** Places labels in priority order and refuses any that would overlap one already placed,
 * so a planet with a hundred moons shows its own name instead of a smear of text. Cells
 * of a coarse grid hold the placed rectangles, so each test touches only nearby labels. */
export class LabelPlacer {
  private readonly cells = new Map<number, LabelRect[]>();
  private placed = 0;
  constructor(private readonly limit = MAX_LABELS, private readonly cell = 64) {}

  get count(): number { return this.placed; }

  /** Reserve a rectangle without a label (for example the piloted ship's own label). */
  reserve(rect: LabelRect): void { this.insert(rect); }

  /** True (and reserved) when the rectangle fits. */
  tryPlace(rect: LabelRect, pad = 2): boolean {
    if (this.placed >= this.limit) return false;
    const x0 = rect.x - pad, y0 = rect.y - pad, x1 = rect.x + rect.w + pad, y1 = rect.y + rect.h + pad;
    const cx0 = Math.floor(x0 / this.cell), cx1 = Math.floor(x1 / this.cell);
    const cy0 = Math.floor(y0 / this.cell), cy1 = Math.floor(y1 / this.cell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const list = this.cells.get(cy * 65536 + cx);
        if (!list) continue;
        for (const r of list) {
          if (r.x < x1 && r.x + r.w > x0 && r.y < y1 && r.y + r.h > y0) return false;
        }
      }
    }
    this.insert(rect);
    this.placed++;
    return true;
  }

  private insert(rect: LabelRect): void {
    const cx0 = Math.floor(rect.x / this.cell), cx1 = Math.floor((rect.x + rect.w) / this.cell);
    const cy0 = Math.floor(rect.y / this.cell), cy1 = Math.floor((rect.y + rect.h) / this.cell);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * 65536 + cx;
        let list = this.cells.get(key);
        if (!list) { list = []; this.cells.set(key, list); }
        list.push(rect);
      }
    }
  }
}

/** Bodies processed in label priority order: a smaller body drawn on top of (or within a
 * few pixels of) a bigger one gets no label of its own, even when the bigger body's label
 * did not fit, so a moon never takes its planet's place. */
export class BodyCrowd {
  private readonly seen: { readonly x: number; readonly y: number; readonly r: number }[] = [];
  /** True when this body stands apart from every bigger body already seen; records it. */
  admit(x: number, y: number, r: number, gap = 6): boolean {
    let apart = true;
    for (const b of this.seen) {
      const reach = Math.max(b.r, 0) + gap;
      if ((x - b.x) ** 2 + (y - b.y) ** 2 < reach * reach) { apart = false; break; }
    }
    this.seen.push({ x, y, r });
    return apart;
  }
}

/** Label rectangle for text anchored at (x, baseline y) with the given alignment. */
export function labelRect(text: string, x: number, y: number, align: 'left' | 'center' | 'right'): LabelRect {
  const w = text.length * LABEL_CHAR_WIDTH;
  const left = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  return { x: left, y: y - LABEL_HEIGHT + 3, w, h: LABEL_HEIGHT };
}

/** Segments for a circle of this screen radius with at most ~0.4 px sagitta error. */
export function circleSegments(radius: number): number {
  return Math.max(12, Math.min(256, Math.ceil(Math.PI * Math.sqrt(Math.max(1, radius) / 0.8))));
}
