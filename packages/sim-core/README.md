# Simulation core

Pure TypeScript, no browser/native platform imports. Own vectors, units, epoch/state,
body ephemerides, reference frames, numerical dynamics, Kepler propagation, events,
warp policy and timed trajectory segments. Input is explicit data/commands; output
is immutable state, events and diagnostics. Keep prediction orchestration separate
from the authoritative live state.

The M1 subset in `src/index.ts` implements SI scenario presets, immutable typed
snapshots, fixed-step KDK gravity/thrust, contact classification, a bounded clock,
and a coast prediction iterator. It runs in Node without browser globals. Commands
are sampled at the start of each 0.01-second control boundary. No fuel or warp is enabled.
Kepler propagation, ephemerides and reference-frame switching remain M2/M3 work. See the
[numerical contract](../../docs/NUMERICAL_CONTRACT.md) and
[verification gates](../../docs/VERIFICATION.md). Run `npm test` from the project root.
