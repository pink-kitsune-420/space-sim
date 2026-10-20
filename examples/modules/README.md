# Module Examples

Authoring samples that use only the public API in
[`packages/game-api`](../../packages/game-api/src/index.ts). They are installed in the
game but stay off until a profile or URL selects them. These samples use API v1.
The game's legacy base modules live in
[`packages/modules/src/base`](../../packages/modules/src/base); reusable API v2
packages live in [`modules/`](../../modules/). See **Manual → Creators → Code modules**
for both authoring routes and compatibility requirements.

| Example | Kind | Try it |
|---|---|---|
| [gentle-flight.json](gentle-flight.json) | Data module: vehicle settings | **ModMenu → Advanced · data & profiles → Load module/profile…** |
| [motion.ts](motion.ts) | Force extension and numerical dynamics replacement | `?example=force`, `?example=numerical` |
| [rules.ts](rules.ts) | Shared-world rule with module state and seeded RNG | `?example=rule` |
| [commands.ts](commands.ts) | Authoritative pilot commands run by the host | `?example=commands`, then U / J / V |
| [lead-camera.ts](lead-camera.ts) | Presentation add-on depending on `builtin.flight-data` | **ModMenu → Instruments & display → Lead camera (example)** |

## Gentle Flight

Open **ModMenu → Advanced · data & profiles → Load module/profile…** and choose
[gentle-flight.json](gentle-flight.json). This starts a new solo preview with lower
engine acceleration (75 m/s²) and turn rate (0.6 rad/s). Set throttle to 100% to
launch from the default planet; the initial half throttle cannot overcome gravity.
Edit `data.vehicle.settings` in a copy, then load it again. Use **Export module**
to keep your data or **Export profile** to share the module and world selection.

## Dependencies

A module lists what it needs in `dependencies`, with an exact version or a range
(`^0.1.0`, `~1.2.0`, `>=1.0.0 <2.0.0`, `*`, alternatives with `||`), and modules it
cannot run beside in `conflicts`. A dependency initializes first and can publish an
API with `context.expose(api)`; a dependent reads it with
`context.dependency('<id>')`. The lead camera uses `builtin.flight-data` this way and
declares the small part of that API it relies on. Enabling it in the game enables
Flight data too; removing Flight data removes the lead camera with it.

For importable code, starters are provided:
[force](force), [numerical replacement](numerical), [telemetry overlay/panel](telemetry),
and [save state/migration](state). Build one with:

```sh
npm run module:build -- examples/modules/force/module.json /tmp/force.module.json
```

Install the artifact with **ModMenu → Import game, plugin or universe…**, then select
and apply it in **Plugins · simulation, data & settings**. Only import code you trust;
it runs with the application's privileges when enabled.
Share artifacts alongside exported profiles; saves contain state and required
identities, never executable code.

Editable ZIP versions of these starters live in [examples/packages](../packages/README.md).
Use `module:new`, `module:build`, `module:pack` and `module:unpack` for `.spacemod` files.
Run all commands from the repository root after `npm ci`. The `module:new` scaffold
currently generates API v1; the [inventory example](../packages/inventory/) provides
an API v2 authoritative data example. A v2 package needs its matching manifest,
initializer and declared services, beyond changing the API version string.
