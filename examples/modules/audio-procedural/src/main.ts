import {
  PROCEDURAL_SOUND,
  type AudioCue,
  type AudioOutput,
  type AudioSynth,
  type ModuleInitializationV2,
  type ServiceKey,
} from '@space-sim/game-api';

export interface AudioProceduralHelper {
  readonly synth: AudioSynth;
  /** Creates a silent procedural audio output configured with an initial volume and thrust level. */
  createOutput(volume?: number, thrust?: number): AudioOutput;
  /** Triggers a one-shot flight cue and updates thrust on an output. */
  triggerCue(output: AudioOutput, cue: AudioCue, thrust?: number): void;
}

export const AUDIO_PROCEDURAL_HELPER: ServiceKey<AudioProceduralHelper> = Object.freeze({
  slot: 'example.audio-procedural',
  version: '1.0.0',
});

export function createAudioProceduralHelper(synth: AudioSynth): AudioProceduralHelper {
  return Object.freeze<AudioProceduralHelper>({
    synth,
    createOutput(volume = 0.4, thrust = 0): AudioOutput {
      const output = synth.create();
      output.setVolume(volume);
      output.setThrust(thrust);
      return output;
    },
    triggerCue(output, cue, thrust): void {
      if (thrust !== undefined) output.setThrust(thrust);
      output.play(cue);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  context.provide(AUDIO_PROCEDURAL_HELPER, createAudioProceduralHelper(context.use(PROCEDURAL_SOUND)));
}
