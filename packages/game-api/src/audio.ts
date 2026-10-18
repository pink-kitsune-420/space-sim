import type { AudioCue, AudioProvider } from './presentation';
import type { State } from './state';
import type { WorldEvent } from './world';
import type { ThemePreferences } from './theme';
import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
export interface AudioSynth extends AudioProvider, Disposable {}
export interface FlightAudioControl extends Disposable {
  setProvider(provider: AudioProvider | undefined): void;
  update(level: number, active: boolean): void;
  play(cue: AudioCue): void;
  reset(contactTime?: number): void;
  contact(time: number, cue: 'land' | 'crash' | 'splash', live: boolean): void;
  terrainContact(event: Extract<WorldEvent, {type: 'contact'}>, live: boolean): void;
  status(previous: State['status'], state: State, hasSurface: boolean, live: boolean): void;
  flight(state: State, engine: boolean, fault: boolean, warp: number, paused: boolean, active: boolean): void;
}
export interface FlightAudioOptions {
  readonly toggle: HTMLButtonElement; readonly slider: HTMLInputElement; readonly status: HTMLElement;
  readonly storage?: ThemePreferences;
  readonly defaultVolume?: number; readonly defaultEnabled?: boolean;
}
export interface FlightAudioMountOptions extends Pick<FlightAudioOptions,'storage'|'defaultVolume'|'defaultEnabled'> { readonly root: HTMLElement; readonly prefix?: string }
export interface FlightAudioFactory extends Disposable {
  create(options: FlightAudioOptions): FlightAudioControl;
  /** Mount the reusable settings content and restore the borrowed root on disposal. */
  mount(options: FlightAudioMountOptions): FlightAudioControl;
}
export const PROCEDURAL_SOUND: ServiceKey<AudioSynth> = Object.freeze({slot: 'audio.procedural', version: '1.0.0'});
export const FLIGHT_SOUND: ServiceKey<FlightAudioFactory> = Object.freeze({slot: 'audio.flight-controls', version: '1.0.0'});
