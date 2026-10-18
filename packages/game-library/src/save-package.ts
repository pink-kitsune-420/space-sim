import { savedProgressConfiguration } from './progress-configuration';
import type { WorldSave } from '../../sim-core/src/save';
import { keys, object } from '../../game-runtime/src/validation';
import { createIntegrity, jsonBytes, parsePackageJson, requiredFile, verifyIntegrity } from './portable';
import { isCompressed, MAX_EXPANDED_BYTES, readJsonFile } from './compression';
import { isZip, readZip, writeZip, type PackageFiles, type ZipOptions } from './zip';

export const UNIVERSE_SAVE_FORMAT = 'spacelab-universe-save/1';
const JSON_LIMIT = 1024 * 1024;
interface SaveDescriptor {
  readonly format: typeof UNIVERSE_SAVE_FORMAT;
  readonly state: 'state/universe.json'; readonly definition: 'data/universe.json';
  readonly pilots: 'state/pilots.json'; readonly ships: readonly string[]; readonly modules: 'state/modules.json';
}
/** Only containers change. Saved float64 values, model, locks and engine schema stay intact. */
export function createSaveFiles(save: WorldSave): Map<string, Uint8Array<ArrayBuffer>> {
  if (save.format !== 'space-sim-world' || !Array.isArray(save.ships) || !Array.isArray(save.players)) throw new Error('Expected a universe save');
  const configuration = savedProgressConfiguration(save);
  const { universe, players, ships, lock, simulationFingerprint, moduleState, configuration: _configuration, ...state } = save as WorldSave & { configuration?: unknown };
  const files = new Map<string, Uint8Array<ArrayBuffer>>([
    ['state/universe.json', jsonBytes(state)], ['data/universe.json', jsonBytes(universe)], ['state/pilots.json', jsonBytes(players)],
    ['state/modules.json', jsonBytes({ ...(configuration ? { configuration } : {}), ...(lock === undefined ? {} : { lock }), ...(simulationFingerprint === undefined ? {} : { simulationFingerprint }), ...(moduleState === undefined ? {} : { moduleState }) })],
  ]);
  let expanded = [...files.values()].reduce((sum, bytes) => sum + bytes.length, 0);
  if ([...files.values()].some(bytes => bytes.length > JSON_LIMIT)) throw new Error('Save metadata/definitions exceed the 1 MiB per-file limit');
  const paths: string[] = [];
  let batch: WorldSave['ships'][number][] = [], bytes = 2;
  const flush = () => {
    if (!batch.length) return;
    const path = `state/ships/${String(paths.length).padStart(4, '0')}.json`;
    const contents = jsonBytes(batch);
    expanded += contents.length;
    if (expanded > MAX_EXPANDED_BYTES || paths.length >= 1000) throw new Error('Universe save exceeds expanded size/file limits');
    paths.push(path); files.set(path, contents); batch = []; bytes = 2;
  };
  for (const ship of ships) {
    const size = jsonBytes(ship).length;
    if (size + 2 > JSON_LIMIT) throw new Error('A saved ship exceeds the 1 MiB per-record limit');
    if (bytes + size + 1 > JSON_LIMIT) flush();
    batch.push(ship); bytes += size + 1;
  }
  flush();
  const descriptor: SaveDescriptor = { format: UNIVERSE_SAVE_FORMAT, state: 'state/universe.json', definition: 'data/universe.json', pilots: 'state/pilots.json', ships: paths, modules: 'state/modules.json' };
  files.set('save.json', jsonBytes(descriptor)); files.set('integrity.json', jsonBytes(createIntegrity(files)));
  inspectSaveFiles(files);
  return files;
}
/** Inert structural inspection; installed-world loading still validates physical/save semantics. */
export function inspectSaveFiles(files: PackageFiles): WorldSave {
  verifyIntegrity(files);
  const d = object(parsePackageJson(requiredFile(files, 'save.json'), 'Universe save'), 'Universe save');
  keys(d, ['format', 'state', 'definition', 'pilots', 'ships', 'modules'], 'Universe save');
  if (d.format !== UNIVERSE_SAVE_FORMAT || d.state !== 'state/universe.json' || d.definition !== 'data/universe.json'
    || d.pilots !== 'state/pilots.json' || d.modules !== 'state/modules.json' || !Array.isArray(d.ships) || d.ships.length > 1000) throw new Error('Unsupported universe save layout');
  const paths = new Set(['save.json', 'integrity.json', d.state, d.definition, d.pilots, d.modules]);
  const ships: unknown[] = [];
  for (const [index, path] of d.ships.entries()) {
    if (path !== `state/ships/${String(index).padStart(4, '0')}.json`) throw new Error('Invalid saved-ship chunk');
    paths.add(path);
    const batch = parsePackageJson(requiredFile(files, path), 'Saved ships');
    if (!Array.isArray(batch) || !batch.length || ships.length + batch.length > 65536) throw new Error('Invalid saved ship count');
    for (const ship of batch) ships.push(ship);
  }
  if ([...files.keys()].some(path => !paths.has(path))) throw new Error('Unexpected save entry; universe saves never contain executable modules');
  const state = object(parsePackageJson(requiredFile(files, d.state), 'Universe state'), 'Universe state');
  keys(state, ['format', 'version', 'model', 'units', 'worldId', 'savedAt', 'systemId', 'tick', 'time', 'paused', 'nextShipNumber', 'hostId'], 'Universe state');
  if (state.format !== 'space-sim-world') throw new Error('Unsupported saved state');
  const modules = object(parsePackageJson(requiredFile(files, d.modules), 'Saved module state'), 'Saved module state');
  keys(modules, ['lock', 'simulationFingerprint', 'moduleState', 'configuration'], 'Saved module state');
  savedProgressConfiguration(modules);
  const players = parsePackageJson(requiredFile(files, d.pilots), 'Saved pilots');
  if (!Array.isArray(players) || players.length > 512) throw new Error('Invalid saved pilot count');
  const universe = parsePackageJson(requiredFile(files, d.definition), 'Saved universe definition');
  // The engine receives precisely the same v1/v2 save value it received before container migration.
  return { ...state, universe, players, ships, ...modules } as unknown as WorldSave;
}
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
