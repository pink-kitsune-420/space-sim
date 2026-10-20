# Browser Application

Spacelab's browser host selects a bundled game, supplies platform services and connects its modules to the page. Space Sim is the default game. Player and creator instructions live in the in-game **Manual**.

## Run and build

From the repository root, install with `npm ci`, then run `npm run dev`. Node.js 22.12 or newer is required. Open the URL Vite prints.

`npm run build` creates the web distribution in `dist/`, including `space-lab-offline.html`, exported games and universe definitions. It also builds the desktop/server JavaScript bundles and Orbital Mechanics Academy add-on. `npm run preview` serves the production web build.

Try `?game=flight-starter`, `?game=planet-viewer`, `?game=survey-fixture` or `?game=orbit-sandbox` on the hosted or offline player. These select bundled compositions. Planet viewer and Survey fixture currently run through source-defined host adapters and do not support portable game export.

## Source orientation

- [src/main.ts](src/main.ts) selects the startup game; [src/bundled-games.ts](src/bundled-games.ts) lists bundled compositions and their adapters.
- [src/flight-host.ts](src/flight-host.ts) composes the flight application. [src/session.ts](src/session.ts) adapts local worlds and remote dedicated sessions for it.
- [src/identity.ts](src/identity.ts) persists player identity and reconnect tokens locally.
- [modules/](../../modules/) holds editable reusable packages, including input, camera, windows, Manual, saving, transports and flight tools. Some flight-host integration remains in the application.
- [modules/manual/src/content.ts](../../modules/manual/src/content.ts) owns the default Players/Creators book; [src/manual.ts](src/manual.ts) expands live controls and mounts the reader. Update the matching page when a player-facing feature or button changes. Keep keybinding lists generated from live controls.
- [games/](../../games/) contains game definitions and explicit target plans. A package being present in the catalogue does not enable it.

## Verify changes

```sh
npm test                    # Main Vitest suite
npm run test:sandbox        # Separate Orbit Sandbox unit suite
npm run check:modules       # Import boundaries
npm run check               # Boundaries, build, main unit suite, licenses and integrity
npx playwright install     # One-time browser installation
npm run build               # Refresh production files after source changes
npm run test:browser        # Chromium, Firefox and WebKit against dist/
```

Playwright starts its own preview server on port 4173. `npm run check` does not run the browser suite or the separate Sandbox unit suite. On Linux, browser system dependencies may also be needed: `npx playwright install --with-deps` installs them along with the browsers.
