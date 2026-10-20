import type { AudioCue, AudioProvider } from './presentation';
import type { State } from './state';
import type { WorldEvent } from './world';
import type { ThemePreferences } from './theme';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
/**
 * Disposable procedural or sample-backed audio provider (`audio.procedural@1.0.0`).
 * Viewer-local only; never reads or writes authoritative simulation state.
 * Disposing the synth disposes every `AudioOutput` it created and rejects future `create()` calls.
 */
export interface AudioSynth extends AudioProvider, Disposable {}
/**
 * Browser-side controller bridging flight observations, user gestures, visibility and local volume preferences
 * to an optional `AudioProvider`. Viewer-local only; never affects simulation state or determinism.
 * Disposing aborts DOM listeners, disposes the active `AudioOutput` and restores mounted DOM nodes if created via `mount`.
 */
export interface FlightAudioControl extends Disposable {
  /**
   * Binds or replaces the underlying sound synthesis provider. Disposes the previous `AudioOutput` immediately.
   * Passing `undefined` silences output and releases the current `AudioOutput`. Throws if the control is disposed and `provider` is defined.
   */
  setProvider(provider: AudioProvider | undefined): void;
  /**
   * Updates continuous engine thrust level (`0` to `1` linear scale; non-finite values clamp to `0`) and viewer activity flag.
   * Suspends output when `active` becomes `false` and resumes if previously activated by a user gesture when `active` becomes `true`.
   */
  update(level: number, active: boolean): void;
  /** Plays a one-shot device-local cue when enabled, audible (`volume > 0`), active and the document is visible. */
  play(cue: AudioCue): void;
  /**
   * Resets the contact-time watermark (simulation seconds, default `-Infinity`) and zeroes thrust on world load,
   * ship switch or session reconnect so historical contacts do not replay.
   */
  reset(contactTime?: number): void;
  /**
   * Records a contact at simulation `time` (seconds) and plays `cue` once if `time` is strictly greater than the last
   * recorded contact time and `live` is `true`.
   */
  contact(time: number, cue: 'land' | 'crash' | 'splash', live: boolean): void;
  /** Handles an authoritative terrain `contact` world event, mapping status and surface material (`water` vs rock) to a contact cue at `event.contact.time` (simulation seconds). */
  terrainContact(event: Extract<WorldEvent, {type: 'contact'}>, live: boolean): void;
  /** Detects a transition from `'flying'` to `'landed'` or `'crashed'` on smooth bodies without terrain (`hasSurface === false`) and triggers a contact cue at `state.time` (simulation seconds). */
  status(previous: State['status'], state: State, hasSurface: boolean, live: boolean): void;
  /**
   * Convenience per-frame flight hook: feeds `state.throttle` (`0` to `1`) to `update` only when `engine` is firing,
   * unpaused, not crashed, not faulted and `warp === 1`; otherwise feeds `0`.
   */
  flight(state: State, engine: boolean, fault: boolean, warp: number, paused: boolean, active: boolean): void;
}
/**
 * Options for binding a `FlightAudioControl` to caller-supplied DOM controls.
 * The caller retains DOM node ownership; `dispose()` removes event listeners without removing the nodes.
 */
export interface FlightAudioOptions {
  /** Borrowed mute/enable toggle button; `aria-pressed` and label text are synchronized by the controller. */
  readonly toggle: HTMLButtonElement;
  /** Borrowed range input (`0` to `100` percent); synchronized with normalized linear gain (`0` to `1`). */
  readonly slider: HTMLInputElement;
  /** Borrowed status element displaying provider availability, activation errors or help text. */
  readonly status: HTMLElement;
  /** Optional local preference storage (reads/writes JSON `{ enabled, volume }` under `'space-sim.audio/1'`). Storage errors are ignored. */
  readonly storage?: ThemePreferences;
  /** Fallback initial gain in `[0, 1]` when storage has no saved volume (default `0.4`). Throws if outside `[0, 1]` or non-finite. */
  readonly defaultVolume?: number;
  /** Fallback initial enabled state when storage has no saved preference (default `true`). */
  readonly defaultEnabled?: boolean;
}
/**
 * Options for mounting the standard sound settings template into a borrowed container element.
 * `root` children are replaced during mount and restored when the returned `FlightAudioControl` is disposed.
 */
export interface FlightAudioMountOptions extends Pick<FlightAudioOptions,'storage'|'defaultVolume'|'defaultEnabled'> {
  /** Borrowed container element whose children are replaced with the sound controls template until disposal. */
  readonly root: HTMLElement;
  /** Optional HTML ID prefix matching `/^[a-z][a-z0-9-]{0,63}$/` (defaults to auto-incrementing `'module-audio-N'`). Throws on invalid prefix. */
  readonly prefix?: string;
}
/**
 * Factory creating viewer-local flight audio controllers (`audio.flight-controls@1.0.0`).
 * Candidate-owned: disposing the factory disposes all active controllers and rejects subsequent `create` or `mount` calls.
 */
export interface FlightAudioFactory extends Disposable {
  /** Binds a new `FlightAudioControl` to existing toggle, slider and status elements. Throws if disposed, volume is invalid, or `ownerDocument.defaultView` is missing. */
  create(options: FlightAudioOptions): FlightAudioControl;
  /** Mounts the reusable settings content into `options.root` and restores the borrowed root's previous children on disposal. */
  mount(options: FlightAudioMountOptions): FlightAudioControl;
}
/** Service key for the procedural sound synthesis provider (`audio.procedural@1.0.0`). */
export const PROCEDURAL_SOUND: ServiceKey<AudioSynth> = Object.freeze({slot: 'audio.procedural', version: '1.0.0'});
/** Service key for the flight sound controls factory (`audio.flight-controls@1.0.0`). */
export const FLIGHT_SOUND: ServiceKey<FlightAudioFactory> = Object.freeze({slot: 'audio.flight-controls', version: '1.0.0'});

