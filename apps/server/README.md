# Dedicated Server

Run a persistent Space Sim world from the repository root after `npm ci`:

```sh
npm run host
```

This builds the distribution, starts the server and opens its game page. To run an existing build, use `npm run server`. The server listens on TCP port 6464 by default and prints local and LAN links. Guests can open its served game to use a matching client. Player instructions are in **Manual → Players → Flying together**.

## Worlds and configuration

The default data directory is `space-sim-data/`. On first launch, the server writes `server.json`; it stores the world in `world.json` and rotating backups in `backups/`. Defaults include 16 players, 100 physics steps per second, 20 snapshots per second, autosaves every 60 seconds, backups every 15 minutes and pausing while empty. Settings and command-line overrides are defined in [src/config.ts](src/config.ts).

```sh
npm run server -- --data ./my-server-data --port 6464
npm run server -- --help
```

Without `--new`, the server resumes its stored world. Universe and game selections apply to new worlds. `--new` backs up the current world before replacing it. `--import path/to/save.spaceuniverse` loads saved flight progress; legacy world JSON is also accepted. Type `help` in the running console for commands, including `status`, `save` and `stop`.

## Custom games and modules

Place an exported game at `space-sim-data/my-game.spacegame`, then start it with:

```sh
npm run server -- --data ./space-sim-data --game my-game.spacegame --new
```

The `--game` path is relative to the data directory; `gameFile` is the matching configuration key. The game needs a compatible server target and providers. Presentation modules do not run headlessly.

For legacy local code artifacts, put `*.module.json` files in `space-sim-data/modules/` and an exported profile at `space-sim-data/profile.json`:

```sh
npm run server -- --data ./space-sim-data --module-directory modules --module-profile profile.json --new
```

The equivalent configuration keys are `moduleDirectory` and `moduleProfile`; both paths are relative to the data directory. Existing saves require their exact artifacts and data profile. Server modules run with Node's privileges; install code from sources you trust.

Clients need a compatible authoritative selection. By default, the server does not offer packages. Enable `--offer-game-pack` or `offerGamePack` to offer the enabled distributable game for explicit client review and installation. Joining players approve code before it runs; the server owner controls server-side installation.

## Build and deployment

`npm run build` writes `dist-server/space-sim-server.cjs` and embeds the web game through [vite.server.config.ts](../../vite.server.config.ts). `npm run package -- --target=server-exe` rebuilds and packages a standalone server for the current platform. Use `--target=multiplayer` to package matching desktop and server executables together.

For Docker with an optional HTTPS reverse proxy, use [deploy/multiplayer/compose.yaml](../../deploy/multiplayer/compose.yaml). The Manual's multiplayer page explains LAN links, internet hosting and `GAME_ADDRESS` configuration.

[src/server.ts](src/server.ts) wires the listener, session and console commands together. [src/cli.ts](src/cli.ts) is the bundle entry; [src/websocket.ts](src/websocket.ts) provides the first-party WebSocket implementation. [src/store.ts](src/store.ts) adapts atomic storage and recovery from [modules/universe-server-storage](../../modules/universe-server-storage/).
