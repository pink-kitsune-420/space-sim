import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { SavedWorldOptions, WorldRead, WorldSave } from './engine';

/** Container codecs stay in the host; decoding is inert and never activates saved code. */
export interface UniverseSaveFormat {
  encode(save: WorldSave, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<unknown>;
}
export const CORE_UNIVERSE_FORMAT: ServiceKey<UniverseSaveFormat> = Object.freeze({slot:'core.universe-save-format',version:'1.0.0'});
export interface UniverseSaveSource {
  /** Stable session/world identity; captured before asynchronous work. */
  readonly identity: object;
  readonly world: WorldRead;
  readonly options?: SavedWorldOptions;
  readonly canSave: boolean;
  readonly canLoad: boolean;
}
export interface UniverseSaveOptions {
  current(): UniverseSaveSource;
  /** Prepare exact installed packages, validate state, then atomically publish. Call
   * guard immediately before publication; observe signal during asynchronous work. */
  restore(raw: unknown, signal: AbortSignal, guard: () => void): Promise<void>;
}
export interface UniverseSaveCommands extends Disposable {
  save(write: (name: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<WorldSave>;
  load(read: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>, signal?: AbortSignal): Promise<void>;
}
export interface UniverseSaveFactory { create(options: UniverseSaveOptions): UniverseSaveCommands }
export const UNIVERSE_SAVES: ServiceKey<UniverseSaveFactory> = Object.freeze({slot:'universe.saves',version:'1.0.0'});
export interface UniverseFiles extends Disposable {
  read(file: Blob, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  write(name: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void>;
}
export const UNIVERSE_FILES: ServiceKey<UniverseFiles> = Object.freeze({slot:'universe.files',version:'1.0.0'});
export interface UniverseSaveControls extends Disposable { readonly busy: boolean }
export interface UniverseSaveControlOptions {
  readonly root: HTMLElement;
  readonly commands: UniverseSaveCommands;
  /** Borrow existing controls or let the module create an independent set. */
  readonly controls?: { readonly save: HTMLButtonElement; readonly load: HTMLButtonElement; readonly file: HTMLInputElement };
  readonly prefix?: string;
  saved?(save: WorldSave): void;
  loaded?(): void;
  error?(operation: 'save' | 'load', error: unknown): void;
}
export interface UniverseSaveControlFactory { mount(options: UniverseSaveControlOptions): UniverseSaveControls }
export const UNIVERSE_SAVE_CONTROLS: ServiceKey<UniverseSaveControlFactory> = Object.freeze({slot:'ui.universe-saves',version:'1.0.0'});

/** Native operations only. Editable server storage owns naming, serialization, queueing,
 * recovery and retention; the host owns filesystem access and engine validation. */
export interface UniverseDisk {
  join(...parts: string[]): string;
  read(path: string): Promise<string>;
  directory(path: string): Promise<void>;
  names(path: string): Promise<readonly string[]>;
  rename(from: string, to: string): Promise<void>;
  copy(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  replace(path: string, text: string): Promise<void>;
  replaceSync(path: string, text: string): void;
  missing(error: unknown): boolean;
}
export const CORE_UNIVERSE_DISK: ServiceKey<UniverseDisk> = Object.freeze({slot:'core.universe-disk',version:'1.0.0'});
export interface ServerUniverseOptions<T> {
  readonly directory: string; readonly keepBackups: number;
  restore(raw: unknown): T | Promise<T>;
  /** Missing/incompatible packages require user recovery, not quarantine or fallback. */
  configurationError(error: unknown): boolean;
  log?(message: string): void;
}
export interface ServerUniverseStore<T> extends Disposable {
  readonly file: string; readonly backups: string;
  load(): Promise<{readonly loaded: T; readonly from: string} | undefined>;
  save(save: WorldSave): Promise<void>;
  saveSync(save: WorldSave): void;
  idle(): Promise<void>;
  backup(): Promise<string | undefined>;
  backupFiles(): Promise<string[]>;
}
export interface ServerUniverseStorage { create<T>(options: ServerUniverseOptions<T>): ServerUniverseStore<T> }
export const SERVER_UNIVERSE_STORAGE: ServiceKey<ServerUniverseStorage> = Object.freeze({slot:'universe.server-storage',version:'1.0.0'});
