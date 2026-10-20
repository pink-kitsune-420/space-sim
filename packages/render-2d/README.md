# Canvas 2D and WebGL 2 rendering adapters

Consumes simulation snapshots, trajectory samples and camera transforms to draw the world. Renderer code does not mutate simulation state.

The reusable implementations live in [modules/render-canvas](../../modules/render-canvas/) and [modules/render-webgl](../../modules/render-webgl/). This package supplies compatibility constructors and engine ports for the existing flight application. New module code uses the public rendering contracts in [packages/game-api](../game-api/src/index.ts).

- [src/index.ts](src/index.ts) exposes the compatibility renderers, projection helpers, appearance preview and theme support.
- [src/frame.ts](src/frame.ts) re-exports pure projection and path math from the public API; importing it does not load a renderer.
- [src/canvas.ts](src/canvas.ts) and [src/webgl.ts](src/webgl.ts) bind engine ports to the module-owned renderer classes.
- [src/terrain.ts](src/terrain.ts) adapts shared CPU terrain geometry to the engine's surface queries. Drawing and flight use the same deterministic surface profiles.
- [src/shaders.ts](src/shaders.ts) exposes the default shader stages. Shader packs can replace the public scene, vector and text passes; terrain uses a separate built-in pass.

Projection keeps world calculations in double precision and uses local coordinates for rendering. Additional ships share the same camera transform as the piloted vessel, with fleet/ownership styling supplied by the frame.

For editing shader packs, see [examples/shaders](../../examples/shaders/README.md) and **Manual → Creators → Shader packs**.
