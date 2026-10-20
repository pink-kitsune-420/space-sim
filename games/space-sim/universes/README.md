# Space Sim Universe Library

Each universe owns a directory and an editable `universe.json`. Its complete planet/system definitions stay together, with room for future local assets beside the model.

```text
universes/
  catalog.json                     IDs, display names, categories and server aliases
  universe.schema.json             shared editor/validation schema
  sandbox/
    default/universe.json          Primus beginner system and Outer Reach
    terrain/universe.json          mountain and crater demonstrations
    ocean/universe.json            islands, oceans and underwater starts
  astronomy/
    solar-system/universe.json     the scaled Solar System as its own universe
    full-solar-system/universe.json  the full-scale Solar System
```

[catalog.json](catalog.json) is the source list used by built-in composition, UI categories and build exports. `alias` is the server's short name (`default`, `terrain`, `ocean`, `solar`, `full`); IDs and aliases remain stable even when directories change.

`npm run build` mirrors this layout under `dist/universes/`. Each directory contains an editable `universe.json` and a compressed `universe.spaceuniverse`. The output catalog lists both files and their sizes. Copy a compressed file to share that universe; use the JSON copy for authoring. All planets, presets, terrain and ocean settings are included. Compression preserves the values and deterministic terrain.

In Space Sim, use **Setup → Import…** or **ModMenu → Import game, plugin or universe…**.
**Setup → Export** now writes reusable definitions as a `.spacedata` archive;
**JSON** writes an editable copy. The build's gzip `.spaceuniverse` definitions
remain importable for compatibility. The in-game **Creators → Universes and planets**
Manual explains fields, units and authoring.

Definitions and flight progress have separate exports:

| Action | File | Contents |
| --- | --- | --- |
| **Setup → Export** | `.spacedata` | Planet/system definitions and starting presets |
| **Fleet → Save universe** | `.spaceuniverse` | Current clock, ships, pilots and available flight plans |
| **ModMenu → Export .spacegame** | `.spacegame` | Selected game setup, plugins, data and settings |

To continue a custom game's flight, start the compatible game before loading its
universe save. Saved progress never installs executable code. The offline HTML
embeds the built-in models so it can run without a server or file access permissions.

To add a built-in, create a directory, add its catalog entry and register the static
import in [builtin.ts](../../../packages/scenarios/builtin.ts). The default model is
imported through the simulation core's [universe.ts](../../../packages/sim-core/src/universe.ts).
Static imports keep the standalone HTML and headless server portable. Users can
import custom universe files at runtime without rebuilding the application.
