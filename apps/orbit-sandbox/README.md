# Orbit Sandbox

A Spacelab planetary-system editor and gravity playground. Create bodies by dragging empty space, inspect their physical and visual settings, experiment with gravity modes, and export universe definitions for Space Sim.

In the combined player, choose **Orbit Sandbox** in **ModMenu**, or open `?game=orbit-sandbox`. The in-game **Manual → Players → Orbit Sandbox** covers controls, warp and the CPU limiter.

## Standalone development

From the repository root, with Node.js 22.12 or newer:

```sh
npm ci
npm run dev:sandbox
```

Open the URL Vite prints, normally `http://127.0.0.1:5174/`. For a standalone production build and its unit tests:

```sh
npx vite build --config apps/orbit-sandbox/vite.config.ts
npm run test:sandbox
```

The standalone build writes `dist-orbit-sandbox/`. `npm run build` builds the combined player containing the Sandbox; it does not refresh this separate distribution. The root `npm test` and `npm run check` exclude the Sandbox's separate unit suite.

## Create and inspect

Select a style in the bottom palette, then drag empty space to preview and launch a body. Circularize snaps a launch to the circular speed around its dominant parent. Click a body to open the **Planet inspector** for radius, gravity, rotation, atmosphere, appearance and rings. The dock opens **Physics**, **Appearance**, **Testing** and **Export**.

Orbit guides show estimated conics relative to parent bodies. In interacting systems these are local orbit estimates. The launch preview and selected orbit can show apoapsis and periapsis markers.

## Physics modes

- **Kepler 2-Body** uses central-force orbital motion around a dominant parent.
- **N-Body Gravity** integrates pairwise gravitational interactions and merges colliding bodies.
- **Full Body Physics** adds optional equatorial J₂ perturbations, tidal spin coupling and configurable collision response.

These are the Sandbox's own model modes. Export creates a hierarchical universe definition for the receiving game; it does not carry the Sandbox's running N-body state or numerical solver into Space Sim. Space Sim uses its flight physics and requires compatible hierarchy and starting data.

Warp is selectable up to 100,000×. Faster warp adds bounded numerical steps; a CPU budget can lower the requested speed. **Testing Lab → Disable CPU limiter (debug)** removes that work budget for the session and can stall the interface at high speeds.

## Export and share

**Export Universe** validates definitions with the simulation core's `validateUniverse`. Download editable JSON, download reusable `.spacedata` definitions, copy JSON, or stage the definition for Space Sim. Direct staging uses local browser storage and needs both applications to share an origin; file export/import also works across origins.

A `.spacedata` file is a ZIP containing definitions. Space Sim's **Fleet → Save universe** instead writes `.spaceuniverse` flight progress. Legacy `.spaceuniverse` definition files remain importable.

The **Testing Lab** includes diagnostic checks and interactive scenarios for three-body motion, J₂ perturbations, tidal locking, collisions and ring stress. Use the unit suite for automated regression checks; interactive demonstrations do not establish numerical accuracy by themselves.
