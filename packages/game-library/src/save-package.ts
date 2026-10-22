/** Host-only `.spaceuniverse` saved-progress codec (`packages/game-library`). Modules cannot import this package (`packages/module-tools/check-boundaries.mjs`); modules use `CORE_UNIVERSE_FORMAT` (`UniverseSaveFormat.encode` and `decode`) and `CORE_SAVE`. */
import { PAGE_INVENTORY, readSavedPages, writeSavedPages } from './save-pages';
import { savedProgressConfiguration } from './progress-configuration';
import type { WorldSave } from '../../sim-core/src/save';
import { keys, object } from '../../game-runtime/src/validation';
import { createIntegrity, jsonBytes, parsePackageJson, requiredFile, verifyIntegrity } from './portable';
import { isCompressed, MAX_EXPANDED_BYTES, readJsonFile } from './compression';
import { isZip, readZip, writeZip, type PackageFiles, type ZipOptions } from './zip';

/** `save.json` format of a universe save; `spacelab-universe-save/2` adds module-data chunks; `/3` adds binary sparse pages. Saves never contain executable modules. Host-only (`packages/game-library`). */
export const UNIVERSE_SAVE_FORMAT = 'spacelab-universe-save/1';
const JSON_LIMIT = 1024 * 1024;
interface SaveDescriptor {
  readonly format: typeof UNIVERSE_SAVE_FORMAT | 'spacelab-universe-save/2' | 'spacelab-universe-save/3';
  readonly data?: readonly string[];
  readonly pages?: 'state/pages.json';
  readonly state: 'state/universe.json'; readonly definition: 'data/universe.json';
  readonly pilots: 'state/pilots.json'; readonly ships: readonly string[]; readonly modules: 'state/modules.json';
}
/** Container layout 3 stores world-version-5 pages as exact binary chunks. Float64 state,
 * model, lock identities, module data and older valid save layouts remain intact. */
