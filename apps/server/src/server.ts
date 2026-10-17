import { builtinContextFactory, prepareGame, loadInstalledWorld } from '../../../packages/modules/src/index';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { decodeUniverse } from '../../../packages/game-library/src/universe';
import { MAX_ARCHIVE_BYTES } from '../../../packages/game-library/src/compression';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isSea } from 'node:sea';
import { Clock, MODEL, type UniverseDefinition } from '../../../packages/sim-core/src/index';
import type { World } from '../../../packages/sim-core/src/world';
import { MAX_SAVE_SHIPS, saveWorld, type SavedPlayer } from '../../../packages/sim-core/src/save';
import { clearStress, populateStress } from '../../../packages/scenarios/stress';
import { HostSession } from '../../../packages/net/src/host';
import { MAX_CLIENT_MESSAGE, PROTOCOL } from '../../../packages/net/src/protocol';
import { SOCKET_PATH } from '../../../packages/net/src/websocket';
import { newWorldId } from '../../../packages/net/src/sha256';
import { BUILTIN_UNIVERSES } from '../../../packages/scenarios/builtin';
import { version } from '../../../package.json';
import { USAGE, loadConfig, parseCommandLine, type ServerConfig } from './config';
import { serverModules } from './modules';
import { WorldStore } from './store';
import { acceptWebSocket } from './websocket';

/** A bundled web-game file (base64), keyed by URL path. */
export interface ClientAsset { readonly type: string; readonly data: string }

export interface ServerOptions {
  readonly dataDir: string;
  readonly overrides?: Partial<ServerConfig>;
  /** A save exported from the game, replacing the current world after a backup. */
  readonly importSave?: string;
  readonly newWorld?: boolean;
  readonly assets?: Readonly<Record<string, ClientAsset>>;
  readonly log?: (message: string) => void;
}

export interface RunningServer {
  readonly config: ServerConfig;
  readonly host: HostSession;
  readonly store: WorldStore;
  readonly port: number;
  /** Save now unless nothing changed since the last save (or `force`). */
  save(force?: boolean): Promise<boolean>;
  stop(reason?: string): Promise<void>;
  /** Run one console command and return its output. */
  command(line: string): Promise<string>;
}

const MAX_SOCKETS = 256;
const SERVER_META = '<meta name="space-sim-server" content="1" />';

