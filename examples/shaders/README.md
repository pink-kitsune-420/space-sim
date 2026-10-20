# Shader Examples

Load [violet.json](violet.json) through **Tools → Shaders → Load shader…**. The JSON
contains editable GLSL for three public passes (`scene`, `vector`, `text`), each
with a vertex and fragment stage. Loading a shader pack switches to WebGL 2.

Copy this file to make a pack, edit its GLSL strings, then load your copy. A lone
`.frag` or `.glsl` file replaces only the scene fragment shader. A rejected shader
keeps the previous working pack.

**Export shaders** downloads a `.spacedata` archive. To edit an exported pack,
unpack it from the repository root:

```sh
npm run file:unpack -- my-shaders.spacedata /tmp/my-shaders
# Edit the shader definition under /tmp/my-shaders/data/.
npm run file:pack -- /tmp/my-shaders /tmp/edited-shaders.spacedata
npm run file:validate -- /tmp/edited-shaders.spacedata
```

The destination for unpacking must be new or empty. Legacy shader JSON still loads.
See **Manual → Creators → Shader packs** for the pass contract.

Violet also works with the [dry terrain worlds](../../games/space-sim/universes/sandbox/terrain/universe.json).
Terrain geometry, relief shading and atmosphere use a built-in pass in WebGL, so this pack styles the sky, circular bodies, paths, vessels and labels.
To change terrain colors, edit the universe body's `color`, `accentColor`, `horizonColor`, `atmosphereColor` and `skyColor` fields. Canvas shows the same terrain with its built-in appearance. Flight and prediction use the same CPU terrain profile.
