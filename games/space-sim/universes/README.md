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

In Spacelab, use **Universe → Import…** or the workshop's main Import button. **Export** writes `.spaceuniverse`; **JSON** writes an editable copy. Imported universes appear in an **Imported worlds** group. **Save as game** bundles the selected universe with plugins into a portable `.spacegame`. The offline HTML embeds the built-in models so it can run without a server or file access permissions.

To add a built-in, create a directory, add its catalog entry and static import in [builtin.ts](../../../packages/scenarios/builtin.ts). Static imports keep the standalone HTML and headless server portable. Users can import custom universe files at runtime without rebuilding the application.
