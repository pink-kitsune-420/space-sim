# Scenarios & Builtin Universes

This package exports pre-configured universes and scenarios bundled with Spacelab and the dedicated server (`default`, `terrain`, `ocean`, `solar`, `full`), using the game universe catalog.

Editable universe model files and scenarios live in the game universe library (`games/space-sim/universes/`).

[builtin.ts](builtin.ts) validates and registers the models using the stable IDs
and server aliases in the [catalogue](../../games/space-sim/universes/catalog.json).
See the [universe library README](../../games/space-sim/universes/README.md) for
authoring, build exports and the distinction between definitions and saved progress.
