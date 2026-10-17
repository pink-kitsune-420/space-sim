# 2D & WebGL 2 Renderer

Consumes coherent simulation snapshots, timed trajectory paths, and camera transforms. Owns projection, analytical clipping, curve tessellation, celestial disc/horizon drawing, and HUD markers.

`src/index.ts` provides the renderer interface and shared world projection with per-frame camera constants, screen-space mouse panning, camera rotation and shortest-angle blending. Ship, body, heading and coast samples use one transform. Renderer code never mutates simulation state.

`RenderFrame.ships` adds other vessels beneath the piloted one, tinted by whether they belong to this player's fleet or to someone else.

`src/canvas.ts` contains Canvas 2D drawing. `src/webgl.ts` owns GPU resources and geometry submission; `src/shaders/` contains the default scene, vector and text GLSL stages, including their palettes. Shader packs can replace those public passes at load time.

`src/terrain.ts` supplies shared CPU terrain geometry, view selection, error-bounded tessellation/simplification, double precision local projection, viewport clipping, relief shading and body-fixed feature accents. Both renderers consume `RenderBody.surface`. Profiles are generated on system load by the app, and supplied to flight and prediction.
