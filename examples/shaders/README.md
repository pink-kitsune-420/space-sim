# Shader Examples

Load [violet.json](violet.json) through **Shaders → Load shader…**, or export the current pack to edit all six public stages.

Violet also works with the [dry terrain worlds](../../games/space-sim/universes/sandbox/terrain/universe.json).
Terrain geometry, relief shading and atmosphere use a built-in pass in WebGL, so this pack styles the sky, circular bodies, paths, vessels and labels.
To change terrain colors, edit the universe body's `color`, `accentColor`, `horizonColor`, `atmosphereColor` and `skyColor` fields. Canvas shows the same terrain with its built-in appearance. Flight and prediction use the same CPU terrain profile.
