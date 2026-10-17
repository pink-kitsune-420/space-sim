import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { DEFAULT_PORT } from '../../../packages/net/src/websocket';

export interface ServerConfig {
  /** Shown to joining players. */
  readonly name: string;
  readonly host: string;
  readonly port: number;
  /** Empty for none. */
  readonly password: string;
  readonly maxPlayers: number;
  readonly maxShipsPerPlayer: number;
  readonly maxShips: number;
  readonly allowGodMode: boolean;
  /** Freeze the world while nobody is connected, so no one returns to a crashed ship. */
  readonly pauseWhenEmpty: boolean;
  readonly autosaveSeconds: number;
  /** How often a timestamped copy goes to backups/. */
  readonly backupMinutes: number;
  readonly keepBackups: number;
  readonly snapshotsPerSecond: number;
  /** For new worlds: default, terrain, ocean, solar, or a universe JSON path (relative to the data folder). */
  readonly universe: string;
  /** For new worlds; empty for the universe's default system. */
  readonly system: string;
  /** Where players' first ship starts; empty for the system's first start. */
  readonly spawnPreset: string;
  /** Serve the game itself, so players can open http://host:port in a browser. */
  readonly serveGame: boolean;
  /** Owner-installed trusted code artifacts, never downloaded from peers. */
  readonly moduleDirectory: string;
  /** Local exported module profile for new worlds; existing saves require exact installed artifacts. */
  readonly moduleProfile: string;
  /** Owner-selected portable Spacelab game; includes its exact plugins and data. */
  readonly gameFile: string;
}

export const DEFAULT_CONFIG: ServerConfig = Object.freeze({
  name: 'Space Sim server', host: '0.0.0.0', port: DEFAULT_PORT, password: '', maxPlayers: 16,
  maxShipsPerPlayer: 5, maxShips: 128, allowGodMode: true, pauseWhenEmpty: true, autosaveSeconds: 60,
  backupMinutes: 15, keepBackups: 24, snapshotsPerSecond: 20, universe: 'default', system: '', spawnPreset: '',
  serveGame: true, moduleDirectory: '', moduleProfile: '', gameFile: '',
});

const LIMITS: Partial<Record<keyof ServerConfig, readonly [number, number]>> = {
  port: [0, 65535], maxPlayers: [1, 256], maxShipsPerPlayer: [1, 64], maxShips: [1, 65536],
  autosaveSeconds: [5, 86400], backupMinutes: [1, 10080], keepBackups: [0, 1000], snapshotsPerSecond: [1, 50],
};

/** Check one config object's fields: unknown keys and wrong types are errors, so a typo
 * never silently falls back to a default. */
export function validateConfig(raw: unknown, source: string): Partial<ServerConfig> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${source}: must be a JSON object`);
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$') || key.startsWith('//')) continue;
    if (!(key in DEFAULT_CONFIG)) throw new Error(`${source}: unknown setting "${key}"`);
    const expected = typeof DEFAULT_CONFIG[key as keyof ServerConfig];
    if (typeof value !== expected) throw new Error(`${source}: "${key}" must be a ${expected}`);
    const range = LIMITS[key as keyof ServerConfig];
    if (range && (!Number.isInteger(value) || (value as number) < range[0] || (value as number) > range[1])) {
      throw new Error(`${source}: "${key}" must be a whole number from ${range[0]} to ${range[1]}`);
    }
    if (key === 'password' && (value as string).length > 128) throw new Error(`${source}: "password" is too long`);
    out[key] = value;
  }
  return out as Partial<ServerConfig>;
}

/** Read `server.json` from the data folder, writing the defaults on first run so the
 * operator has a file to edit. Command-line overrides apply on top and are not saved. */
export async function loadConfig(dataDir: string, overrides: Partial<ServerConfig> = {}): Promise<ServerConfig> {
  const path = join(dataDir, 'server.json');
  let fromFile: Partial<ServerConfig> = {};
  try {
    fromFile = validateConfig(JSON.parse(await readFile(path, 'utf8')), path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error instanceof SyntaxError ? new Error(`${path}: ${error.message}`) : error;
    }
    await mkdir(dataDir, { recursive: true });
    await writeFile(path, `${JSON.stringify(DEFAULT_CONFIG, null, 2)}\n`);
  }
  return { ...DEFAULT_CONFIG, ...fromFile, ...overrides };
}

export interface CommandLine {
  readonly overrides: Partial<ServerConfig>;
  readonly data?: string;
  readonly importSave?: string;
  readonly newWorld: boolean;
  readonly open: boolean;
  readonly help: boolean;
  readonly version: boolean;
}

export const USAGE = `Usage: space-sim-server [options]

Runs a Space Sim world that players join from the game (Multiplayer → Join).
Settings live in <data>/server.json, created on first run; options override them.

  --data <folder>        World, settings and backups (default: space-sim-data)
  --port <number>        Port for players and the web page (default: ${DEFAULT_PORT})
  --host <address>       Interface to listen on (default: 0.0.0.0, all)
  --name <text>          Server name shown to players
  --password <text>      Require a password to join
  --universe <name|file> New worlds only: default, terrain, ocean, solar, full, JSON or .spaceuniverse
  --system <id>          New worlds only: system to load
  --module-directory <dir> Owner-installed trusted *.module.json code (relative to data)
  --module-profile <file> Local exported data/code profile for new worlds
  --game <file>          Owner-selected .spacegame package (relative to data)
  --import <save.json>   Replace the world with a save exported from the game
  --new                  Start a new world (the current one is backed up first)
  --open                 Open the game in this computer's browser
  --version              Print the version
  --help                 Show this help

While running, type "help" for commands such as status, save and stop.`;

export function parseCommandLine(argv: readonly string[]): CommandLine {
  const { values } = parseArgs({
    args: [...argv], allowPositionals: false, strict: true,
    options: {
      data: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' }, name: { type: 'string' },
      password: { type: 'string' }, universe: { type: 'string' }, system: { type: 'string' },
      'module-directory': { type: 'string' }, 'module-profile': { type: 'string' },
      game: { type: 'string' },
      import: { type: 'string' }, new: { type: 'boolean' }, open: { type: 'boolean' },
      version: { type: 'boolean', short: 'v' }, help: { type: 'boolean', short: 'h' },
    },
  });
  const overrides: Record<string, unknown> = {};
  if (values['module-directory'] !== undefined) overrides.moduleDirectory = values['module-directory'];
  if (values['module-profile'] !== undefined) overrides.moduleProfile = values['module-profile'];
  if (values.game !== undefined) overrides.gameFile = values.game;
  if (values.port !== undefined) {
    if (!/^\d+$/.test(values.port)) throw new Error('--port must be a number');
    overrides.port = Number(values.port);
  }
  for (const key of ['host', 'name', 'password', 'universe', 'system'] as const) {
    if (values[key] !== undefined) overrides[key] = values[key];
  }
  return {
    overrides: validateConfig(overrides, 'Command line'),
    ...(values.data !== undefined ? { data: values.data } : {}),
    ...(values.import !== undefined ? { importSave: values.import } : {}),
    newWorld: values.new ?? false, open: values.open ?? false, help: values.help ?? false, version: values.version ?? false,
  };
}
