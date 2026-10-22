import { afterAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeUniverseSave, decodeUniverseSave, createSaveFiles, inspectSaveFiles } from '../../packages/game-library/src/save-package';
import { encodeUniverse, decodeUniverse } from '../../packages/game-library/src/universe';
import { decodeLabFile } from '../../packages/game-library/src/archive';
import { encodeDataFile, decodeDataFile } from '../../packages/game-library/src/data-file';
import { createIntegrity, jsonBytes } from '../../packages/game-library/src/portable';
import { readZip, writeZip } from '../../packages/game-library/src/zip';
import { loadWorld, saveWorld, type WorldSave } from '../../packages/sim-core/src/save';
import { prepareGame } from '../../packages/modules/src/index';
import { startServer } from '../../apps/server/src/server';
import { gzipSync } from 'node:zlib';
import fixture from '../fixtures/world-save-v1.json' with { type: 'json' };
import { assertGameProgress, gamePreferenceKey, gameProgressFormat, CLASSIC_GAME_ID, SUCCESSOR_GAME_ID } from '../../packages/game-library/src/game-progress';

const directories: string[] = [];
const signal = new AbortController().signal;
afterAll(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); });
function saved(): WorldSave {
  const game = prepareGame({ environment: 'node' });
  try {
    game.world.spawn({ ownerId: 'pilot', presetId: 'planet-orbit' }); game.world.step();
    return saveWorld(game.world, { players: [{ id: 'pilot', name: 'Pilot' }], hostId: 'pilot', paused: true });
  } finally { game.candidate.dispose(); }
}
describe('separate universe saves and reusable data files', () => {
  it('keeps legacy progress associated with Classic and rejects foreign or malformed ownership', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(fixture));
    expect(await gameProgressFormat(() => CLASSIC_GAME_ID).decode(bytes, signal)).toEqual(fixture);
    await expect(gameProgressFormat(() => SUCCESSOR_GAME_ID).decode(bytes, signal)).rejects.toThrow('Space Sim Classic');
    expect(() => assertGameProgress({ ...fixture, gameId: 42 }, CLASSIC_GAME_ID)).toThrow('Invalid saved game identity');
    const loaded = loadWorld(fixture);
    try { expect(loaded.world.tick).toBe(fixture.tick); expect(loaded.world.ships().length).toBe(fixture.ships.length); }
    finally { loaded.world.dispose(); }
  });
  it('round trips separate progress across game switches without changing physical saved bits', async () => {
    let active = CLASSIC_GAME_ID;
    const format = gameProgressFormat(() => active), classic = saved();
    const classicBytes = await format.encode(classic, signal);
    active = SUCCESSOR_GAME_ID;
    const successor = { ...saved(), tick: 77, time: 77 / 60 };
    const successorBytes = await format.encode(successor, signal);
    await expect(format.decode(classicBytes, signal)).rejects.toThrow(CLASSIC_GAME_ID);
    expect(await format.decode(successorBytes, signal)).toEqual({ ...successor, gameId: SUCCESSOR_GAME_ID });
    active = CLASSIC_GAME_ID;
    await expect(format.decode(successorBytes, signal)).rejects.toThrow(SUCCESSOR_GAME_ID);
    expect(await format.decode(classicBytes, signal)).toEqual({ ...classic, gameId: CLASSIC_GAME_ID });
    expect(await decodeUniverseSave(successorBytes)).toEqual({ ...successor, gameId: SUCCESSOR_GAME_ID });
  });
  it('retains installed creator progress imports while isolating the built-in successor', async () => {
    let active = 'local.device-game';
    const format = gameProgressFormat(() => active), custom = saved();
    const customBytes = await format.encode(custom, signal);
    active = CLASSIC_GAME_ID;
    expect(await format.decode(customBytes, signal)).toEqual({ ...custom, gameId: 'local.device-game' });
    active = SUCCESSOR_GAME_ID;
    await expect(format.decode(customBytes, signal)).rejects.toThrow('local.device-game');
    const successorBytes = await format.encode(custom, signal);
    active = 'local.device-game';
    await expect(format.decode(successorBytes, signal)).rejects.toThrow(SUCCESSOR_GAME_ID);
    const legacyBytes = new TextEncoder().encode(JSON.stringify(fixture));
    expect(await format.decode(legacyBytes, signal)).toEqual(fixture);
  });
  it('preserves legacy gameplay preference keys and separates successor choices', () => {
    for (const key of ['space-sim:god-mode:v1', 'space-sim:throw-cheat:v1', 'space-sim:activation-throttle:v1', 'space-sim.planet-looks/1']) {
      expect(gamePreferenceKey(key, CLASSIC_GAME_ID)).toBe(key);
      expect(gamePreferenceKey(key, SUCCESSOR_GAME_ID)).toBe(`${key}:${SUCCESSOR_GAME_ID}`);
    }
  });
  it('round trips every saved bit with organized state/data and no embedded modules', async () => {
    const save = saved(), bytes = await encodeUniverseSave(save), files = await readZip(bytes);
    expect([...files.keys()]).toEqual(expect.arrayContaining(['save.json', 'state/universe.json', 'state/pilots.json', 'state/modules.json', 'state/ships/0000.json', 'data/universe.json']));
    expect([...files.keys()].some(path => path.startsWith('modules/') || path.startsWith('src/'))).toBe(false);
    const restored = await decodeUniverseSave(bytes) as WorldSave;
    expect(restored).toEqual(save); expect(await decodeLabFile(bytes)).toEqual(save);
    const loaded = loadWorld(restored);
    try { expect(loaded.world.simulationFingerprint).toBe(save.simulationFingerprint); expect(loaded.world.tick).toBe(save.tick); }
    finally { loaded.world.dispose(); }
  });
  it('retains legacy JSON v1 saves and distinguishes older .spaceuniverse definition files by bytes', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(fixture));
    expect(await decodeUniverseSave(bytes)).toEqual(fixture);
    const old = new Uint8Array(gzipSync(JSON.stringify(saved().universe)));
    expect(await decodeUniverse(old)).toEqual(saved().universe);
    await expect(decodeUniverseSave(old)).rejects.toThrow('definitions');
    await expect(decodeUniverse(await encodeUniverseSave(saved()))).rejects.toThrow('saved progress');
    await expect(decodeUniverseSave(await encodeUniverse(saved().universe))).rejects.toThrow('reusable data');
  });
  it('exports standalone definitions and data with integrity, no invented module identity/licence or progress', async () => {
    const save = saved(), bytes = await encodeUniverse(save.universe), files = await readZip(bytes);
    expect([...files.keys()].sort()).toEqual(['data.json', 'data/universe.json', 'integrity.json']);
    const descriptor = JSON.parse(new TextDecoder().decode(files.get('data.json')));
    expect(descriptor).toEqual({ format: 'spacelab-data/1', kind: 'universe', path: 'data/universe.json' });
    expect(await decodeUniverse(bytes)).toEqual(save.universe);
    const shaders = { format: 'space-sim-shaders/1', name: 'Test', passes: { scene: { fragment: 'void main() {}' } } };
    expect(await decodeDataFile(await encodeDataFile('shaders', shaders), 'shaders')).toEqual(shaders);
    await expect(decodeDataFile(bytes, 'shaders')).rejects.toThrow('contains universe');
  });
  it('rejects corruption, unexpected code and tampered saved chunks before loading', async () => {
    const files = createSaveFiles(saved()); files.set('state/ships/0000.json', jsonBytes([]));
    expect(() => inspectSaveFiles(files)).toThrow('digest');
    files.set('integrity.json', jsonBytes(createIntegrity(files)));
    expect(() => inspectSaveFiles(files)).toThrow('ship count');
    const executable = createSaveFiles(saved()); executable.set('modules/evil.js', new TextEncoder().encode('throw new Error()'));
    executable.set('integrity.json', jsonBytes(createIntegrity(executable)));
    await expect(decodeUniverseSave(await writeZip(executable))).rejects.toThrow('never contain executable');
  });
  it('splits large fleets into bounded ship files while retaining exact order', async () => {
    const save = saved(), ships = Array.from({ length: 6000 }, (_, index) => ({ ...save.ships[0]!, id: `ship-${index}`, name: `Ship ${index}` }));
    const files = createSaveFiles({ ...save, ships }), chunks = [...files].filter(([path]) => path.startsWith('state/ships/'));
    expect(chunks.length).toBeGreaterThan(1); expect(chunks.every(([, bytes]) => bytes.length <= 1024 * 1024)).toBe(true);
    expect(inspectSaveFiles(files).ships).toEqual(ships);
  });
  it('imports .spaceuniverse progress on the dedicated server and preserves its identity', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'space-save-server-')); directories.push(directory);
    const save = saved(), path = join(directory, 'flight.spaceuniverse'); await writeFile(path, await encodeUniverseSave(save));
    const server = await startServer({ dataDir: directory, importSave: path, overrides: { host: '127.0.0.1', port: 0 }, log: () => {} });
    try { expect(server.host.world.id).toBe(save.worldId); expect(server.host.world.simulationFingerprint).toBe(save.simulationFingerprint); }
    finally { await server.stop(); }
    expect(JSON.parse(await readFile(join(directory, 'world.json'), 'utf8')).worldId).toBe(save.worldId);
  });
});
