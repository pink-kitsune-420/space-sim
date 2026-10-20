// Host-side authoring tooling (Node only). Modules cannot import packages/module-tools;
// they import only `@space-sim/game-api` and their own relative files.
import type { WorldSave } from '../sim-core/src/save';
import type { InspectedDataFile } from '../game-library/src/data-file';
import type { CodeArtifact } from '../game-runtime/src/artifact';
import type { InspectedModule, ModulePackageDescriptor, ShippedPackageOptions } from '../game-library/src/portable';
import type { InspectedGame } from '../game-library/src/game-package';
import type { PackageFiles } from '../game-library/src/zip';
export const RESERVED_KEYS: ReadonlySet<string>;
export const EVA_RESERVED_KEYS: ReadonlySet<string>;
export const EDITOR_RESERVED_KEYS: ReadonlySet<string>;
export function validateCommandKeyCollisions(moduleId: string, commands: readonly unknown[]): void;
export function validatePackage<T = unknown>(pkg: T): T;

/**
 * Loads the package contracts (ZIP codec, descriptor, data, save and game inspection, integrity
 * and limits) by bundling `packages/game-library/src/tooling.ts` in memory once per process.
 * The result is cached; no files are written and no package code is evaluated.
 */
export function packageContracts(): Promise<typeof import('../game-library/src/tooling')>;
/**
 * Reads a package folder into a map of portable `/`-separated paths to file bytes. Read-only.
 * The folder path and its parents may not be symbolic links, and every entry must be a regular,
 * non-executable file or folder within the package limits (1,024 files, per-file limits,
 * 64 MiB in total).
 * @throws Error "Symlink path forbidden: <path>", "Regular files only: <path>",
 *   "Executable file permissions forbidden: <path>", "Folder exceeds package limits", or an
 *   invalid portable path.
 */
export function readModuleFolder(directory: string): Promise<Map<string, Uint8Array<ArrayBuffer>>>;
/**
 * Builds a `spacelab-module-package/1` or `spacelab-data-package/1` folder (`module:build`).
 * For a code provider it type-checks and bundles the source with {@link buildModule}, then
 * rewrites `module.json` with refreshed `inputs` and `build` metadata. It always writes
 * `module.json` (or `data.json`), `dist/module.js` for code and `integrity.json` back into the
 * source folder, then inspects the result as a playable package. Module code is never executed.
 * @param configPath The folder's `module.json` or `data.json`.
 * @param outputPath Optional archive path: a name ending in `.module.json` writes a v1 code
 *   artifact; anything else writes a `.spacemod` ZIP. Parent folders are created; the path is
 *   not checked against the source folder, so keep it outside.
 * @param options `typecheck` (default true); `shippedBuild` permits a reserved `builtin.*` ID
 *   and pins its digest for this build only (distribution builds).
 * @throws Error "Legacy source descriptor: …" for a descriptor without a package format,
 *   "Shipped builtin source requires an explicit shipped build; fork under a creator namespace",
 *   "Original editable source is unavailable; supply source in a new creator package to rebuild",
 *   and any {@link readModuleFolder} or {@link buildModule} error.
 */
export function buildPortableModule(configPath: string, outputPath?: string, options?: { typecheck?: boolean; shippedBuild?: boolean }): Promise<InspectedModule>;
/**
 * Packs a folder into a ZIP archive (`module:pack`, `file:pack`) without compiling anything.
 * Computes a fresh `integrity.json` for the archive only (the folder is not changed), inspects
 * the contents by their descriptor (`save.json`, `game.json`, `data.json`, otherwise a playable
 * code module) and writes the archive, creating parent folders.
 * @param options `compression` (`auto` by default, `store` with the CLI's `--store`);
 *   `shipped` recognizes exact `builtin.*` pins.
 * @returns The inspected package, game, data file or save.
 * @throws Error "Write the archive outside its source folder", "Rebuild this module with
 *   module:build, then pack it again" for a stale bundle, "Unsupported module entry <path>",
 *   and any {@link readModuleFolder} or inspection error.
 */
export function packModule(directory: string, outputPath: string, options?: ShippedPackageOptions & { compression?: 'store' | 'deflate' | 'auto' }): Promise<InspectedModule | InspectedGame | InspectedDataFile | WorldSave>;
/**
 * Extracts a `.spacemod`, `.spacedata`, `.spacegame` or `.spaceuniverse` ZIP (`module:unpack`,
 * `file:unpack`). The whole archive is read within size limits and inspected before the
 * destination is created; a code module may have a missing or stale bundle. Files are created
 * exclusively with mode 0644 inside the destination. Nothing is executed.
 * @param directory Destination; must be new or an empty folder.
 * @throws Error "Unpack destination must be a new or empty directory", "Extraction outside
 *   destination", "Symlink path forbidden: <path>", or an archive inspection error such as
 *   "Imported builtin identities require an exact shipped catalogue pin; …".
 */
