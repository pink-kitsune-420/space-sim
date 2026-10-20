import type { FlightAudioFactory, FlightAudioOptions, ModuleInitializationV2 } from '@space-sim/game-api';
import { FLIGHT_SOUND } from '@space-sim/game-api';
import { FlightAudio } from './controls';
import { audioSettings } from './template';
export function createFlightAudio(defaults:Pick<FlightAudioOptions,'defaultVolume'|'defaultEnabled'> = {}): FlightAudioFactory {
  const controls = new Set<FlightAudio>(); let disposed = false;
  let next = 0;
  const factory: FlightAudioFactory = { create(options) {
    if (disposed) throw new Error('Audio controls provider disposed');
    const control = new FlightAudio({...defaults,...options}), close = control.dispose.bind(control); let closed = false;
    control.dispose = () => { if (closed) return; closed = true; controls.delete(control); close(); }; controls.add(control); return control;
  }, mount(options) {
    if (disposed) throw new Error('Audio controls provider disposed');
    const prefix = options.prefix ?? `module-audio-${++next}`;
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(prefix)) throw new Error('Invalid audio control ID prefix');
    const root = options.root, previous = [...root.childNodes], template = root.ownerDocument.createElement('template');
    template.innerHTML = audioSettings(prefix); root.replaceChildren(template.content);
    try {
      const control = factory.create({toggle:root.querySelector<HTMLButtonElement>(`#${prefix}-toggle`)!, slider:root.querySelector<HTMLInputElement>(`#${prefix}-volume`)!, status:root.querySelector<HTMLElement>(`#${prefix}-status`)!, storage:options.storage,defaultVolume:options.defaultVolume??defaults.defaultVolume,defaultEnabled:options.defaultEnabled??defaults.defaultEnabled});
      const close = control.dispose.bind(control); let closed = false;
      control.dispose = () => { if (closed) return; closed = true; try { close(); } finally { root.replaceChildren(...previous); } }; return control;
    } catch (error) { root.replaceChildren(...previous); throw error; }
  }, dispose() { if (disposed) return; disposed = true; const errors: unknown[] = [];
    for (const control of controls) { try { control.dispose(); } catch (error) { errors.push(error); } }
    controls.clear(); if (errors.length) throw new AggregateError(errors, 'Audio controls provider cleanup failed'); } };
  return Object.freeze(factory);
}
/**
 * Contributes viewer-local flight sound controls and browser audio activation lifecycle management.
 * Provides audio.flight-controls@1.0.0 in slot audio.flight-controls.
 * Requires no external services. Reads settings volume (0 to 1, default 0.4) and enabled (0 or 1, default 1).
 */
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Flight sound controls",summary:"Public audio.flight-controls@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'}); context.provide(FLIGHT_SOUND, context.own(createFlightAudio({defaultVolume:context.settings.volume??.4,defaultEnabled:(context.settings.enabled??1)>=1}))); }