/** Local wall-clock time for log lines. */
export const timestamp = (date = new Date()): string => {
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
};
const clockText = (seconds: number): string => {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

async function resolveUniverse(setting: string, dataDir: string): Promise<UniverseDefinition> {
  const builtin = BUILTIN_UNIVERSES[setting];
  if (builtin) return builtin;
  const path = isAbsolute(setting) ? setting : join(dataDir, setting);
  try {
    if ((await stat(path)).size > MAX_ARCHIVE_BYTES) throw new Error('Universe file exceeds 32 MiB');
    return await decodeUniverse(new Uint8Array(await readFile(path)));
  } catch (error) {
    throw new Error(`Universe "${setting}" is not built in (${Object.keys(BUILTIN_UNIVERSES).join(', ')}) `
      + `and ${path} could not be loaded: ${(error as Error).message}`);
  }
}

/** Start a dedicated server: load or create the world, listen for players, advance the
 * world at 100 Hz and keep it saved. */
export async function startServer(options: ServerOptions): Promise<RunningServer> {
  const log = options.log ?? ((message: string) => console.log(`[${timestamp()}] ${message}`));
  const dataDir = resolve(options.dataDir);
  const config = await loadConfig(dataDir, options.overrides);
  const createContext = builtinContextFactory('node');
  const installed = await serverModules(config, dataDir);
  const restore = (raw: unknown) => loadInstalledWorld(raw, { environment: 'node', code: installed.code, data: installed.bundle?.modules });
  const store = new WorldStore(dataDir, config.keepBackups, log, createContext, restore);

  if (options.importSave) {
    const imported = restore(JSON.parse(await readFile(options.importSave, 'utf8')));
    const previous = await store.backup();
    if (previous) log(`Backed up the previous world to ${previous}.`);
    await store.save(saveWorld(imported.world, { players: imported.players, savedAt: new Date().toISOString() }));
    imported.world.dispose();
    log(`Imported ${options.importSave}.`);
  } else if (options.newWorld) {
    const previous = await store.backup();
    if (previous) log(`Backed up the previous world to ${previous}.`);
  }
  const existing = options.newWorld && !options.importSave ? undefined : await store.load();
  let world: World;
  let players: readonly SavedPlayer[] = [];
  if (existing) {
    ({ world, players } = existing.loaded);
    log(`Loaded world ${world.id} from ${existing.from}: ${world.system.system.name}, T+${clockText(world.time)}, `
      + `${world.size} ships, ${players.length} known players.`);
    if (existing.from === store.file) await store.backup();
  } else {
    const prepared = prepareGame({ environment: 'node', universe: await resolveUniverse(config.universe, dataDir),
      ...(config.system ? { systemId: config.system } : installed.bundle?.selection.system ? { systemId: installed.bundle.selection.system } : {}),
      data: installed.bundle?.modules, code: installed.code, profile: installed.bundle?.profile, universeKey: installed.bundle?.selection.universe, id: newWorldId() });
    prepared.runtime.activate(prepared.candidate);
    world = prepared.world;
    log(`Created world ${world.id}: ${world.universe.name} · ${world.system.system.name}.`);
  }
  if (world.soloPreview) { world.dispose(); throw new Error('Server module profile requires deterministic multiplayer support'); }
  if (config.spawnPreset && !world.system.presets.some(p => p.id === config.spawnPreset)) {
    throw new Error(`spawnPreset "${config.spawnPreset}" is not a start in ${world.system.system.name} `
      + `(${world.system.presets.map(p => p.id).join(', ')})`);
  }

  const host = new HostSession(world, {
    name: config.name, password: config.password, maxPlayers: config.maxPlayers,
    maxShipsPerPlayer: config.maxShipsPerPlayer, maxShips: config.maxShips, allowGodMode: config.allowGodMode,
    snapshotEveryTicks: Math.max(1, Math.round(100 / config.snapshotsPerSecond)),
    ...(config.spawnPreset ? { spawnPreset: config.spawnPreset } : {}),
  }, { players, log });

  // "Anything changed?" from the world's version and the roster, not by building the whole
  // save twice: a large world takes hundreds of milliseconds to serialize.
  let lastSaved = '';
  const save = async (force = false): Promise<boolean> => {
    const roster = host.roster();
    const key = `${world.version}|${JSON.stringify(roster)}`;
    if (!force && key === lastSaved) return false;
    await store.save(saveWorld(world, { players: roster, savedAt: new Date().toISOString() }));
    lastSaved = key;
    return true;
  };
  const saveQuietly = (why: string): void => {
    save().then(saved => { if (saved) log(`Saved (${why}).`); }, error => log(`Save failed: ${(error as Error).message}`));
  };
  await save(true);

  // The console's pause wins; otherwise the world waits while nobody is connected.
  let consolePause = false;
  const emptyPause = (): void => {
    const empty = config.pauseWhenEmpty && host.connectedCount() === 0;
    if (consolePause) host.setPaused(true, 'Paused by the server');
    else host.setPaused(empty, empty ? 'Waiting for players' : '');
  };
  emptyPause();
  host.onplayers = () => {
    emptyPause();
    if (host.connectedCount() === 0) saveQuietly('everyone left');
  };

  const files = new Map<string, { readonly type: string; readonly body: Buffer }>();
  for (const [path, asset] of Object.entries(options.assets ?? {})) {
    let body = Buffer.from(asset.data, 'base64');
    if (path === '/index.html') body = Buffer.from(body.toString('utf8').replace('</head>', `    ${SERVER_META}\n  </head>`));
    files.set(path, { type: asset.type, body });
  }
  if (!files.has('/index.html') || !config.serveGame) {
    files.set('/index.html', { type: 'text/html; charset=utf-8', body: Buffer.from(`<!doctype html><meta charset="utf-8">
<title>${escapeHtml(config.name)}</title><p>This Space Sim server is running. Open the game, choose Multiplayer → Join and enter this address.</p>`) });
  }
  const status = (): unknown => ({
    name: config.name, version, protocol: PROTOCOL, model: MODEL, worldId: world.id, universe: world.universe.name,
    system: world.system.system.name, tick: world.tick, time: world.time, paused: host.paused, warp: host.warp,
    players: host.playerList().filter(p => p.connected).map(p => p.name), ships: world.size,
  });
  const serve = (request: IncomingMessage, response: ServerResponse): void => {
    if (request.method !== 'GET' && request.method !== 'HEAD') { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
    let path: string;
    try { path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname); } catch {
      response.writeHead(400).end(); return;
    }
    const headers = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
    if (path === '/status') {
      response.writeHead(200, { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(status()));
      return;
    }
    const file = files.get(path === '/' ? '/index.html' : path);
    if (!file || (!config.serveGame && path !== '/' && path !== '/index.html')) {
      response.writeHead(404, { ...headers, 'Content-Type': 'text/plain' }).end('Not found\n');
      return;
    }
    response.writeHead(200, { ...headers, 'Content-Type': file.type, 'Content-Length': file.body.length,
      'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : file.body);
  };

  let sockets = 0;
  const server = createServer(serve);
  server.on('clientError', (_error, socket) => socket.destroy());
  server.on('upgrade', (request, socket, head) => {
    const path = (request.url ?? '').split('?')[0];
    if (path !== SOCKET_PATH) { socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    if (sockets >= MAX_SOCKETS) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    const remote = `${request.socket.remoteAddress ?? '?'}:${request.socket.remotePort ?? '?'}`;
    const ws = acceptWebSocket(request, socket, head, { maxMessageBytes: MAX_CLIENT_MESSAGE, pingIntervalMs: 15000, label: remote });
    if (!ws) return;
    sockets++;
    socket.once('close', () => { sockets--; });
    host.accept(ws);
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(config.port, config.host, () => { server.off('error', fail); done(); });
  });
  const port = (server.address() as AddressInfo).port;

  // Fixed-step clock: catch-up is bounded, and a stalled process drops time rather than
  // jumping the world forward.
  const clock = new Clock();
  let last = performance.now();
  const ticker = setInterval(() => {
    const now = performance.now();
    const elapsed = Math.max(0, (now - last) / 1000);
    last = now;
    try {
      if (host.paused) clock.reset();
      else host.advance(elapsed);
      host.service();
    } catch (error) {
      log(`Simulation error: ${(error as Error).stack ?? String(error)}`);
    }
  }, 5);
  const autosave = setInterval(() => saveQuietly('autosave'), config.autosaveSeconds * 1000);
  const backups = setInterval(() => {
    store.backup().then(path => { if (path) log(`Backup written to ${path}.`); }, error => log(`Backup failed: ${(error as Error).message}`));
  }, config.backupMinutes * 60_000);
  for (const timer of [autosave, backups]) timer.unref();


  let stopping: Promise<void> | undefined;
  const stop = (reason = 'The server is shutting down.'): Promise<void> => {
    stopping ??= (async () => {
      clearInterval(ticker); clearInterval(autosave); clearInterval(backups);
      host.close(reason);
      try {
        if (await save()) log('Saved (shutdown).');
        await store.idle();
      } catch (error) { log(`Save failed: ${(error as Error).message}`); }
      await new Promise<void>(done => {
        server.close(() => done());
        // Idle HTTP connections end now. Players get a moment to read the goodbye and close
        // politely: destroying a socket with unread input resets it, and the reset can
        // discard the goodbye before the player reads it.
        server.closeIdleConnections();
        setTimeout(() => server.closeAllConnections(), 500).unref();
      });
      world.dispose();
      log('Stopped.');
    })();
    return stopping;
  };

  const command = async (line: string): Promise<string> => {
    const [word = '', ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ');
    switch (word.toLowerCase()) {
      case '': return '';
      case 'help': case '?':
        return 'Commands: status, players, ships, warp [factor], save, backup, pause, resume, kick <player>, asteroids <count>|clear, stop';
      case 'status':
        return `${config.name} · world ${world.id} · ${world.system.system.name} · T+${clockText(world.time)}`
          + `${host.warp > 1 ? ` · ${host.warp}x` : ''}`
          + `${host.paused ? ` · paused (${host.pauseReason || 'by console'})` : ''} · ${host.connectedCount()}/${config.maxPlayers} players`
          + ` · ${world.size} ships · port ${port}`;
      case 'warp': {
        if (!arg) return `Current warp: ${host.warp}x (requested: ${host.requestedWarp}x${host.warpReason ? `, reason: ${host.warpReason}` : ''})`;
        const factor = Number(arg);
        if (!Number.isFinite(factor) || factor < 1) return 'Usage: warp [1-100000]';
        try {
          host.setWarp(factor);
          return `Warp set to ${host.warp}x${host.requestedWarp !== host.warp ? ` (requested ${host.requestedWarp}x; safety limited: ${host.warpReason})` : ''}.`;
        } catch (e) {
          return `Failed to set warp: ${(e as Error).message}`;
        }
      }
      case 'players': {
        const list = host.playerList();
        return list.length ? list.map(p => `${p.connected ? '●' : '○'} ${p.name} (${p.id}) · ${world.ownedBy(p.id).size} ships`).join('\n') : 'No players yet.';
      }
      case 'ships': {
        // Pilots' ships in full; passive objects (asteroids) only as a count.
        const piloted = [...world.records()].filter(s => host.playerName(s.ownerId) !== undefined);
        const others = world.size - piloted.length;
        const lines = piloted.map(s => world.ship(s.id)!).map(s => `${s.id} ${s.name} · ${host.playerName(s.ownerId)} · ${s.bodyId} · ${s.state.status}${s.fault ? ` · stopped: ${s.fault}` : ''}`);
        if (others) lines.push(`${others} other objects (${world.asleepCount} of ${world.size} objects asleep)`);
        return lines.length ? lines.join('\n') : 'No ships.';
      }
      case 'asteroids': {
        if (arg === 'clear') return `Removed ${clearStress(world)} objects.`;
        const count = Number(arg);
        if (!Number.isInteger(count) || count < 1 || count > 50_000) return 'Usage: asteroids <1-50000> or asteroids clear';
        if (world.size + count > MAX_SAVE_SHIPS) return `A world holds at most ${MAX_SAVE_SHIPS} objects.`;
        const result = populateStress(world, { asteroids: count, seed: world.version + 1 });
        return `Added ${result.asteroids} asteroids (${Object.entries(result.kinds).map(([k, n]) => `${k} ${n}`).join(', ')}).`;
      }
      case 'save': await save(true); return `Saved to ${store.file}.`;
      case 'backup': return (await store.backup()) ?? 'Nothing to back up yet.';
      case 'pause': consolePause = true; emptyPause(); return 'Paused.';
      case 'resume': consolePause = false; emptyPause(); return host.paused ? 'Nobody is connected; the world resumes when someone joins.' : 'Resumed.';
      case 'kick': {
        const target = host.playerList().find(p => p.id === arg || p.name.toLowerCase() === arg.toLowerCase());
        if (!target) return `No player "${arg}".`;
        return host.kick(target.id, 'Removed by the server.') ? `Kicked ${target.name}.` : `${target.name} is not connected.`;
      }
      case 'stop': case 'quit': case 'exit': await stop(); return 'Bye.';
      default: return `Unknown command "${word}". Type help.`;
    }
  };

  return { config, host, store, port, save, stop, command, };
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
}

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const entry of list ?? []) if (entry.family === 'IPv4' && !entry.internal) out.push(entry.address);
  }
  return out;
}

/** Beside the executable when packaged; otherwise the current folder. */
export function defaultDataDir(): string {
  return join(isSea() ? dirname(process.execPath) : process.cwd(), 'space-sim-data');
}

function openBrowser(url: string): void {
  const [command, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(command, args as string[], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); } catch { /* optional */ }
}

/** Command-line entry point. */
export async function run(argv: readonly string[], assets?: Readonly<Record<string, ClientAsset>>): Promise<void> {
  const cli = parseCommandLine(argv);
  if (cli.help) { console.log(USAGE); return; }
  if (cli.version) { console.log(`space-sim-server ${version} (${PROTOCOL}, ${MODEL})`); return; }
  const dataDir = resolve(cli.data ?? defaultDataDir());
  const running = await startServer({ dataDir, overrides: cli.overrides, newWorld: cli.newWorld,
    ...(cli.importSave ? { importSave: cli.importSave } : {}), ...(assets ? { assets } : {}) });
  const { config, port, host } = running;
  const local = `http://localhost:${port}`;
  const lan = config.host === '0.0.0.0' || config.host === '::' ? lanAddresses() : [config.host];
  console.log([
    '',
    `  Space Sim server ${version} · ${PROTOCOL}`,
    `  ${config.name} · world ${host.world.id} · ${host.world.system.system.name}`,
    `  Data folder: ${dataDir} (autosave every ${config.autosaveSeconds} s)`,
    config.serveGame ? `  Players open the game at ${[local, ...lan.map(a => `http://${a}:${port}`)].join('  or  ')}` : '',
    `  or choose Multiplayer → Join in the game and enter ${lan[0] ?? 'this computer\'s address'}:${port}`,
    `  Type "help" for commands. Ctrl+C saves and stops.`,
    '',
  ].filter(Boolean).join('\n'));
  if (cli.open) openBrowser(local);

  let exiting = false;
  const exit = (reason: string, code = 0): void => {
    if (exiting) { console.log('Stopping now.'); process.exit(code); }
    exiting = true;
    console.log(reason);
    running.stop().then(() => process.exit(code), () => process.exit(1));
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => exit(`Received ${signal}; saving.`));
  process.on('uncaughtException', error => {
    console.error(`Fatal error: ${error.stack ?? error.message}`);
    try {
      running.store.saveSync(saveWorld(host.world, { players: host.roster(), savedAt: new Date().toISOString() }));
      console.error('World saved.');
    } catch (saveError) { console.error(`Emergency save failed: ${(saveError as Error).message}`); }
    process.exit(1);
  });

  const input = createInterface({ input: process.stdin, terminal: false });
  input.on('line', line => {
    running.command(line).then(output => {
      if (output) console.log(output);
      if (/^\s*(stop|quit|exit)\s*$/i.test(line)) process.exit(0);
    }, error => console.log(`Command failed: ${(error as Error).message}`));
  });
}
