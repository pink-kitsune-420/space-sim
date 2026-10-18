import type { AudioOutput, AudioSynth, ModuleInitializationV2 } from '@space-sim/game-api';
import { PROCEDURAL_SOUND } from '@space-sim/game-api';
import { PROCEDURAL_AUDIO } from './synth';
export function createAudioSynth(): AudioSynth {
  const outputs = new Set<AudioOutput>(); let disposed = false;
  return Object.freeze({ ...PROCEDURAL_AUDIO, create() {
    if (disposed) throw new Error('Audio provider disposed');
    const output = PROCEDURAL_AUDIO.create(), close = output.dispose.bind(output); let closed = false;
    output.dispose = () => { if (closed) return; closed = true; outputs.delete(output); close(); };
    outputs.add(output); return output;
  }, dispose() { if (disposed) return; disposed = true;
    const errors: unknown[] = []; for (const output of [...outputs]) { try { output.dispose(); } catch (error) { errors.push(error); } }
    outputs.clear(); if (errors.length) throw new AggregateError(errors, 'Audio cleanup failed');
  } });
}
export default function initialize(context: ModuleInitializationV2): void {
  context.contributeGuide({id:'usage',audience:'creators',title:"Procedural sound",summary:"Public audio.procedural@1.0.0 service and lifecycle.",asset:'docs/creators/usage.json'}); context.provide(PROCEDURAL_SOUND, context.own(createAudioSynth())); }
