import { TOUCH_INPUT, type InputSource, type ModuleInitializationV2, type TouchInputOptions } from '@space-sim/game-api';
import { TouchControlsManager } from './flight';

/** Pointer sampling over caller-supplied controls; no fixed flight actions or world access. */
export function createTouchSource(options: TouchInputOptions): InputSource {
  const definitions = new Map(options.actions.map(action => [action.id, action]));
  if (options.bindings.length > 256) throw new Error('At most 256 touch bindings');
  for (const binding of options.bindings) if (!definitions.has(binding.action)
    || !['hold', 'axis-x', 'axis-y'].includes(binding.gesture)) throw new Error('Invalid touch action binding');
  const bindings = options.bindings.map(binding => ({ ...binding, mode: definitions.get(binding.action)!.mode,
    category: definitions.get(binding.action)!.category, pointer: -1, value: 0, press: false }));
  let disposed = false, owner = options.pilot();
  const clear = (): void => {
    for (const binding of bindings) {
      const pointer = binding.pointer; binding.pointer = -1; binding.value = 0; binding.press = false;
      if (pointer !== -1) { try { binding.element.releasePointerCapture(pointer); } catch { /* Pointer already released by the browser. */ } }
    }
  };
  const available = (): boolean => {
    const next = options.pilot();
    if (next !== undefined && (!Number.isInteger(next) || next < 0 || next > 3)) throw new Error('Touch pilot must be in [0, 3]');
    if (next !== owner) { clear(); owner = next; }
    if (owner === undefined || options.capture?.() === false || document.hidden) { clear(); return false; }
    return true;
  };
  const removals: (() => void)[] = [];
  for (const binding of bindings) {
    const update = (event: PointerEvent): void => {
      if (binding.gesture === 'hold') { binding.value = 1; return; }
      const rect = binding.element.getBoundingClientRect(), vertical = binding.gesture === 'axis-y';
      const size = vertical ? rect.height : rect.width;
      const fraction = size > 0 ? ((vertical ? event.clientY - rect.top : event.clientX - rect.left) / size) * 2 - 1 : 0;
      binding.value = Math.max(-1, Math.min(1, fraction)) * (binding.invert ? -1 : 1);
    };
    const down = (event: PointerEvent): void => {
      if (disposed || !available() || binding.pointer !== -1 || event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault(); binding.pointer = event.pointerId; binding.press = true; update(event);
      try { binding.element.setPointerCapture(event.pointerId); } catch { /* Synthetic input or detached control. */ }
    };
    const move = (event: PointerEvent): void => {
      if (!available() || event.pointerId !== binding.pointer) return; event.preventDefault(); update(event);
    };
    const end = (event: PointerEvent): void => {
      if (event.pointerId !== binding.pointer) return; binding.pointer = -1; binding.value = 0;
      if (event.type !== 'pointerup') binding.press = false;
    };
    binding.element.addEventListener('pointerdown', down); binding.element.addEventListener('pointermove', move);
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) binding.element.addEventListener(type, end as EventListener);
    removals.push(() => {
      binding.element.removeEventListener('pointerdown', down); binding.element.removeEventListener('pointermove', move);
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) binding.element.removeEventListener(type, end as EventListener);
    });
  }
  const visibility = (): void => { if (document.hidden) clear(); };
  window.addEventListener('blur', clear); window.addEventListener('pagehide', clear); document.addEventListener('visibilitychange', visibility);
  return { name: 'touch', sample(frame, into) {
    if (disposed) throw new Error('Touch source is disposed');
    if (!available() || frame.pilot !== owner) return;
    for (const binding of bindings) {
      if (!(binding.category === 'flight' ? frame.flightAllowed : frame.shortcutsAllowed)) {
        const pointer = binding.pointer; binding.pointer = -1; binding.value = 0; binding.press = false;
        if (pointer !== -1) { try { binding.element.releasePointerCapture(pointer); } catch { /* Capture already ended. */ } }
        continue;
      }
      const value = binding.mode === 'press' ? binding.press ? 1 : 0 : binding.value;
      if (value !== 0) into.set(binding.action, value); binding.press = false;
    }
  }, release(pilot) { if (pilot === undefined || pilot === owner) clear(); }, dispose() {
    if (disposed) return; disposed = true; clear();
    for (const remove of removals) remove();
    window.removeEventListener('blur', clear); window.removeEventListener('pagehide', clear); document.removeEventListener('visibilitychange', visibility);
  } };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Touch input", summary: "Samples caller-supplied pointer controls and namespaced actions; retains the editable flight overlay and its styles.", asset: 'docs/creators/usage.json' });
  const sources = new Set<InputSource>(), managers = new Set<TouchControlsManager>(); let disposed = false;
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const source of sources) { try { source.dispose(); } catch (error) { errors.push(error); } }
    sources.clear();
    for (const manager of managers) { try { manager.dispose(); } catch (error) { errors.push(error); } }
    managers.clear(); if (errors.length) throw new AggregateError(errors, 'Touch provider cleanup failed'); } });
  context.provide(TOUCH_INPUT, Object.freeze({ create(options: TouchInputOptions) {
    if (disposed) throw new Error('Touch provider is disposed');
    const source = createTouchSource(options), dispose = source.dispose.bind(source);
    source.dispose = () => { try { dispose(); } finally { sources.delete(source); } }; sources.add(source); return source;
  }, createFlight() {
    if (disposed) throw new Error('Touch provider is disposed');
    const manager = new TouchControlsManager(), dispose = manager.dispose.bind(manager);
    manager.dispose = () => { try { dispose(); } finally { managers.delete(manager); } }; managers.add(manager); return manager;
  } }));
}
