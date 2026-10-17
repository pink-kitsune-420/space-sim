import { coastAt, elements, type Coast, type State, type Vec } from '../../../packages/sim-core/src/index';
import type { Ship, World } from '../../../packages/sim-core/src/world';
import { interpolateState, type Camera, type RenderShip } from '../../../packages/render-2d/src/index';

export interface FleetViewInput {
  readonly world: World;
  /** Presentation time of the frame (may lie between fixed steps). */
  readonly time: number;
  readonly alpha: number;
  readonly paused: boolean;
  readonly skipId?: string;
  readonly playerId: string;
  readonly camera: Camera;
  readonly width: number;
  readonly height: number;
  previous(shipId: string): Ship | undefined;
  /** Draw this record as an asteroid. */
  isRock?(ship: Ship): boolean;
  displayOffset(shipId: string): Vec;
  playerName(id: string): string | undefined;
  /** A state in the drawn frame (a ship resting on a turning body); as is when absent. */
  display?(state: State, bodyId: string): State;
  /** Blend two steps in the drawn frame; `interpolateState` when absent. */
  interpolate?(from: State, to: State, alpha: number, bodyId: string): State;
}

export interface FleetViewStats {
  ships: number;
  /** Skipped without evaluating a position: the whole orbit lies off screen. */
  culledByOrbit: number;
  /** Kepler solves this frame. */
  solved: number;
  /** Sleeping ships drawn from a position that cannot have moved a quarter pixel. */
  reused: number;
  visible: number;
}

interface Placed { readonly coast: Coast; time: number; position: Vec; readonly vMax: number; readonly rp: number; readonly ra: number }

/** Viewport margin in CSS pixels; matches the renderers' own culling. */
const MARGIN = 40;
/** A cached position is reused while the ship cannot have moved this far on screen. */
const STILL_PIXELS = 0.25;

/** Builds the other-ship list for one frame without touching ships that cannot be seen.
 * Sleeping ships are drawn from their exact coast at the frame time (no interpolation);
 * their orbit annulus culls them before any Kepler solve, and a solved position is reused
 * while the ship cannot have moved a quarter pixel (most of a zoomed-out fleet). */
export class FleetView {
  readonly stats: FleetViewStats = { ships: 0, culledByOrbit: 0, solved: 0, reused: 0, visible: 0 };
  private readonly placed = new Map<string, Placed>();
  private readonly labels = new Map<string, { readonly key: string; readonly text: string }>();
  private sweep = 0;

  build(input: FleetViewInput): RenderShip[] {
    const { world, time, camera, width, height } = input;
    const out: RenderShip[] = [];
    const stats = this.stats;
    stats.ships = stats.culledByOrbit = stats.solved = stats.reused = stats.visible = 0;
    const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation), scale = camera.scale;
    const halfW = width / 2, halfH = height / 2;
    // Viewport radius about its centre, in world metres, for annulus tests.
    const viewRadius = (Math.hypot(halfW, halfH) + MARGIN) / scale;
    const system = world.system;
    for (const ship of world.records()) {
      if (ship.id === input.skipId) continue;
      stats.ships++;
      const bodyAt = system.getBodyPosition(ship.bodyId, time);
      let state: State | undefined;
      if (world.isAsleep(ship.id) && ship.state.coast && ship.state.dynamics === 'kepler') {
        const coast = ship.state.coast;
        let placed = this.placed.get(ship.id);
        if (!placed || placed.coast !== coast) {
          const orbit = elements(coast, coast.mu);
          placed = { coast, time: NaN, position: coast.position, rp: orbit.periapsis, ra: orbit.apoapsis ?? Infinity,
            vMax: Math.sqrt(Math.max(0, 2 * (orbit.energy + coast.mu / orbit.periapsis))) };
          this.placed.set(ship.id, placed);
        }
        // The orbit's annulus about its body, against a circle around the viewport.
        const dx = bodyAt.x - camera.center.x, dy = bodyAt.y - camera.center.y, d = Math.hypot(dx, dy);
        if (d - placed.ra > viewRadius || placed.rp - d > viewRadius) { stats.culledByOrbit++; continue; }
        if (!(Math.abs(time - placed.time) * placed.vMax * scale < STILL_PIXELS)) {
          const result = coastAt(coast, time, world.body(ship.bodyId), world.surface(ship.bodyId), { cache: false });
          if (result.ok) { placed.position = result.state.position; placed.time = time; stats.solved++; }
        } else stats.reused++;
        state = { ...ship.state, position: placed.position };
      } else {
        this.placed.delete(ship.id);
        const before = input.previous(ship.id);
        state = input.paused || !before || before.bodyId !== ship.bodyId ? input.display?.(ship.state, ship.bodyId) ?? ship.state
          : input.interpolate?.(before.state, ship.state, input.alpha, ship.bodyId) ?? interpolateState(before.state, ship.state, input.alpha);
      }
      const offset = input.displayOffset(ship.id);
      const x = bodyAt.x + state.position.x + offset.x, y = bodyAt.y + state.position.y + offset.y;
      const lx = x - camera.center.x, ly = y - camera.center.y;
      const sx = halfW + (lx * c - ly * s) * scale, sy = halfH - (lx * s + ly * c) * scale;
      if (sx < -MARGIN || sx > width + MARGIN || sy < -MARGIN || sy > height + MARGIN) continue;
      stats.visible++;
      const foreign = ship.ownerId !== input.playerId;
      const pilot = foreign ? input.playerName(ship.ownerId) : undefined;
      // Ships without a pilot (stress-test asteroids) are drawn as rocks, unlabeled.
      const rock = input.isRock?.(ship) ?? false;
      out.push({ id: ship.id, position: { x, y }, heading: state.heading, status: state.status,
        engine: ship.controls.engine && !input.paused, throttle: state.throttle,
        label: rock ? '' : this.label(ship, pilot), foreign: foreign && pilot !== undefined,
        ...(rock ? { rock } : {}) });
    }
    // Forget ships that left the world, now and then.
    if (++this.sweep % 600 === 0) {
      for (const id of this.placed.keys()) if (!world.has(id)) this.placed.delete(id);
      for (const id of this.labels.keys()) if (!world.has(id)) this.labels.delete(id);
    }
    return out;
  }

  private label(ship: Ship, owner: string | undefined): string {
    const key = owner === undefined ? ship.name : `${ship.name}\u0000${owner}`;
    const cached = this.labels.get(ship.id);
    if (cached?.key === key) return cached.text;
    const text = (owner === undefined ? ship.name : `${ship.name} · ${owner}`).toUpperCase();
    this.labels.set(ship.id, { key, text });
    return text;
  }
}
