import type { AudioProvider, RegisteredModule } from '../../../../game-api/src/index';
import { builtinManifest } from '../manifest';
export function createAudioModule(provider: AudioProvider): RegisteredModule { return {
  manifest: { ...builtinManifest(provider.id, ['audio'], 'presentation', ['browser', 'offline']), name: provider.label },
  initialize(context) { if (context.selected('audio')) context.provide('audio', provider); },
}; }
