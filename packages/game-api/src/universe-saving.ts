import type { Disposable } from './modules';
import type { ServiceKey } from './modules-v2';
import type { SavedWorldOptions, WorldRead, WorldSave } from './engine';

/**
 * Host universe container package codec interface (`core.universe-save-format@1.0.0`).
 * Encodes WorldSave structures into zip-compressed .spaceuniverse archives and decodes byte buffers.
 * Decoding is inert and never executes saved module scripts or activates unapproved packages.
 * Throws when archive format is unrecognised, corrupted, or when abort is signalled.
 */
export interface UniverseSaveFormat {
  encode(save: WorldSave, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  decode(bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<unknown>;
}
/** Service key for host universe container package codec (`core.universe-save-format@1.0.0`). */
export const CORE_UNIVERSE_FORMAT: ServiceKey<UniverseSaveFormat> = Object.freeze({slot:'core.universe-save-format',version:'1.0.0'});
/**
 * Snapshot of session and world identity captured prior to asynchronous save or load IO.
 * Holds read-only world access, optional snapshot configuration, and permission flags.
 */
export interface UniverseSaveSource {
  /** Stable session/world identity; captured before asynchronous work. */
  readonly identity: object;
  readonly world: WorldRead;
  readonly options?: SavedWorldOptions;
  readonly canSave: boolean;
  readonly canLoad: boolean;
}
/**
 * Host callbacks and session access supplied when instantiating a UniverseSaveCommands controller.
 * Defines current world resolution and atomic, guarded state restoration.
 */
export interface UniverseSaveOptions {
  current(): UniverseSaveSource;
  /** Prepare exact installed packages, validate state, then atomically publish. Call
   * guard immediately before publication; observe signal during asynchronous work. */
  restore(raw: unknown, signal: AbortSignal, guard: () => void): Promise<void>;
}
/**
 * Single-operation universe save and load command controller (`universe.saves@1.0.0`).
 * Serializes save/load actions, validates session consistency across async boundaries,
 * and delegates payload encoding/decoding without activating untrusted scripts.
 * Throws if another save/load is already in flight, if permissions are denied, or on session drift.
 */
export interface UniverseSaveCommands extends Disposable {
  save(write: (name: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal) => Promise<void>, signal?: AbortSignal): Promise<WorldSave>;
  load(read: (signal: AbortSignal) => Promise<Uint8Array<ArrayBuffer>>, signal?: AbortSignal): Promise<void>;
}
/**
 * Factory creating cancellable single-operation universe save and load command controllers (`universe.saves@1.0.0`).
 */
export interface UniverseSaveFactory { create(options: UniverseSaveOptions): UniverseSaveCommands }
/** Service key for the universe save/load command controller factory (`universe.saves@1.0.0`). */
export const UNIVERSE_SAVES: ServiceKey<UniverseSaveFactory> = Object.freeze({slot:'universe.saves',version:'1.0.0'});
/**
 * Bounded browser file dialog and download management service (`universe.files@1.0.0`).
 * Reads user-selected Blobs up to 64 MiB and writes download files via temporary object URLs.
 * Created URLs are automatically revoked after a 10-second timeout or immediately upon provider disposal.
 * Throws if file sizes exceed 64 MiB, filenames contain invalid characters, or if aborted.
 */
export interface UniverseFiles extends Disposable {
  read(file: Blob, signal: AbortSignal): Promise<Uint8Array<ArrayBuffer>>;
  write(name: string, bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Promise<void>;
}
/** Service key for the browser universe file reader and writer (`universe.files@1.0.0`). */
export const UNIVERSE_FILES: ServiceKey<UniverseFiles> = Object.freeze({slot:'universe.files',version:'1.0.0'});
/**
 * Interactive Save universe and Load universe DOM control instance (`ui.universe-saves@1.0.0`).
 * Reports busy status during active operations and restores original DOM on disposal.
 */
export interface UniverseSaveControls extends Disposable { readonly busy: boolean }
/**
 * Configuration options for mounting Save universe and Load universe controls into a host DOM element.
 * Allows borrowing caller-supplied buttons or generating standard controls with an optional prefix.
 */
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
/**
 * Factory for mounting interactive Save universe and Load universe controls (`ui.universe-saves@1.0.0`).
 */
export interface UniverseSaveControlFactory { mount(options: UniverseSaveControlOptions): UniverseSaveControls }
/** Service key for the universe save control UI factory (`ui.universe-saves@1.0.0`). */
export const UNIVERSE_SAVE_CONTROLS: ServiceKey<UniverseSaveControlFactory> = Object.freeze({slot:'ui.universe-saves',version:'1.0.0'});

/**
 * Low-level server filesystem IO operations required by server universe storage (`core.universe-disk@1.0.0`).
 * Native operations only. Editable server storage owns naming, serialization, queueing,
 * recovery and retention; the host owns filesystem access and engine validation.
 */
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
/** Service key for native server filesystem IO primitives (`core.universe-disk@1.0.0`). */
export const CORE_UNIVERSE_DISK: ServiceKey<UniverseDisk> = Object.freeze({slot:'core.universe-disk',version:'1.0.0'});
/**
 * Configuration options for initializing a ServerUniverseStore instance.
 * Defines target directory, backup retention count, state restore logic, and configuration error classification.
 */
export interface ServerUniverseOptions<T> {
  readonly directory: string; readonly keepBackups: number;
  restore(raw: unknown): T | Promise<T>;
  /** Missing/incompatible packages require user recovery, not quarantine or fallback. */
  configurationError(error: unknown): boolean;
  log?(message: string): void;
}
/**
 * Persistent server universe storage managing world.json persistence, atomic writes, and backups.
 * Quarantines unparseable files, falls back to timestamped backups, and preserves existing worlds on configuration error.
 * Enqueues asynchronous writes in arrival order; idle() drains the queue prior to shutdown.
 */
export interface ServerUniverseStore<T> extends Disposable {
  readonly file: string; readonly backups: string;
  load(): Promise<{readonly loaded: T; readonly from: string} | undefined>;
  save(save: WorldSave): Promise<void>;
  saveSync(save: WorldSave): void;
  idle(): Promise<void>;
  backup(): Promise<string | undefined>;
  backupFiles(): Promise<string[]>;
}
/**
 * Factory creating persistent server universe stores for headless Node environments (`universe.server-storage@1.0.0`).
 */
export interface ServerUniverseStorage { create<T>(options: ServerUniverseOptions<T>): ServerUniverseStore<T> }
/** Service key for the server universe storage factory (`universe.server-storage@1.0.0`). */
export const SERVER_UNIVERSE_STORAGE: ServiceKey<ServerUniverseStorage> = Object.freeze({slot:'universe.server-storage',version:'1.0.0'});
