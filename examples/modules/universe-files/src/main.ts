import {
  UNIVERSE_FILES,
  type ModuleInitializationV2,
  type ServiceKey,
  type UniverseFiles,
} from '@space-sim/game-api';

export interface UniverseFilesHelper {
  readFile(file: Blob, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  writeFile(name: string, bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void>;
}

export const UNIVERSE_FILES_HELPER: ServiceKey<UniverseFilesHelper> = Object.freeze({
  slot: 'example.universe-files',
  version: '1.0.0',
});

export function createUniverseFilesHelper(files: UniverseFiles): UniverseFilesHelper {
  return Object.freeze({
    async readFile(file: Blob, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
      const controller = new AbortController();
      if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      return files.read(file, controller.signal);
    },
    async writeFile(name: string, bytes: Uint8Array<ArrayBuffer>, signal?: AbortSignal): Promise<void> {
      const controller = new AbortController();
      if (signal) signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
      await files.write(name, bytes, controller.signal);
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const files = context.use(UNIVERSE_FILES);
  context.provide(UNIVERSE_FILES_HELPER, createUniverseFilesHelper(files));
}
