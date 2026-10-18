# Credits & Third-Party Notices

## Project

**Spacelab** and its default bundled game **Space Sim** are modern, browser-first 2D orbital space flight simulation software.

The name is inspired by the joint ESA/NASA orbital laboratory missions. This project is an independent open-source software project and is not affiliated with, endorsed by, or sponsored by NASA or ESA.

All simulation physics, orbital mechanics, Kepler propagators, Canvas 2D and WebGL 2 GPU shader renderers, flight HUDs, multiplayer networking, and application plumbing are first-party code authored specifically for this project.

Engine rumble and flight sound effects are synthesized by original first-party code under the project's MIT license, using generated noise and oscillators. No third-party sound recordings, samples or instrument libraries are bundled.

Solar system astronomical and ephemeris parameters derived from publicly available NASA / JPL Solar System Dynamics data. NASA does not endorse this software.

## Shipped Runtime Dependencies

The shipped game application, browser distributions, and standalone offline builds contain **zero runtime third-party dependencies** (`modulePreload.polyfill = false`).

The standalone desktop and dedicated server single-file executables bundle the official, unmodified **Node.js** runtime ([MIT License](https://github.com/nodejs/node/blob/main/LICENSE)) by the OpenJS Foundation and Node.js contributors, distributed alongside `NODE-LICENSE.txt`.

## Development & Build Tooling

The following open-source tools and libraries are used during development, testing, and building (none are bundled into the shipped web client):

- **TypeScript** ([Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)) — Microsoft Corporation
- **Vite** ([MIT](https://github.com/vitejs/vite/blob/main/LICENSE)) — Evan You and Vite contributors
- **Vitest** ([MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE)) — Anthony Fu and Vitest contributors
- **Playwright** ([Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE)) — Microsoft Corporation
- **postject** ([MIT](https://github.com/nodejs/postject/blob/main/LICENSE)) — Postman, Inc.
- **rolldown** ([MIT](https://github.com/rolldown/rolldown/blob/main/LICENSE)) — VoidZero Inc.

All development dependencies conform to permissive, commercially-friendly open-source licensing allowlists, verified statically by `npm run check:licenses`.
