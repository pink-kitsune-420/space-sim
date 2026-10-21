# Credits & Third-Party Notices

## Project

**Spacelab** and its default bundled game **Space Sim** are modern, browser-first 2D orbital space flight simulation software.

The name is inspired by the joint ESA/NASA orbital laboratory missions. This project is an independent open-source software project and is not affiliated with, endorsed by, or sponsored by NASA or ESA.

All simulation physics, orbital mechanics, Kepler propagators, Canvas 2D and WebGL 2 GPU shader renderers, flight HUDs, multiplayer networking, and application plumbing are first-party code authored specifically for this project.

The successor survey lander, static human reference and trial terrain recipes are original first-party vector/data assets under the project MIT license.

Engine rumble and flight sound effects are synthesized by original first-party code under the project's MIT license, using generated noise and oscillators. No third-party sound recordings, samples or instrument libraries are bundled.

Solar system astronomical and ephemeris parameters are derived from publicly available NASA / JPL Solar System Dynamics data ([ssd.jpl.nasa.gov](https://ssd.jpl.nasa.gov/)): planetary satellite mean orbital elements and physical parameters, *Keplerian Elements for Approximate Positions of the Major Planets* (E. M. Standish, JPL), and the JPL Horizons system. Courtesy NASA/JPL-Caltech. NASA and JPL do not endorse this software.

## Shipped Runtime Dependencies

The shipped game application, browser distributions, and standalone offline builds contain **zero runtime third-party dependencies** (`modulePreload.polyfill = false`).

The standalone desktop and dedicated server single-file executables bundle the official, unmodified **Node.js** runtime ([MIT License](https://github.com/nodejs/node/blob/main/LICENSE)) by the OpenJS Foundation and Node.js contributors, distributed alongside `NODE-LICENSE.txt`.

## Native Platform Wrappers

The game code inside native packages is the same first-party web build. The native wrappers add these third-party libraries:

**Android APK** (`android/`):

- **AndroidX AppCompat** and **AndroidX WebKit** ([Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)) — The Android Open Source Project
- **Kotlin Standard Library** ([Apache-2.0](https://github.com/JetBrains/kotlin/blob/master/license/LICENSE.txt)) — JetBrains s.r.o. and Kotlin contributors (transitive, via AndroidX)

**Tauri v2 native build** (optional `--target=tauri`, `src-tauri/`):

- **Tauri** ([MIT](https://github.com/tauri-apps/tauri/blob/dev/LICENSE-MIT) OR [Apache-2.0](https://github.com/tauri-apps/tauri/blob/dev/LICENSE-APACHE-2.0)) — The Tauri Programme within The Commons Conservancy
- **serde** and **serde_json** ([MIT](https://github.com/serde-rs/serde/blob/master/LICENSE-MIT) OR [Apache-2.0](https://github.com/serde-rs/serde/blob/master/LICENSE-APACHE)) — Erick Tryzelaar, David Tolnay and contributors
- Transitive Rust crates pulled in by Tauri carry their own licenses and must be reviewed before a Tauri build is distributed.

## Development & Build Tooling

The following open-source tools and libraries are used during development, testing, and building (none are bundled into the shipped web client):

- **TypeScript** ([Apache-2.0](https://github.com/microsoft/TypeScript/blob/main/LICENSE.txt)) — Microsoft Corporation
- **Vite** ([MIT](https://github.com/vitejs/vite/blob/main/LICENSE)) — Evan You and Vite contributors
- **Vitest** ([MIT](https://github.com/vitest-dev/vitest/blob/main/LICENSE)) — Anthony Fu and Vitest contributors
- **Playwright** ([Apache-2.0](https://github.com/microsoft/playwright/blob/main/LICENSE)) — Microsoft Corporation
- **postject** ([MIT](https://github.com/nodejs/postject/blob/main/LICENSE)) — Postman, Inc.
- **rolldown** ([MIT](https://github.com/rolldown/rolldown/blob/main/LICENSE)) — VoidZero Inc.
- **@types/node** ([MIT](https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/LICENSE)) — DefinitelyTyped contributors
- **Gradle Wrapper** ([Apache-2.0](https://github.com/gradle/gradle/blob/master/LICENSE)) — Gradle, Inc. (`android/gradle/wrapper/`)
- **Android Gradle Plugin** ([Apache-2.0](https://www.apache.org/licenses/LICENSE-2.0)) — Google LLC
- **tauri-build** ([MIT](https://github.com/tauri-apps/tauri/blob/dev/LICENSE-MIT) OR [Apache-2.0](https://github.com/tauri-apps/tauri/blob/dev/LICENSE-APACHE-2.0)) — The Tauri Programme within The Commons Conservancy

All npm development dependencies conform to permissive, commercially-friendly open-source licensing allowlists, verified statically by `npm run check:licenses`. Android (Gradle) and Rust (Cargo) dependencies are reviewed manually.

The Space Sim Successor package (`games/space-sim-successor`) contains first-party Classic-derived composition and world/settings data under the project MIT license. It reuses the shared Space Sim engine and modules.