export function unpackPackage(input: string, directory: string, options?: ShippedPackageOptions): Promise<PackageFiles>;
/**
 * Copies an editable code package under a new creator identity (`module:fork`). Changes the
 * manifest ID and literal occurrences of the old ID (quoted, or followed by `/`) in `src/` and
 * guides, drops `build` metadata and `dist/module.js`, appends the original identity and
 * inventory digest to `NOTICE`, and writes the folder. The fork must be rebuilt before import.
 * @param id New ID: lowercase, dotted, at least two parts, not `builtin.*`.
 * @param directory Destination (default `id`); must be new or an empty folder.
 * @throws Error "Choose a creator namespace such as local.my-module", "Choose a new identity for
 *   the fork", "Fork requires an editable code module", "Fork destination must be a new or empty
 *   directory", or an archive/integrity error.
 */
export function forkModule(input: string, id: string, directory?: string): Promise<{ readonly id: string; readonly originalDigest: string; readonly rebuildRequired: true }>;
/**
 * Scaffolds an editable package folder (`module:new`) with `module.json`, an empty
 * `src/main.ts` initializer, the checkout's `LICENSE` and a placeholder `NOTICE`. The manifest
 * currently uses API v1 (`space-sim-module/1`, `space-sim-game-api/1`), an authoritative
 * provider for browser, offline and node, version 0.1.0 and the MIT licence.
 * @param id Creator ID: lowercase, dotted, at least two parts, not `builtin.*`.
 * @param directory Destination (default `id`); must not exist yet, even as an empty folder.
 * @throws Error "Choose a creator namespace such as local.my-module", "Scaffold destination
 *   already exists".
 */
export function newModule(id: string, directory?: string): Promise<ModulePackageDescriptor>;
/**
 * Converts an older file or source folder into a package folder (`module:convert`); the input
 * is never changed. Data inputs (a `space-sim-code-module/1` artifact, `space-sim-data-module/1`,
 * `space-sim-shaders/1` JSON or a `.frag`/`.glsl` file, or universe JSON) are wrapped with the
 * original bytes in `legacy/original.bin`; a wrapped code artifact has no editable source and
 * cannot be rebuilt or forked. A legacy source descriptor is built from its real local source:
 * the inputs are copied to `src/` and `assets/`, a small `src/entry.ts` adapter keeps the old
 * asset keys, `NOTICE` lists every input licence, and the result is built in place. Review
 * `LICENSE`, which comes from the scaffold.
 * @param directory Destination; must not exist yet.
 * @param options `license` (SPDX name) is required for shader and universe data; `licenseFile`
 *   (original licence text) for all data conversions; `typecheck` defaults to true.
 * @throws Error "Data conversion requires --license-file …", "Specify the original author license
 *   with --license", "A legacy collection/profile converts with game:build; one .spacemod holds
 *   one module", "Conversion destination already exists", "Scaffold destination already exists",
 *   and any build error.
 */
export function convertModule(configPath: string, directory: string, options?: { typecheck?: boolean; license?: string; licenseFile?: string }): Promise<InspectedModule | CodeArtifact>;
/**
 * Builds and re-inspects a `.spacegame` ZIP (`game:build`). Accepts a game descriptor such as
 * `games/<game>/game.json`, a module profile (`space-sim-profile/1` or
 * `space-sim-module-profile/1`), or the `spacelab-game/2` `game.json` of an unpacked game, whose
 * `legacy/package.json` and `modules/<id>.spacemod` or `data/<id>.spacedata` files are read and
 * version-checked. Writes only `outputPath` (creating parent folders); never compiles or runs code.
 * @throws Error "Invalid game source descriptor", "Game references must use
 *   modules/<id>.spacemod or data/<id>.spacedata", "Game module version mismatch", "Target changes
 *   require a matching legacy profile; edit legacy/package.json before rebuilding", "Settings must
 *   belong to a selected module", or a provider/validation error such as "Provider motion: missing
 *   required provider".
 */
export function buildGame(inputPath: string, outputPath: string, options?: ShippedPackageOptions): Promise<InspectedGame>;
/**
 * CLI behind the `module:*`, `game:*` and `file:*` npm scripts: `args` is
 * `[command, input, output?, ...flags]` with command `new`, `fork`, `convert`, `build`, `pack`,
 * `unpack`, `game-build`, `validate` or `game-validate`. Flags: `--catalogue=path` (a
 * `spacelab-shipped-modules/1` pin file), `--shipped-build` (build), `--store` (pack),
 * `--license SPDX` and `--license-file path` (convert). `validate` accepts a folder, a ZIP or a
 * v1 `.module.json` artifact; `game-validate` requires a game. Relative paths resolve from the
 * process working directory (the checkout root under npm).
 * Prints "Completed <command>: <digest or input>. Code was not executed." on success. On failure
 * prints one message to stderr (the usage line for a missing argument or unknown command, "Archive
 * exceeds 32 MiB", "Expected a .spacegame collection", …) and sets `process.exitCode = 1`;
 * it never rejects.
 */
export function run(args: readonly string[]): Promise<void>;
