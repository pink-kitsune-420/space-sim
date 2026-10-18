import { computeNavballCenter, type NavballPlacement } from './local-players';
import { initHudEditor } from './hud-editor';
import { navballFootprint } from '../../../packages/modules/src/base/toolset/navball';
import { THROTTLE_LEVER_SPACE } from './throttle-lever';

export interface HudRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }

/** Nearest free position in a pane, minimizing overlap first if crowded. All units are CSS pixels.
 * Bounded layout-change work; callers cache results rather than searching in the frame loop. */
export function fitHudRect(preferred: HudRect, width: number, height: number, obstacles: readonly HudRect[]): HudRect {
  const clampX = (x: number): number => Math.max(8, Math.min(Math.max(8, width - preferred.width - 8), x));
  const clampY = (y: number): number => Math.max(8, Math.min(Math.max(8, height - preferred.height - 8), y));
  const x = clampX(preferred.x), y = clampY(preferred.y);
  const xs = [x, 8, clampX(width)], ys = [y, 8, clampY(height)];
  for (const r of obstacles) {
    xs.push(clampX(r.x - preferred.width - 8), clampX(r.x + r.width + 8));
    ys.push(clampY(r.y - preferred.height - 8), clampY(r.y + r.height + 8));
  }
  let bestX = x, bestY = y, bestArea = Infinity, bestDistance = Infinity;
  for (const cx of xs) for (const cy of ys) {
    let area = 0;
    for (const r of obstacles) area += Math.max(0, Math.min(cx + preferred.width, r.x + r.width + 8) - Math.max(cx, r.x - 8))
      * Math.max(0, Math.min(cy + preferred.height, r.y + r.height + 8) - Math.max(cy, r.y - 8));
    const distance = (cx - x) ** 2 + (cy - y) ** 2;
    if (area < bestArea || (area === bestArea && distance < bestDistance)) {
      bestArea = area; bestDistance = distance; bestX = cx; bestY = cy;
    }
  }
  return { ...preferred, x: bestX, y: bestY };
}

