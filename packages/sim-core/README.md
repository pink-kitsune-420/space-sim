# Simulation Core

Pure TypeScript, zero platform-specific dependencies. Owns vectors, physical units, epoch and state definitions, body ephemerides, reference frames, numerical dynamics, Kepler propagation, contact/collision events, and trajectory calculation. Input is explicit data/commands; output is immutable state, events, and diagnostics.

- `src/index.ts`: Presets, immutable typed snapshots, KDK gravity/thrust/contact (`step`), hybrid Kepler/numerical motion (`advance`), coast epoch evaluation (`coastAt`), a bounded clock and timed prediction iterator.
- `src/orbit.ts`: Signed orbital elements, universal-variable Kepler propagation with explicit diagnostics, radius/apsis time primitives, coefficient lookup tables and epoch constants caching.
- `src/surface.ts`: Versioned surface configuration, strict resource limits, canonical geometry identity, deterministic mountains/craters and level landing pads.
- `src/surface-contact.ts`: Headless `sweepSurface` API searching crossed polar intervals in order, checking convex clearance minima for fly-throughs, and refining collision crossings.
- `src/surface-flight.ts`: Surface landing limits (5 m/s, 20° attitude, 30° slope), two-face corner support, and geometry validation.
- `src/world.ts`: Complete multi-ship simulation (`World`): stable IDs, ship owners, held controls, per-ship sphere-of-influence changes, and isolated motion faults.
- `src/save.ts`: Atomic complete-world serializing and validation (`saveWorld`, `loadWorld`).
- `src/water.ts`: Hydrostatic buoyancy, linear drag, and ocean flight dynamics.
