# Dedicated Server

Spacelab can host a complete exported game using:
```sh
npm run server -- --data ./space-lab-data --game ./my-game.spacegame --new
```
The path is relative to the data folder; `gameFile` is the matching config setting.

Runs one world for any number of players: a `HostSession` behind an HTTP and WebSocket listener (`src/websocket.ts` is a first-party RFC 6455 implementation), a 100 Hz fixed-step timer, and `src/store.ts` for atomic autosaves, rotating backups and recovery from a damaged world file. `src/config.ts` reads `server.json` and the command line; `src/server.ts` wires it together, serves the built game and runs console commands. `src/cli.ts` is the bundle entry.

`npm run build` writes `dist-server/space-sim-server.cjs` (the game is embedded by [vite.server.config.ts](../../vite.server.config.ts)); `npm run server` runs it and `npm run package -- --target=server-exe` packages it as a single standalone executable.

## Local Code Modules

Only install code from sources you trust: server modules have Node's privileges.
Place `*.module.json` in a local directory and export the matching game profile:

```sh
npm run server -- --data ./space-sim-data --module-directory modules --module-profile profile.json --new
```

The equivalent configuration keys are `moduleDirectory` and `moduleProfile`; paths are relative to the data folder. Installation is server-owner controlled. Existing saves require the exact installed artifacts and data profile. Clients must install and enable the same authoritative profile locally; the server never distributes or automatically executes client code. Presentation code does not run headlessly.
