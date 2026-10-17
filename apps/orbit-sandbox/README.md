# Orbit Sandbox (Interactive Planet Creator & Gravity Playground)

A standalone Spacelab application for dynamically creating, customizing, and slinging celestial bodies into orbit, simulating emergent gravitational interactions (Kepler 2-Body, N-Body, and Full Body Physics), and exporting custom universes (`.spaceuniverse` and `.json`) to Space Sim.

---

## Quick Start

Launch the development server on port 5174:

```bash
npm run dev:sandbox
```

Or build for production:

```bash
npx vite build apps/orbit-sandbox --config apps/orbit-sandbox/vite.config.ts
```

Open your browser to `http://127.0.0.1:5174/`.

---

## Core Features

### 1. Vector Space Canvas
- High-DPI canvas rendered using the Spacelab dark space palette (`#080f19`).
- Smooth pan & zoom camera controls following `packages/render-2d` conventions.
- Parallax starfield and distance grid reference rings.

### 2. Interactive Slingshot Planet Launcher
- **Click & Drag to Sling**: Click empty space to spawn a candidate celestial body, drag to pull back a velocity vector arrow $\vec{v}_0$.
- **Real-Time Ghost Trajectory**: Dynamic path prediction showing the resulting orbit, apoapsis (Ap), periapsis (Pe), orbital period, and collision/escape warnings before releasing.
- **1-Click Circularize Snap**: Hold `Shift` or click the **Circularize** button in the header to automatically snap velocity to an exact circular orbit ($v_{\text{circ}} = \sqrt{\mu / r}$).

### 3. In-Situ Planet Customizer Panel
- Click any existing celestial body to open the floating inspector:
  - **Style Presets**: Oceanic Garden, Rocky Moon, Gas Giant (with rings), Icy World, Volcanic World, Radiant Star.
  - **Dynamic Sliders**: Physical radius, mass / gravitational parameter $\mu$, rotation period, ocean coverage level, atmosphere glow color.
  - **Ring Belt Creator**: Add particle rings with configurable inner and outer radius boundaries and real-time rotating ring particles.
  - **Camera Focus & Deletion**: Center view on the body or delete it.

### 4. Physics Simulation Modes
- **Kepler 2-Body**: Patched-conics central force propagation.
- **N-Body Gravity**: Universal gravitational interaction between all celestial bodies with momentum-conserving coalescence.
- **Full Body Physics**:
  - $J_2$ Equatorial oblateness quadrupole harmonic perturbation causing apsidal precession.
  - Tidal torques and spin-orbit coupling (gradual tidal locking).
  - Physical collision response: Inelastic merge vs elastic/semi-elastic bounce with adjustable restitution coefficient $e$.

### 5. Cached Planetary Orbit Lines
- Real-time Keplerian conic orbit line rendering for all planetary bodies and moons.
- **Smart Conic Estimation & Epoch Caching**: Caches relative 64-point ellipse vertices per-body with an epoch-based validity check (0.25s), shifting smoothly relative to parent bodies without per-frame numerical re-integration.
- Visual periapsis (`Pe`) and apoapsis (`Ap`) distance markers and parent-colored trajectory paths.
- Toggle anytime via the header **Orbits** button or `O` hotkey.

### 6. Interactive & Automated Testing Lab
- **In-Browser Diagnostic Suite**: Run live verifications of energy conservation, circular orbital velocity, $J_2$ precession deflection, schema validation, and gzip compression.
- **5 Interactive Scenario Benchmarks**:
  - Figure-8 3-Body Choreography
  - $J_2$ Oblateness Nodal Precession
  - Tidal Locking Spin Dissipation
  - 2-Body Elastic Collision Bounce
  - 500-Particle Ring Belt Stress Test
- **CLI Unit Tests**: Run Vitest test runner with `npm run test:sandbox`.

### 7. Universe Export & Space Sim Integration
- **Direct Validation**: Verified against `games/space-sim/universes/universe.schema.json` via `@spacelab/sim-core` `validateUniverse`.
- **Export Formats**:
  - Uncompressed `.json` file download.
  - Losslessly compressed `.spaceuniverse` (gzip binary) download.
  - Clipboard JSON copy.
  - Direct Flight Console deep-link staging into `localStorage`.

---

## Keyboard Shortcuts

- `Space`: Play / Pause simulation.
- `Shift` (hold): Snap slingshot to exact circular orbit.
- `C`: Toggle circularize mode on/off.
- `O`: Toggle planetary orbit lines on/off.
- `Delete` / `Backspace`: Delete currently selected celestial body.
- Right-click / Middle-click / Alt-click + Drag: Pan camera.
- Mouse Wheel: Zoom in / out centered on cursor.

