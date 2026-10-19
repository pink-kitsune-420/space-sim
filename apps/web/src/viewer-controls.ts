import type { ActionDefinitionV2, Disposable, KeyboardInputFactory } from '../../../packages/game-api/src/index';

const ACTIONS: readonly ActionDefinitionV2[] = [
  { id: 'viewer/left', label: 'Pan left', category: 'system', mode: 'held', defaultKeys: ['ArrowLeft'] },
  { id: 'viewer/right', label: 'Pan right', category: 'system', mode: 'held', defaultKeys: ['ArrowRight'] },
  { id: 'viewer/up', label: 'Pan up', category: 'system', mode: 'held', defaultKeys: ['ArrowUp'] },
  { id: 'viewer/down', label: 'Pan down', category: 'system', mode: 'held', defaultKeys: ['ArrowDown'] },
  { id: 'viewer/zoom-in', label: 'Zoom in', category: 'system', mode: 'press', defaultKeys: ['Equal', 'Shift+Equal', 'NumpadAdd'] },
  { id: 'viewer/zoom-out', label: 'Zoom out', category: 'system', mode: 'press', defaultKeys: ['Minus', 'NumpadSubtract'] },
  { id: 'viewer/fit', label: 'Fit view', category: 'system', mode: 'press', defaultKeys: ['KeyR', 'Home'] },
];

/** Reuses the selected keyboard provider. View actions never submit world input. */
export function bindViewShortcuts(surface: HTMLElement, keyboard: KeyboardInputFactory, controls: {
  pan?(x: number, y: number): void; zoom(factor: number): void; fit(): void;
}): Disposable & { sample(elapsed: number): void } {
  const actions = controls.pan ? ACTIONS : ACTIONS.slice(4), bits = new Map(ACTIONS.map((action, index) => [action.id, 1 << index]));
  const source = keyboard.create({ actions, pilot: () => 0, capture: () => document.activeElement === surface });
  let pressed = 0;
  const sink = { set(action: string, value: number) { if (value) pressed |= bits.get(action) ?? 0; } };
  const frame = { pilot: 0, elapsed: 0, flightAllowed: false, shortcutsAllowed: true };
  return { dispose: () => source.dispose(), sample(elapsed) {
    pressed = 0; frame.elapsed = elapsed; source.sample(frame, sink);
    if (pressed & 15) controls.pan?.(((pressed & 1 ? 1 : 0) - (pressed & 2 ? 1 : 0)) * elapsed * 300,
      ((pressed & 4 ? 1 : 0) - (pressed & 8 ? 1 : 0)) * elapsed * 300);
    if (pressed & 16) controls.zoom(1.25);
    if (pressed & 32) controls.zoom(1 / 1.25);
    if (pressed & 64) controls.fit();
  } };
}

/** Scene-only controls. Keyboard shortcuts belong to the focused view; replacing
 * its renderer canvas keeps the gestures and focus on this stable surface. */
export function bindViewerControls(surface: HTMLElement, controls: {
  pan(x: number, y: number): void; zoom(factor: number): void; fit(): void;
}): Disposable {
  const lifetime = new AbortController(), options = { signal: lifetime.signal };
  const pointers = new Map<number, { x: number; y: number }>();
  const release = (id: number) => {
    pointers.delete(id);
    if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
  };
  const cancel = () => { for (const id of pointers.keys()) release(id); };
  surface.addEventListener('wheel', event => {
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1);
    controls.zoom(Math.exp(Math.max(-1, Math.min(1, -pixels * .002))));
  }, { ...options, passive: false });
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0 || pointers.size >= 2) return;
    surface.focus({ preventScroll: true });
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    surface.setPointerCapture(event.pointerId);
  }, options);
  surface.addEventListener('pointermove', event => {
    const previous = pointers.get(event.pointerId); if (!previous) return;
    let other: { x: number; y: number } | undefined;
    for (const [id, position] of pointers) if (id !== event.pointerId) other = position;
    const x = event.clientX, y = event.clientY;
    if (other) {
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(x - other.x, y - other.y);
      if (before > 1 && after > 1) controls.zoom(after / before);
    }
    controls.pan((x - previous.x) / (other ? 2 : 1), (y - previous.y) / (other ? 2 : 1));
    previous.x = x; previous.y = y;
  }, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
    surface.addEventListener(name, event => release(event.pointerId), options);
  window.addEventListener('blur', cancel, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) cancel(); }, options);
  return { dispose() { cancel(); lifetime.abort(); } };
}
