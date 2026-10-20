# Simulation Core

TypeScript physics and world simulation with no platform-specific dependencies. Owns body ephemerides, reference frames, deterministic double-precision dynamics, Kepler propagation, surface contacts, world state, saves and trajectory calculation. Distances are metres, times are seconds, angles are radians and gravitational parameters are m³/s² unless a contract says otherwise.

Space Sim uses Keplerian/patched-conic coasts and numerical powered/surface flight. The separate Orbit Sandbox has its own interacting-body model; its N-body mode is not a selectable Space Sim solver.

- `src/context.ts`: Per-world `SimulationContext` creation with captured vehicle, physics and surface configuration. New world/session code owns a context; the free functions in `src/index.ts` are compatibility entry points using a legacy shared context.
- `src/orbit.ts`: Signed orbital elements, universal-variable Kepler propagation with explicit diagnostics, radius/apsis time primitives, coefficient lookup tables and epoch constants caching.
- `src/surface.ts`: Versioned surface configuration, strict resource limits, canonical geometry identity, deterministic mountains/craters and level landing pads.
- `src/surface-contact.ts`: Headless `sweepSurface` API searching crossed polar intervals in order, checking convex clearance minima for fly-throughs, and refining collision crossings.
- `src/surface-flight.ts`: Surface landing limits (5 m/s, 20° attitude, 30° slope), two-face corner support, and geometry validation.
- `src/world.ts`: Complete multi-ship simulation (`World`): stable IDs, ship owners, held controls, per-ship sphere-of-influence changes, and isolated motion faults.
- `src/save.ts`: Complete-world serialization and validation (`saveWorld`, `loadWorld`). Atomic disk replacement and backups belong to the server storage provider.
- `src/water.ts`: Hydrostatic buoyancy, linear drag, and ocean flight dynamics.

Public module contracts live in [packages/game-api](../game-api/src/index.ts).
Reusable packages request engine services rather than importing simulation internals.
Numerical fixtures and their independent provenance are described in
[tests/fixtures](../../tests/fixtures/README.md).
