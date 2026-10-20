import {
  FLIGHT_SOUND,
  type AudioProvider,
  type FlightAudioControl,
  type FlightAudioFactory,
  type FlightAudioMountOptions,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface AudioControlsHelper {
  /** Mounts sound controls into `options.root` and binds an optional `AudioProvider`. */
  mount(options: FlightAudioMountOptions, provider?: AudioProvider): FlightAudioControl;
}

export const AUDIO_CONTROLS_HELPER: ServiceKey<AudioControlsHelper> = Object.freeze({
  slot: 'example.audio-controls',
  version: '1.0.0',
});

export function createAudioControlsHelper(audio: FlightAudioFactory): AudioControlsHelper {
  return Object.freeze<AudioControlsHelper>({
    mount(options, provider): FlightAudioControl {
      const control = audio.mount(options);
      if (provider) control.setProvider(provider);
      return control;
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(AUDIO_CONTROLS_HELPER, createAudioControlsHelper(context.use(FLIGHT_SOUND)));
}
