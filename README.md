# Spacelab 🚀

A free, open-source toolkit for modular 2D space games. **Space Sim**, the bundled orbital flight game, combines double-precision Keplerian mechanics, terrain and ocean landings, and multiplayer in a minimalist vector world.

**[Play in your browser](https://pink-kitsune-420.github.io/space-sim/)** · **[Downloads](https://github.com/pink-kitsune-420/space-sim/releases)** · **[Licensing](LICENSE)** · **[API reference](https://pink-kitsune-420.github.io/space-sim/API-REFERENCE.html)**

Spacelab is in alpha. Module contracts and file tooling are still evolving.

**Official accounts:** Outside GitHub, the developer currently has an official account only on itch.io. Accounts on other platforms are not affiliated with the developer.

## Play and learn

Open **Manual** in the game's dock. The **Players** tab covers your first orbit, live controls, maneuver planning, transfers, landing, saves and multiplayer. Controls support keyboard, touch and gamepad; remap them under **Settings → Controls & keybindings…**.

- Fly with trajectory predictions, a navball, multi-node plans, burn reminders and time warp up to 100,000×.
- Explore the compact Primus system, terrain and ocean worlds, or scaled and full-scale Solar System definitions.
- Fly fleets with up to four local pilots using dynamic split screen, browser invites, or a dedicated server.
- Choose Canvas 2D or WebGL 2 rendering, customize planet appearances and shaders, and arrange instrument windows.

For offline play, download the release's `space-lab-<tag>-offline.html` and open it locally. Desktop and dedicated server downloads are available for Windows, macOS and Linux; Android APKs are available for sideloading. The desktop executable uses an installed browser to display its embedded game. Keep the included `NODE-LICENSE.txt` with desktop and server executables.

**Space Sim Tiles Demo** is available in the Library for tiled terrain and orbital-flight comparisons on Primus and Parvus. Its progress stays separate from **Space Sim Classic**. WebGL is the primary renderer; Canvas provides a basic fallback with one local view.

## Create and remix

Open the Manual's **Creators** tab for universe authoring, shader packs, reusable modules and game composition. **ModMenu** manages games and plugins. **Orbit Sandbox** lets you create planetary systems; **Flight starter**, **Planet viewer** and **Survey fixture** demonstrate smaller compositions with different tools and host adapters.

| File | Contains |
| --- | --- |
| `.spacegame` | Game setup, selected modules, content and settings |
| `.spacemod` | Code module with editable source and a compiled bundle |
| `.spacedata` | Reusable definitions, including universes or shaders |
| `.spaceuniverse` | Saved flight progress |

Older JSON, gzip and `.spaceuniverse` definition files remain readable. **Setup → Export** shares universe definitions; **Fleet → Save universe** saves flight progress. Importing a code package inspects it; enabling or playing it executes code, so use authors you trust.

Start with the [module examples](examples/modules/README.md), [editable packages](examples/packages/README.md), [shader example](examples/shaders/README.md) or [universe library](games/space-sim/universes/README.md). Module contracts live in [packages/game-api](packages/game-api/src/index.ts). Browse the [API reference](https://pink-kitsune-420.github.io/space-sim/API-REFERENCE.html) online, or open the [standalone HTML](modules/API-REFERENCE.html) locally for searchable declarations and Creator guides without starting the game. Regenerate the HTML, text and in-game references with `npm run module:reference`; `npm run check:modules` checks all three for drift.

## Develop

Requires **Node.js 22.12 or newer** and npm. Run these commands from the repository root:

```sh
git clone https://github.com/pink-kitsune-420/space-sim.git
cd space-sim
npm ci
npm run dev
```

Open the URL printed by Vite. To build and verify:

```sh
npm run build           # Web, offline HTML, desktop/server bundles and Academy add-on
npm run check           # Module boundaries, build, unit tests, licenses and integrity
npx playwright install # Install browsers once before browser tests
npm run test:browser    # Tests the production build; rebuild after source edits
```

`npm run check` excludes browser tests. See the [web application README](apps/web/README.md) for targeted checks and [Orbit Sandbox](apps/orbit-sandbox/README.md) for its separate development setup.

## Host and package

```sh
npm run host                              # Build, start a server and open its game
npm run package -- --target=multiplayer    # Matching desktop and server executables
npm run package -- --target=offline        # dist/space-lab-offline.html
npm run package -- --target=android        # Stage assets; build APK when SDK is configured
```

Packaging rebuilds current sources. `npm run build` produces JavaScript bundles and web artifacts; it does not replace standalone executables. Desktop/server packaging targets the current operating system and architecture and requires the matching Node.js license text; set `NODE_LICENSE_PATH` if it cannot be found beside Node.

See the [server README](apps/server/README.md) for persistent worlds, custom games and configuration. Run `npm run package -- --help` for individual targets and prerequisite checks.

## License and credits

The **Spacelab Engine** (`packages/*`, `modules/*`, public APIs, shared tools and generic host runners) is [MIT-licensed](LICENSE-ENGINE.txt), including for commercial use, apart from the explicitly marked survey lander artwork definition.

**Space Sim Classic** (`games/space-sim`) and **Space Sim Successor / Tiles Demo** (`games/space-sim-successor`) are **Proprietary — All Rights Reserved**. This includes their bundled `.spacegame` and `.spaceuniverse` files, `universes/` packages, game assets, and game-specific implementations in `apps/web/src/` such as `successor-*.ts`, `academy-flight.ts`, `flight-host.ts`, `flight-manual.ts`, `flight-windows.ts`, `manual-content.ts`, `bundled-games.ts` and `starter-products.ts`. The [Split-License Router](LICENSE) lists every covered implementation file and includes both complete license texts. The same terms apply to copies in browser ZIPs, offline players, Android assets and other distributions.

You may use, modify, **fork, redistribute and host the games for free, non-commercial use**, including mods, public source-code forks, complete modified or unmodified builds, standalone forks, multiplayer servers and free app-store releases. Recipients do not need a separate copy of the original game. Keep the required notices and game license, identify unofficial distributions and changes, and preserve recipients' permissions under that license. **Selling or commercially monetizing the games, their materials or derivative mods and forks requires prior written permission**, including paid downloads, advertising, subscriptions and in-app purchases. See the full [Classic game license](games/space-sim/LICENSE-GAME.txt) and [Successor game license](games/space-sim-successor/LICENSE-GAME.txt). Deprecated Nextgen and other example games retain their existing licenses; these restrictions do not apply to independently authored game or universe packages.

Copyright (c) 2026 pink-kitsune-420. The web player has no third-party runtime dependencies. Standalone desktop and server executables also bundle Node.js. Attribution, third-party licenses and build-tool notices are in [CREDITS.md](CREDITS.md).
