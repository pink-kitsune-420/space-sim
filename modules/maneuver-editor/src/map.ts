import { createProjector, type GhostSample, type ManeuverPlannerOptions, type Vec } from '@space-sim/game-api';

interface MapNode { readonly sample: GhostSample; readonly time: number; readonly prograde: number; readonly radial: number; readonly valid: boolean }
type Axis = 'prograde' | 'radial';
interface MapActions {
  node(): MapNode | undefined;
  position?(): Vec | undefined;
  begin?(): void;
  finish?(): void;
  enabled(): boolean;
  increment(): number;
  adjust(axis: Axis, value: number): void;
  move(pointer: Vec): void;
  restore(time: number, prograde: number, radial: number): void;
  open(): void;
}

/** Local map controls share the window's candidate node; they never command flight.
 * Transparent space passes through to the map's existing pan/zoom handlers. */
export class ManeuverMap {
  private readonly root: HTMLDivElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly directions = new Map<HTMLButtonElement, Vec>();
  private drag?: { id: number; button: HTMLButtonElement; node: MapNode; x: number; y: number;
    direction?: Vec; axis?: Axis; sign: number; step: number; moved: boolean; time: number; prograde: number; radial: number };

  constructor(private readonly options: ManeuverPlannerOptions, private readonly actions: MapActions, signal: AbortSignal) {
    const document = options.container.ownerDocument;
    this.root = document.createElement('div');
    this.root.className = 'maneuver-map'; this.root.hidden = true;
    this.root.setAttribute('role', 'group'); this.root.setAttribute('aria-label', 'Maneuver map controls');
    const controls = [
      ['node', '◇', 'Move maneuver node along the coast; click to open editor'],
      ['prograde/1', 'P+', 'Increase prograde velocity'], ['prograde/-1', 'P−', 'Decrease prograde velocity'],
      ['radial/1', 'R+', 'Increase radial velocity'], ['radial/-1', 'R−', 'Decrease radial velocity'],
    ];
    for (const [key, text, label] of controls) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = text!;
      button.dataset.mapControl = key; button.title = `${label}. Drag to adjust; Shift for fine control.`;
      button.setAttribute('aria-label', label!); this.root.append(button); this.buttons.push(button);
      button.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || !actions.enabled()) return;
        const node = actions.node(); if (!node?.valid) return;
        event.preventDefault(); event.stopPropagation(); button.focus({ preventScroll: true });
        const [axis, sign] = key!.split('/');
        this.drag = { id: event.pointerId, button, node, x: event.clientX, y: event.clientY,
          direction: this.directions.get(button), axis: axis === 'node' ? undefined : axis as Axis,
          sign: Number(sign) || 1, step: actions.increment(), moved: false,
          time: node.time, prograde: node.prograde, radial: node.radial };
        actions.begin?.();button.setPointerCapture(event.pointerId);
      }, { signal });
      button.addEventListener('pointermove', event => {
        const drag = this.drag; if (!drag || drag.id !== event.pointerId || drag.button !== button) return;
        if (!actions.enabled() || actions.node() !== drag.node) { this.finish(false); return; }
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
        drag.moved = true; event.preventDefault(); event.stopPropagation();
        if (drag.axis && drag.direction) {
          const pixels = dx * drag.direction.x + dy * drag.direction.y;
          const step = drag.step * (event.shiftKey ? .1 : 1);
          const value = drag[drag.axis] + drag.sign * Math.round(pixels * 2.5) * step / 10;
          actions.adjust(drag.axis, Math.max(-1e6, Math.min(1e6, Math.round(value * 1e9) / 1e9)));
        } else {
          const surface = options.map?.(); if (!surface) return;
          const rect = surface.element.getBoundingClientRect();
          actions.move({ x: event.clientX - rect.left, y: event.clientY - rect.top });
        }
      }, { signal });
      button.addEventListener('pointerup', event => { if (this.drag?.id === event.pointerId) this.finish(false); }, { signal });
      button.addEventListener('pointercancel', event => { if (this.drag?.id === event.pointerId) this.finish(true); }, { signal });
      button.addEventListener('lostpointercapture', () => this.finish(true), { signal });
      button.addEventListener('click', event => {
        // Pointer gestures are handled on release; keyboard activation arrives without a pointer.
        if (event.detail !== 0 || !actions.enabled()) return;
        const node = actions.node(), [axis, sign] = key!.split('/'); if (!node) return;
        if (axis === 'node') actions.open();
        else actions.adjust(axis as Axis, node[axis as Axis] + Number(sign) * actions.increment());
      }, { signal });
      button.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); this.finish(true); }
      }, { signal });
    }
    options.container.append(this.root);
  }
  private finish(cancel: boolean): void {
    const drag = this.drag; if (!drag) return; this.drag = undefined;
    if (drag.button.hasPointerCapture(drag.id)) drag.button.releasePointerCapture(drag.id);
    this.actions.finish?.();
    if (this.actions.node() !== drag.node) return;
    if (cancel) this.actions.restore(drag.time, drag.prograde, drag.radial);
    else if (this.actions.enabled() && !drag.moved) {
      if (drag.axis) this.actions.adjust(drag.axis, drag.node[drag.axis] + drag.sign * drag.step);
      else this.actions.open();
    }
  }
  update(): void {
    const node = this.actions.node(), surface = node && this.actions.enabled() ? this.options.map?.() : undefined;
    const hidden = !surface || !node || !this.actions.enabled();
    this.root.hidden = hidden;
    if (hidden) { this.finish(true); return; }
    const element = surface.element, width = element.clientWidth, height = element.clientHeight;
    this.root.style.left = `${element.offsetLeft}px`; this.root.style.top = `${element.offsetTop}px`;
    this.root.style.width = `${width}px`; this.root.style.height = `${height}px`;
    const project = createProjector(surface.camera, width, height);
    const position=this.actions.position?.()??node.sample.position;
    const center = project({ x: position.x + surface.origin.x, y: position.y + surface.origin.y });
    const c = Math.cos(surface.camera.rotation), s = Math.sin(surface.camera.rotation);
    for (const button of this.buttons) {
      const [axis, sign] = button.dataset.mapControl!.split('/');
      const vector = axis === 'prograde' ? node.sample.velocity : node.sample.position;
      const length = Math.hypot(vector.x, vector.y);
      const direction = { x: length ? (c * vector.x - s * vector.y) / length * (Number(sign) || 1) : 0,
        y: length ? -(s * vector.x + c * vector.y) / length * (Number(sign) || 1) : 0 };
      this.directions.set(button, direction);
      const x = center.x + (axis === 'node' ? 0 : direction.x * 52), y = center.y + (axis === 'node' ? 0 : direction.y * 52);
      button.hidden = !Number.isFinite(x + y) || x < 18 || y < 18 || x > width - 18 || y > height - 18 || (axis !== 'node' && !length);
      button.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    }
  }
  dispose(): void { this.drag = undefined; this.root.remove(); }
}
