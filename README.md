# Space Sim

A browser-first, multiplatform 2D space simulator inspired by the original C64 space sim.

**Status: M1 browser vertical slice.** Launch from the north pad or start in a
circular orbit. Turn, adjust throttle, hold to burn, coast, and land upright below
5 m/s. Switch between ship/planet cameras and north/horizon views. The sampled
trajectory assumes engine cutoff now; its age and numerical diagnostics are visible.

Requires Node >=22.12 (developed on 22.23.2) and npm. From this directory:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. Arrow keys turn/adjust throttle, Space burns,
C/H change cameras, +/− zoom, P pauses and R resets. On-screen hold buttons and the
throttle slider support pointers/touch. Focus the flight canvas for keyboard flight.
Losing window focus or hiding the tab pauses and releases held controls; resume is explicit.

**To play offline:** download `space-sim-offline.html` from the
[private preview release](https://github.com/pink-kitsune-420/space-sim/releases/tag/v0.1.0-m1),
then double-click it. Everything is embedded in that one file: no server,
installation, or internet connection is required. For a local checkout, `npm run build`
also creates `dist/space-sim-offline.html`. Copy that file anywhere to test it.

```sh
npm run check          # strict TypeScript, production build, Node tests, archive integrity
npx playwright install chromium firefox webkit
npm run test:browser   # production-build smoke checks in all three browser engines
npm run preview       # serve dist/ locally after npm run build
```

Linux browser testing may require `npx playwright install-deps` and system privileges.
The GitHub workflow installs these on its runner. Browser builds use relative assets
and contain no reference archive, emulator, or assembler. See the
[implementation record](docs/M1_IMPLEMENTATION.md) for versions, validation and limits.

Start with the [action plan](ACTION_PLAN.md), then the
[orbital optimization catalog](docs/ORBITAL_OPTIMIZATIONS.md).

The implemented stack is TypeScript, a platform-independent double-precision
simulation core, Canvas 2D and a static browser application. M1 uses fixed-step
numerical dynamics for both coasts and burns. Calculated Kepler motion is M2;
the moving moon, encounters and high warp are M3. Offline support and desktop
packaging follow the browser release.

| Resource | Purpose |
|---|---|
| [ACTION_PLAN.md](ACTION_PLAN.md) | Ordered deliverables, dependencies and completion gates |
| [Source audit](docs/SOURCE_AUDIT.md) | What the current code actually implements |
| [Architecture](docs/ARCHITECTURE.md) | Platform choice, modules, clock, rendering and persistence |
| [Numerical contract](docs/NUMERICAL_CONTRACT.md) | Units, propagation, events, frames and error handling |
| [Orbital optimizations](docs/ORBITAL_OPTIMIZATIONS.md) | Prioritized techniques, benefits, limits and validation |
| [Verification plan](docs/VERIFICATION.md) | Independent oracles, fixtures and performance targets |
| [Reference guide](references/README.md) | Which copied sources to read, reuse or treat cautiously |
| [External sources](docs/EXTERNAL_SOURCES.md) | Official platform docs and primary orbital references |
| [Legacy scenario](packages/scenarios/legacy-c64.json) | Explicit conversion from frames to SI seconds |

The original checkout was read at revision
`9be6780a582c1351a42458623ba1a1b104552e16`. Its files were copied, not moved.
The [manifest](references/manifest.json) distinguishes tracked source from local-only
research and records SHA-256 hashes. Historical notes are preserved verbatim and may
describe other revisions. The new documents identify important contradictions.

Validate the planning package without installing anything:

```sh
python3 scripts/verify_project.py
```

Runtime areas are `apps/web`, `packages/sim-core`, `packages/render-2d` and
`packages/scenarios`. Tests live under `tests/unit` and `tests/browser`.

The private source repository is [pink-kitsune-420/space-sim](https://github.com/pink-kitsune-420/space-sim).
CI verifies builds and tests; website deployment is a separate decision. No license
grant has been added; the original tracked tree contains no license file.
