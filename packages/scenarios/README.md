# Scenarios & Builtin Universes

This package exports pre-configured universes and scenarios bundled with Spacelab and the dedicated server (`default`, `terrain`, `ocean`, `solar`, `full`), using the game universe catalog.

> **Host-only package (`packages/scenarios`):** Modules cannot import this package directly (`packages/module-tools/check-boundaries.mjs`). Only the base content bridge (`packages/modules/src/base/content.ts`) imports `builtin.content`. Modules and game packages reference bundled universes via `selection.universe` using the public content IDs: `builtin.content/default-universe`, `builtin.content/dry-terrain-examples`, `builtin.content/ocean-example`, `builtin.content/solar-system-universe`, and `builtin.content/full-solar-system` (server aliases: `default`, `terrain`, `ocean`, `solar`, `full`). `stress.ts` is host- and test-only (server, web host, tests) with no game-api equivalent.

Editable universe model files and scenarios live in the game universe library (`games/space-sim/universes/`).

[builtin.ts](builtin.ts) validates and registers the models using the stable IDs
and server aliases in the [catalogue](../../games/space-sim/universes/catalog.json).
See the [universe library README](../../games/space-sim/universes/README.md) for
authoring, build exports and the distinction between definitions and saved progress.