/** Measure HUD obstacles on layout changes. Drawing and picking share cached navball centres. */
export function initHudLayout() {
  const viewport = document.querySelector<HTMLElement>('#flight-console .viewport')!;
  const chat = document.getElementById('chat-overlay')!;
  const telemetry = viewport.querySelector<HTMLElement>('.telemetry')!;
  let pending = false, revision = 0;
  let obstacles: HudRect[] = [];
  const panes = new Map<HTMLCanvasElement, HudRect>(), observed = new Set<HTMLElement>();
  const cached = new WeakMap<NavballPlacement, { key: string; center: { x: number; y: number } }>();
  const schedule = (): void => { if (!pending) { pending = true; requestAnimationFrame(update); } };
  const editor = initHudEditor(viewport, schedule);
  const observer = new ResizeObserver(schedule);
  function update(): void {
    pending = false;
    const bounds = viewport.getBoundingClientRect();
    editor.refresh();
    const touch = [...viewport.querySelectorAll<HTMLElement>('.touch-stick-zone, .touch-actions-zone')]
      .filter(element => element.getClientRects().length > 0);
    // Responsive defaults use the home anchors. A player moving a control to the top must
    // not push unrelated default readouts outside the screen. Actual boxes still block navballs.
    const touchInset = touch.length ? Math.ceil(bounds.height - Math.min(...touch.map(e => e.offsetTop)) + 8) : 0;
    viewport.style.setProperty('--hud-touch-inset', `${touchInset}px`);
    const status = viewport.querySelector<HTMLElement>('.hud-top-left')!;
    const left = { right: bounds.left + status.offsetLeft + status.offsetWidth,
      bottom: bounds.top + status.offsetTop + status.offsetHeight };
    const rightElement = viewport.querySelector<HTMLElement>('.hud-top-right')!;
    const right = rightElement.getBoundingClientRect();
    viewport.style.setProperty('--hud-status-bottom', `${left.bottom - bounds.top + 8}px`);
    viewport.classList.toggle('hud-top-stacked', left.right + 8 > right.left);
    const dock = viewport.querySelector<HTMLElement>('.hud-dock')!;
    // Keep the touch deck beside the desktop dock, including its compact height variant.
    // offsetLeft uses the home anchor so saved HUD translations remain independent.
    viewport.style.setProperty('--hud-dock-inset', `${bounds.width > 650 ? bounds.width - dock.offsetLeft + 8 : 0}px`);
    const topBottom = Math.max(left.bottom, rightElement.getBoundingClientRect().bottom,
      bounds.width <= 650 ? bounds.top + dock.offsetTop + dock.offsetHeight : bounds.top);
    viewport.style.setProperty('--hud-message-top', `${topBottom - bounds.top + 8}px`);
    viewport.style.setProperty('--hud-notice-top', `${topBottom - bounds.top + 42}px`);
    const elements = editor.refresh();
    const chatBounds = chat.getBoundingClientRect(), instruments = telemetry.getBoundingClientRect();
    const bottom = bounds.bottom - Math.max(bounds.width <= 650 ? 8 : 12, touchInset);
    const overlaps = chatBounds.height > 0 && chatBounds.right + 12 > instruments.left
      && chatBounds.left - 12 < instruments.right && chatBounds.bottom + 12 > bottom - instruments.height && chatBounds.top - 12 < bottom;
    viewport.style.setProperty('--chat-telemetry-inset', `${Math.min(bounds.height - instruments.height - 8,
      Math.max(touchInset, Math.ceil(bounds.bottom - chatBounds.top + 8)))}px`);
    viewport.classList.toggle('chat-overlaps-telemetry', overlaps);
    editor.refresh();
    const rect = (element: HTMLElement): HudRect => {
      const r = element.getBoundingClientRect();
      return { x: r.left - bounds.left, y: r.top - bounds.top, width: r.width, height: r.height };
    };
    obstacles = [...elements, chat].filter(e => e.getClientRects().length > 0).map(rect);
    panes.clear();
    const canvases = [...viewport.querySelectorAll<HTMLCanvasElement>('canvas')];
    for (const canvas of canvases) panes.set(canvas, rect(canvas));
    const current = new Set<HTMLElement>([viewport, chat, rightElement, ...elements, ...canvases]);
    for (const element of observed) if (!current.has(element)) { observer.unobserve(element); observed.delete(element); }
    for (const element of current) if (!observed.has(element)) { observed.add(element); observer.observe(element); }
    revision++;
  }
  viewport.addEventListener('hud-layout-change', schedule);
  viewport.addEventListener('window-change', schedule);
  viewport.addEventListener('transitionend', schedule, true);
  window.addEventListener('resize', schedule);
  // Ignore changing text; discover renderer replacements and late-created touch controls.
  new MutationObserver(records => {
    if (records.some(r => [...r.addedNodes].some(n => n instanceof HTMLElement
      && (n.matches('canvas, #touch-overlay') || n.querySelector('canvas, #touch-overlay')))
      || [...r.removedNodes].some(n => n instanceof HTMLElement && n.matches('.hud-move-handle')))) schedule();
  }).observe(viewport, { childList: true, subtree: true });
  schedule();
  return {
    get editing() { return editor.editing; },
    navballCenter(placement: NavballPlacement, width: number, height: number, scale: number, canvas: HTMLCanvasElement, trajectory = false) {
      const pane = panes.get(canvas);
      const key = `${revision}/${width}/${height}/${scale}/${pane?.x}/${pane?.y}/${trajectory}`;
      const previous = cached.get(placement);
      if (previous?.key === key) return previous.center;
      const preferred = computeNavballCenter(placement, width, height, scale);
      // Include marker stems, drag banner, pin label and readouts. Text remains 11 px on small dials.
      const { side, above, below } = navballFootprint(scale, trajectory);
      const blocked = placement.anchor === 'custom' ? [] : obstacles.map(r => ({ ...r, x: r.x - (pane?.x ?? 0), y: r.y - (pane?.y ?? 0) }));
      const left = side + THROTTLE_LEVER_SPACE;
      const top = Math.max(above, 76);
      const bottom = Math.max(below, 100);
      const fit = fitHudRect({ x: preferred.x - left, y: preferred.y - top, width: left + side, height: top + bottom }, width, height, blocked);
      const center = { x: fit.x + left, y: fit.y + top };
      cached.set(placement, { key, center });
      return center;
    },
  };
}
