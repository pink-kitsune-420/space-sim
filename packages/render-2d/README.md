# 2D renderer

Consume coherent snapshots, timed paths and a camera transform. Own projection,
clipping, curve tessellation, disc/horizon drawing and marker placement. Begin with
Canvas 2D; preserve a renderer interface for a later measured WebGL backend.
Perform camera-relative subtraction in Float64. No physics state mutation.

`src/index.ts` provides the renderer interface and Canvas 2D implementation, shared
world projection, camera rotation and shortest-angle blending. Ship, body, heading
and coast samples use one transform. Renderer code never mutates simulation state.
See [architecture](../../docs/ARCHITECTURE.md).
