/** Space reserved to the left of the navball, in CSS pixels (including the gap). */
export const THROTTLE_LEVER_SPACE = 56;

export interface ThrottleLeverState {
  readonly world: object;
  readonly shipId: string;
  readonly throttle: number;
  readonly locked: boolean;
  readonly firing: boolean;
}

/** A per-pilot HUD control. Reads authoritative state; writes through the session only. */
export class ThrottleLever {
  readonly element = document.createElement('div');
  private readonly track = document.createElement('div');
  private readonly value = document.createElement('output');
  private readonly status = document.createElement('span');
  private drag: { pointer: number; world: object; shipId: string } | undefined;
  private x = NaN;
  private y = NaN;
  private power = NaN;
  private percent = NaN;
  private locked: boolean | undefined;
  private firing: boolean | undefined;

  constructor(slot: number, private readonly read: () => ThrottleLeverState | undefined,
    private readonly set: (value: number) => void) {
    this.element.className = 'throttle-lever';
    this.element.dataset.slot = String(slot);
    this.element.hidden = true;
    this.track.className = 'throttle-lever-track';
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', `Player ${slot + 1} throttle lever`);
    this.track.setAttribute('aria-orientation', 'vertical');
    this.track.setAttribute('aria-valuemin', '0');
    this.track.setAttribute('aria-valuemax', '100');
    this.track.innerHTML = '<span class="throttle-lever-slot"></span><span class="throttle-lever-handle"></span>';
    const label = document.createElement('span');
    label.className = 'throttle-lever-label';
    label.textContent = 'THR';
    this.status.className = 'throttle-lever-status';
    this.element.append(label, this.track, this.value, this.status);
    this.element.addEventListener('pointerdown', event => event.stopPropagation());
    this.track.addEventListener('pointerdown', event => {
      event.stopPropagation();
      if (event.button !== 0 || this.drag) return;
      event.preventDefault();
      const state = this.read();
      if (!state || state.locked) return;
      this.drag = { pointer: event.pointerId, world: state.world, shipId: state.shipId };
      this.track.setPointerCapture(event.pointerId);
      this.move(event);
    });
    this.track.addEventListener('pointermove', event => { event.stopPropagation(); this.move(event); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      this.track.addEventListener(type, event => {
        event.stopPropagation();
        if ((event as PointerEvent).pointerId === this.drag?.pointer) this.cancel();
      });
    }
    // Guest panes also listen to legacy touch events for camera gestures.
    for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel', 'wheel']) {
      this.element.addEventListener(type, event => event.stopPropagation(), { passive: true });
    }
    this.track.addEventListener('keydown', event => {
      const state = this.read();
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      if (!state || state.locked) return;
      const value = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : state.throttle
        + (event.key === 'ArrowUp' ? .01 : event.key === 'ArrowDown' ? -.01 : event.key === 'PageUp' ? .1 : -.1);
      this.set(Math.max(0, Math.min(1, value)));
    });
    // Release capture on focus loss; a new gesture is required after cancellation.
    this.track.addEventListener('blur', () => this.cancel());
    window.addEventListener('blur', () => this.cancel());
  }

  private cancel(): void {
    const drag = this.drag;
    this.drag = undefined;
    if (drag && this.track.hasPointerCapture(drag.pointer)) this.track.releasePointerCapture(drag.pointer);
  }

  private move(event: PointerEvent): void {
    if (this.drag?.pointer !== event.pointerId) return;
    const state = this.read();
    if (!state || state.locked || state.world !== this.drag.world || state.shipId !== this.drag.shipId) {
      this.cancel(); return;
    }
    const rect = this.track.getBoundingClientRect();
    // The handle centre travels between the two end stops, eight pixels in from each end.
    this.set(Math.max(0, Math.min(1, (rect.bottom - 8 - event.clientY) / (rect.height - 16))));
  }

  sync(parent: HTMLElement, x: number, y: number): void {
    if (this.element.parentElement !== parent) parent.append(this.element);
    const state = this.read();
    this.element.hidden = !state;
    if (!state) { this.cancel(); return; }
    if (state.locked || this.drag && (this.drag.world !== state.world || this.drag.shipId !== state.shipId)) this.cancel();
    if (this.x !== x) { this.element.style.left = `${x}px`; this.x = x; }
    if (this.y !== y) { this.element.style.top = `${y}px`; this.y = y; }
    if (this.power !== state.throttle) {
      this.element.style.setProperty('--throttle-position', String(state.throttle)); this.power = state.throttle;
    }
    const percent = Math.round(state.throttle * 100);
    if (this.percent === percent && this.locked === state.locked && this.firing === state.firing) return;
    this.percent = percent; this.locked = state.locked; this.firing = state.firing;
    this.value.textContent = `${percent}%`;
    this.track.setAttribute('aria-valuenow', String(percent));
    this.track.setAttribute('aria-disabled', String(state.locked));
    this.track.setAttribute('aria-valuetext', `${percent}%${state.locked ? ', locked' : ''}`);
    this.element.dataset.locked = String(state.locked);
    this.element.dataset.firing = String(state.firing);
    this.status.textContent = state.locked ? 'LOCK' : state.firing ? 'BURN' : 'IDLE';
    this.track.title = state.locked ? 'Resume flight and release engine / throttle controls to drag'
      : 'Drag to set thrust; release to keep burning; drag to 0% to coast. Engine / throttle controls override.';
  }
}
