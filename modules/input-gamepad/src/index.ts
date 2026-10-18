import { FLIGHT_PROFILES, GAMEPAD_INPUT, type GamepadInputOptions, type InputSource, type ModuleInitializationV2 } from '@space-sim/game-api';
import { applyDeadzone, formatControllerButton, GamepadManager } from './flight';

/** Raw sampling is independent of flight meaning, player ownership and world stepping. */
export function createGamepadSource(options: GamepadInputOptions): InputSource {
  if (!Number.isFinite(options.deadzone) || options.deadzone < 0 || options.deadzone > .5) throw new Error('Gamepad deadzone must be in [0, 0.5]');
  const definitions = new Map(options.actions.map(action => [action.id, action]));
  if (options.bindings.length > 256) throw new Error('At most 256 gamepad bindings');
  const bindings = options.bindings.map(binding => {
    const index = binding.axis ?? binding.button;
    if (!definitions.has(binding.action) || !Number.isInteger(index) || index < 0 || index > 31
      || (binding.axis === undefined) === (binding.button === undefined)) throw new Error('Invalid gamepad action binding');
    const action = definitions.get(binding.action)!;
    return { ...binding, mode: action.mode, category: action.category };
  });
  const previous = new Float64Array(bindings.length * 4), assignments = new Int32Array(4).fill(-1);
  const inhibited = new Uint8Array(bindings.length * 4);
  let disposed = false;
  const release = (pilot?: number): void => {
    if (pilot !== undefined && (!Number.isInteger(pilot) || pilot < 0 || pilot > 3)) throw new Error('Gamepad pilot must be in [0, 3]');
    const first = pilot ?? 0, end = pilot === undefined ? 4 : pilot + 1;
    for (let seat = first; seat < end; seat++) {
      previous.fill(0, seat * bindings.length, (seat + 1) * bindings.length);
      inhibited.fill(1, seat * bindings.length, (seat + 1) * bindings.length);
    }
  };
  return { name: 'gamepad', sample(frame, into) {
    if (disposed) throw new Error('Gamepad source is disposed');
    const pilot = frame.pilot;
    if (!Number.isInteger(pilot) || pilot < 0 || pilot > 3) throw new Error('Gamepad pilot must be in [0, 3]');
    const index = options.pad(pilot);
    if (index !== undefined && (!Number.isInteger(index) || index < 0 || index > 31)) throw new Error('Invalid gamepad device index');
    const assigned = index ?? -1;
    if (assignments[pilot] !== assigned) { release(pilot); assignments[pilot] = assigned; }
    const pads = typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function' ? undefined : navigator.getGamepads();
    const pad = index === undefined ? undefined : pads?.[index];
    if (!pad?.connected || options.capture?.() === false || !frame.flightAllowed && !frame.shortcutsAllowed) { release(pilot); return; }
    for (let i = 0; i < bindings.length; i++) {
      const binding = bindings[i]!, at = pilot * bindings.length + i;
      const raw = binding.axis === undefined ? pad.buttons[binding.button!]?.value ?? 0 : pad.axes[binding.axis] ?? 0;
      const value = !Number.isFinite(raw) ? 0 : binding.axis === undefined ? Math.max(0, Math.min(1, raw)) : applyDeadzone(raw, options.deadzone) * (binding.invert ? -1 : 1);
      if (inhibited[at]) { if (Math.abs(value) <= .25) inhibited[at] = 0; previous[at] = value; continue; }
      if (!(binding.category === 'flight' ? frame.flightAllowed : frame.shortcutsAllowed)) { inhibited[at] = 1; previous[at] = 0; continue; }
      if (binding.mode !== 'press' ? value !== 0 : Math.abs(value) > .25 && Math.abs(previous[at]!) <= .25) into.set(binding.action, value);
      previous[at] = value;
    }
  }, release, dispose() { if (disposed) return; disposed = true; release(); } };
}
export default function initialize(context: ModuleInitializationV2): void {
  const profiles = context.tryUse(FLIGHT_PROFILES);
  context.contributeGuide({ id: 'usage', audience: 'creators', title: "Gamepad input", summary: "Samples generic namespaced actions from standard gamepad buttons and axes; retains editable flight mappings and diagnostics.", asset: 'docs/creators/usage.json' });
  const sources = new Set<InputSource>(), managers = new Set<GamepadManager>(); let disposed = false;
  context.own({ dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const source of sources) { try { source.dispose(); } catch (error) { errors.push(error); } }
    sources.clear();
    for (const manager of managers) { try { manager.dispose(); } catch (error) { errors.push(error); } }
    managers.clear(); if (errors.length) throw new AggregateError(errors, 'Gamepad provider cleanup failed'); } });
  context.provide(GAMEPAD_INPUT, Object.freeze({ formatButton: formatControllerButton, create(options: GamepadInputOptions) {
    if (disposed) throw new Error('Gamepad provider is disposed');
    const source = createGamepadSource(options), dispose = source.dispose.bind(source);
    source.dispose = () => { try { dispose(); } finally { sources.delete(source); } }; sources.add(source); return source;
  }, createFlight() {
    if (disposed) throw new Error('Gamepad provider is disposed');
    if (!profiles) throw new Error('Flight gamepad controls require a compatible input.flight-profiles provider');
    const manager = new GamepadManager(profiles), dispose = manager.dispose.bind(manager);
    manager.dispose = () => { try { dispose(); } finally { managers.delete(manager); } }; managers.add(manager); return manager;
  } }));
}