export function createSaveFiles(save: WorldSave): Map<string, Uint8Array<ArrayBuffer>> {
  if (save.format !== 'space-sim-world' || !Array.isArray(save.ships) || !Array.isArray(save.players)) throw new Error('Expected a universe save');
  const configuration = savedProgressConfiguration(save);
  const { universe, players, ships, lock, simulationFingerprint, moduleState, data, flightPlans, configuration: _configuration, ...state } = save as WorldSave & { configuration?: unknown };
  const files = new Map<string, Uint8Array<ArrayBuffer>>();
  const savedModuleState = writeSavedPages(moduleState, files);
  const hasPages = files.has(PAGE_INVENTORY);
  if (hasPages && save.version !== 5) throw new Error('Sparse pages require world save version 5');
  for (const [path, bytes] of new Map<string, Uint8Array<ArrayBuffer>>([
    ['state/universe.json', jsonBytes(state)], ['data/universe.json', jsonBytes(universe)], ['state/pilots.json', jsonBytes(players)],
    ['state/modules.json', jsonBytes({ ...(flightPlans ? { flightPlans } : {}), ...(configuration ? { configuration } : {}), ...(lock === undefined ? {} : { lock }), ...(simulationFingerprint === undefined ? {} : { simulationFingerprint }), ...(savedModuleState === undefined ? {} : { moduleState: savedModuleState }), ...(data ? { data: { format: data.format, revision: data.revision, schemas: data.schemas } } : {}) })],
  ])) files.set(path, bytes);
  let expanded = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if ([...files.values()].some(bytes => bytes.length > JSON_LIMIT)) throw new Error('Save metadata/definitions exceed the 1 MiB per-file limit');
  const chunk = (records: readonly unknown[], directory: string): string[] => {
    const paths: string[] = [];
    let batch: unknown[] = [], bytes = 2;
    const flush = () => {
      if (!batch.length) return;
      const path = `state/${directory}/${String(paths.length).padStart(4, '0')}.json`, contents = jsonBytes(batch);
      expanded += contents.length;
      if (expanded > MAX_EXPANDED_BYTES || files.size >= 1000) throw new Error('Universe save exceeds expanded size/file limits');
      paths.push(path); files.set(path, contents); batch = []; bytes = 2;
    };
    for (const record of records) {
      const size = jsonBytes(record).length;
      if (size + 2 > JSON_LIMIT) throw new Error('A saved record exceeds the 1 MiB per-record limit');
      if (bytes + size + 1 > JSON_LIMIT) flush();
      batch.push(record); bytes += size + 1;
    }
    flush(); return paths;
  };
  const paths = chunk(ships, 'ships'), dataPaths = data ? chunk(data.records, 'data') : undefined;
  const descriptor: SaveDescriptor = { format: hasPages || save.version === 5 ? 'spacelab-universe-save/3' : data ? 'spacelab-universe-save/2' : UNIVERSE_SAVE_FORMAT,
    ...(hasPages ? { pages: PAGE_INVENTORY } : {}),
    ...(dataPaths ? { data: dataPaths } : {}), state: 'state/universe.json', definition: 'data/universe.json', pilots: 'state/pilots.json', ships: paths, modules: 'state/modules.json' };
  files.set('save.json', jsonBytes(descriptor));
  if (files.size >= 1000 || [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > MAX_EXPANDED_BYTES) throw new Error('Universe save exceeds expanded size/file limits');
  files.set('integrity.json', jsonBytes(createIntegrity(files)));
  inspectSaveFiles(files);
  return files;
}
/** Inert structural inspection; installed-world loading still validates physical/save semantics. */
export function inspectSaveFiles(files: PackageFiles): WorldSave {
  if (files.size > 1000 || [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0) > MAX_EXPANDED_BYTES) throw new Error('Universe save exceeds expanded size/file limits');
  verifyIntegrity(files);
  const d = object(parsePackageJson(requiredFile(files, 'save.json'), 'Universe save'), 'Universe save');
  keys(d, ['format', 'state', 'definition', 'pilots', 'ships', 'modules', 'data', 'pages'], 'Universe save');
  if ((d.format !== UNIVERSE_SAVE_FORMAT && d.format !== 'spacelab-universe-save/2' && d.format !== 'spacelab-universe-save/3') || d.state !== 'state/universe.json' || d.definition !== 'data/universe.json'
    || d.pilots !== 'state/pilots.json' || d.modules !== 'state/modules.json' || !Array.isArray(d.ships) || d.ships.length > 1000) throw new Error('Unsupported universe save layout');
  const paths = new Set(['save.json', 'integrity.json', d.state, d.definition, d.pilots, d.modules]);
  const unchunk = (raw: unknown, directory: string, limit: number): unknown[] => {
    if (!Array.isArray(raw) || raw.length > 1000) throw new Error('Invalid saved record chunks');
    const records: unknown[] = [];
    for (const [index, path] of raw.entries()) {
      if (path !== `state/${directory}/${String(index).padStart(4, '0')}.json`) throw new Error('Invalid saved record chunk');
      paths.add(path);
      const batch = parsePackageJson(requiredFile(files, path), 'Saved records');
      if (!Array.isArray(batch) || !batch.length || records.length + batch.length > limit) throw new Error(directory === 'ships' ? 'Invalid saved ship count' : 'Invalid saved module-data record count');
      for (const record of batch) records.push(record);
    }
    return records;
  };
  const ships = unchunk(d.ships, 'ships', 65536);
  if (d.format === UNIVERSE_SAVE_FORMAT && d.data !== undefined) throw new Error('Module-data chunks require save layout version 2');
  const dataRecords = d.format === 'spacelab-universe-save/2' || d.format === 'spacelab-universe-save/3' && d.data !== undefined ? unchunk(d.data, 'data', 4096) : undefined;
  if (d.pages !== undefined && (d.format !== 'spacelab-universe-save/3' || d.pages !== PAGE_INVENTORY)) throw new Error('Sparse pages require save layout version 3');
  const state = object(parsePackageJson(requiredFile(files, d.state), 'Universe state'), 'Universe state');
  keys(state, ['format', 'version', 'model', 'units', 'worldId', 'savedAt', 'systemId', 'tick', 'time', 'paused', 'nextShipNumber', 'hostId', 'vehicles', 'avatars', 'bodies', 'gameId'], 'Universe state');
  if (state.gameId !== undefined && (typeof state.gameId !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(state.gameId))) throw new Error('Invalid saved game identity');
  if (state.format !== 'space-sim-world') throw new Error('Unsupported saved state');
  const modules = object(parsePackageJson(requiredFile(files, d.modules), 'Saved module state'), 'Saved module state');
  keys(modules, ['lock', 'simulationFingerprint', 'moduleState', 'configuration', 'data', 'flightPlans'], 'Saved module state');
  savedProgressConfiguration(modules);
  const players = parsePackageJson(requiredFile(files, d.pilots), 'Saved pilots');
  if (!Array.isArray(players) || players.length > 512) throw new Error('Invalid saved pilot count');
  const universe = parsePackageJson(requiredFile(files, d.definition), 'Saved universe definition');
  if ((dataRecords && ((state.version !== 3 && state.version !== 4 && state.version !== 5) || modules.data === undefined)) || (!dataRecords && modules.data !== undefined)) throw new Error('Module-data save layout/version mismatch');
  const data = dataRecords ? { ...object(modules.data, 'Saved module data'), records: dataRecords } : undefined;
  if (d.format === 'spacelab-universe-save/3' && state.version !== 5 || state.version === 5 && d.format !== 'spacelab-universe-save/3') throw new Error('Sparse-page world/save layout version mismatch');
  if (d.pages !== undefined) modules.moduleState = readSavedPages(modules.moduleState, files, paths);
  else if (d.format === 'spacelab-universe-save/3' && Object.values((modules.moduleState ?? {}) as Record<string, { pages?: unknown }>).some(entry => entry?.pages !== undefined)) throw new Error('Missing saved page inventory');
  if ([...files.keys()].some(path => !paths.has(path))) throw new Error('Unexpected save entry; universe saves never contain executable modules');
  // The engine receives the same JSON-safe save value as the direct JSON codec.
  return { ...state, universe, players, ships, ...modules, ...(data ? { data } : {}) } as unknown as WorldSave;
}
/** Writes a world save as a `.spaceuniverse` ZIP: at most 1 MiB per JSON entry, ship and module-data records in chunks of up to 1 MiB, at most 1,000 entries and 64 MiB expanded. Host-only (`packages/game-library`). */
export async function encodeUniverseSave(save: WorldSave, options: ZipOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  return writeZip(createSaveFiles(save), options);
}
/** Sniff contents because older .spaceuniverse files held definitions, and old saves were JSON.
 * Returns data only; callers select the save or definition importer by its declared format. */
export async function decodeUniverseSave(bytes: Uint8Array<ArrayBuffer>, options: ZipOptions = {}): Promise<unknown> {
  options.signal?.throwIfAborted();
  if (isZip(bytes)) {
    const files = await readZip(bytes, options);
    if (!files.has('save.json')) throw new Error('This file is setup or reusable data. Use Library or Setup → Import…');
    return inspectSaveFiles(files);
  }
  const raw = isCompressed(bytes) ? await readJsonFile(bytes) : parsePackageJson(bytes, 'Legacy universe save', MAX_EXPANDED_BYTES, 4 * 1024 * 1024);
  if (raw && typeof raw === 'object' && ('systems' in raw || 'bodies' in raw)) throw new Error('This file contains universe definitions. Use Setup → Import…');
  return raw;
}
