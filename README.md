# Spacelab 🚀

A browser-first workspace and simulation engine for modular 2D space games, featuring double-precision orbital mechanics, hardware-accelerated WebGL 2 GPU shaders, multiplayer fleets, and custom module authoring.

The bundled default game is **Space Sim** (`space-sim`).

---

## 🌟 Key Features

- **Double-Precision Orbital Mechanics:** Real double-precision Keplerian conic propagation, patched conics, and numerical solvers for rocket burns and surface contacts.
- **Flight Console & Telemetry:** Real-time trajectory prediction, apoapsis/periapsis markers, velocity vectors, altitude telemetry, and time warp up to 10,000×.
- **Physical Surfaces & Terrains:** Land on pads, explore rugged terrain worlds, or navigate oceanic splashdowns with hydrostatic buoyancy.
- **Fleets & Multiplayer:** Command fleets of ships, swap pilot control, host peer-to-peer WebRTC sessions, or connect to the standalone dedicated server.
- **Extensible & Modular:** Built-in Lab Manager to create, customize, and remix game packages (`.spacegame`), universes (`.spaceuniverse`), custom GLSL shader packs, and code modules.
- **Clean-Room & Permissive:** 100% first-party code, zero runtime third-party dependencies, licensed under the [MIT License](LICENSE).

---

## 🎮 Play Options

### 1. Play in Browser
Play directly in any modern desktop or mobile web browser:
**[Launch Space Sim Online](https://pink-kitsune-420.github.io/space-sim/)**

### 2. Single-File Offline Web
Download `space-lab-offline.html` from the [Releases](https://github.com/pink-kitsune-420/space-sim/releases) page and double-click to play locally with zero internet connection or server required.

### 3. Standalone Desktop & Dedicated Server Executables
Download self-contained single-file executables for Windows, macOS, or Linux from GitHub Releases:
- **Game Executable:** Launches a frameless, standalone desktop window.
- **Dedicated Server Executable:** Runs a headless multiplayer server with automatic periodic world saves and backups.

---

## 🕹️ Flight Controls

| Action | Keyboard | Touch / On-screen |
|---|---|---|
| **Ignition** | <kbd>Space</kbd> (Hold) | Hold on-screen **BURN** button |
| **Attitude (Turn)** | <kbd>←</kbd> / <kbd>→</kbd> or <kbd>A</kbd> / <kbd>D</kbd> | Hold turn buttons (↶ / ↷) |
| **Throttle** | <kbd>↑</kbd> / <kbd>↓</kbd> or <kbd>W</kbd> / <kbd>S</kbd> | Drag throttle slider |
| **Time Warp** | <kbd>[</kbd> / <kbd>]</kbd> or <kbd>,</kbd> / <kbd>.</kbd> | Click warp buttons (◀◀ / ▶▶) |
| **Switch Vessel** | <kbd>1</kbd>–<kbd>9</kbd> | Select vessel in Fleet panel |
| **Camera View** | <kbd>C</kbd> (Follow) / <kbd>H</kbd> (Horizon) | Click camera toolbar buttons |
| **Zoom** | <kbd>+</kbd> / <kbd>−</kbd> or Mouse Wheel | Click Zoom in/out buttons |
| **Pause / Reset** | <kbd>P</kbd> / <kbd>R</kbd> | Click Pause / Reset buttons |

---

## 🛠️ Creating Custom Content

### Custom Universes
Spacelab supports custom planetary systems and universes with arbitrary hierarchies, physical radii, gravitational parameters ($\mu$), atmospheres, and terrains.
- Use the **Import…** button to load a `.spaceuniverse` or `.json` file.
- Use the **Export** button to download your customized universe.
- Pre-made universes are available in `games/space-sim/universes/` (including the compact default system, ocean worlds, rugged terrain worlds, and the full 1:1 scale solar system with 477 bodies).

### Custom Shaders
Switch between Canvas 2D and WebGL 2 GPU shader renderers at any time. Under **Shaders**, you can:
- Live-edit the GLSL shaders (background starfield, celestial bodies, atmospheres, rings, ship glows, HUD overlays).
- Import and export `.json` shader packs (see `examples/shaders/` for reference packs).

### Custom Code Modules
Extend physics, add custom instrument panels, or implement game rules using the module authoring toolkit:
- Contracts: Defined in `@space-sim/game-api` (`packages/game-api`).
- Starters & Examples: Found under `examples/modules/` (force models, numerical integrators, telemetry HUD overlays, custom state migrations).
- Build command:
  ```sh
  npm run module:build -- path/to/module.json output.module.json
  ```

---

## 💻 Development & Building

### Prerequisites
- Node.js >= 22.12 (Node 22 LTS recommended)
- npm

### Quickstart
```sh
# Clone repository
git clone https://github.com/pink-kitsune-420/space-sim.git
cd space-sim

# Install dependencies
npm ci

# Start local dev server
npm run dev
```

### Build & Test Suite
```sh
# Build production web bundle, offline single-file HTML, desktop bundle, and server
npm run build

# Run unit test suite (Vitest)
npm test

# Run full project verification (TypeScript, module boundaries, unit tests, licenses, integrity)
npm run check

# Browser smoke tests (Playwright)
npm run test:browser
```

### Packaging Binaries
```sh
# Standalone desktop game executable for current OS (dist-desktop/space-sim)
npm run package -- --target=desktop-exe

# Standalone dedicated server executable (dist-server/space-sim-server)
npm run package -- --target=server-exe

# Single-file offline HTML player
npm run package -- --target=offline

# Sync assets into Android native project
npm run package -- --target=android
```

---

## 📄 License & Credits

Spacelab is free, open-source software licensed under the **[MIT License](LICENSE)**.

- **Shipped Code:** 100% first-party code authored specifically for Spacelab, with zero third-party runtime dependencies.
- **Node.js Runtime Exception:** Standalone single-file executables bundle the official, unmodified Node.js runtime (MIT license) and are distributed alongside `NODE-LICENSE.txt`.
- **Third-Party Build Tools:** Verified for commercial-friendly open-source licensing (MIT, Apache-2.0, BSD-3-Clause). See [CREDITS.md](CREDITS.md).
