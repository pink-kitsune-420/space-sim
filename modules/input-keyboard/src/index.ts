import { KEYBOARD_INPUT, type Disposable, type FlightKeyboardOptions, type KeyboardInputFactory, type InputSource, type KeyboardInputOptions, type ModuleInitializationV2 } from '@space-sim/game-api';
import { bindFlightInput, RESERVED_KEYS } from './legacy';

/** Device sampling only. Actions and session ownership are supplied by the game. */
export function createKeyboardSource(options: KeyboardInputOptions): InputSource {
  const held = new Set<string>(), presses = new Set<string>();
  const actions = options.actions.map(action => ({ id: action.id, mode: action.mode, category: action.category,
    keys: [...options.bindings?.[action.id] ?? action.defaultKeys] }));
  const known = new Set(actions.flatMap(action => action.keys));
  let owner = options.pilot(), disposed = false;
  const clear = (): void => { held.clear(); presses.clear(); };
  const assignment = (): number | undefined => {
    const next = options.pilot();
    if (next !== undefined && (!Number.isInteger(next) || next < 0 || next > 3)) throw new Error('Keyboard pilot must be an active local seat (0–3)');
    if (next !== owner) { clear(); owner = next; } return owner;
  };
  const available = (): boolean => {
    if (options.capture?.() === false || document.hidden) { clear(); return false; }
    return assignment() !== undefined;
  };
  const down = (event: KeyboardEvent): void => {
    if (disposed || !available() || (event.target as Element | null)?.closest?.('input, select, button, summary, a, textarea, [contenteditable="true"]')) return;
    const chord = /^(Shift|Control|Meta|Alt)(Left|Right)$/.test(event.code) ? event.code
      : `${event.ctrlKey ? 'Ctrl+' : ''}${event.metaKey ? 'Meta+' : ''}${event.shiftKey ? 'Shift+' : ''}${event.code}`;
    const key = known.has(chord) ? chord : event.code;
    if (!known.has(key) || event.altKey) return;
    event.preventDefault(); held.add(key);
    if (!event.repeat) presses.add(key);
  };
  const up = (event: KeyboardEvent): void => {
    // Releasing a physical key also releases its chord if a modifier changed first.
    for (const key of held) if (key === event.code || key.endsWith(`+${event.code}`)) held.delete(key);
  };
  const visibility = (): void => { if (document.hidden) clear(); };
  window.addEventListener('keydown', down); window.addEventListener('keyup', up);
  window.addEventListener('blur', clear); window.addEventListener('pagehide', clear);
  document.addEventListener('visibilitychange', visibility);
  return {
    name: 'keyboard',
    sample(frame, into) {
      if (disposed) throw new Error('Keyboard source is disposed');
      if (!available() || frame.pilot !== owner) return;
      for (const action of actions) {
        if (!(action.category === 'flight' ? frame.flightAllowed : frame.shortcutsAllowed)) {
          for (const key of action.keys) { held.delete(key); presses.delete(key); }
          continue;
        }
        const keys = action.mode === 'press' ? presses : held;
        for (const key of action.keys) if (keys.has(key)) { into.set(action.id, 1); break; }
      }
      presses.clear();
      if (!frame.flightAllowed && !frame.shortcutsAllowed) clear();
    },
    release(pilot) { if (pilot === undefined || pilot === owner) clear(); },
    dispose() {
      if (disposed) return; disposed = true; clear();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear); window.removeEventListener('pagehide', clear);
      document.removeEventListener('visibilitychange', visibility);
    },
  };
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Keyboard input", summary: "Samples generic namespaced actions from a keyboard; preserves the existing flight keyboard/hold-button adapter.", asset: 'docs/creators/usage.json' });
  const sources = new Set<Disposable>(); let disposed = false;
  context.own({ dispose() {
    if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const source of sources) { try { source.dispose(); } catch (error) { errors.push(error); } }
    sources.clear(); if (errors.length) throw new AggregateError(errors, 'Keyboard provider cleanup failed');
  } });
  context.provide(KEYBOARD_INPUT, Object.freeze<KeyboardInputFactory>({ reservedKeys: RESERVED_KEYS, create(options: KeyboardInputOptions) {
    if (disposed) throw new Error('Keyboard provider is disposed');
    const source = createKeyboardSource(options), dispose = source.dispose.bind(source);
    source.dispose = () => { try { dispose(); } finally { sources.delete(source); } };
    sources.add(source); return source;
  }, bindFlight(options: FlightKeyboardOptions) {
    if (disposed) throw new Error('Keyboard provider is disposed');
    const binding = bindFlightInput(options), dispose = binding.dispose.bind(binding);
    binding.dispose = () => { try { dispose(); } finally { sources.delete(binding); } }; sources.add(binding); return binding;
  } }));
}
