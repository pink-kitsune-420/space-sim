import { FLEET_VIEWS, interpolateState, type WorldRead, type Coast, type State, type Vec, type Ship,
 type RenderShip, type FleetViewInput, type FleetViewStats, type FleetViewFactory, type FlightFleetView, type ModuleInitializationV2 } from '@space-sim/game-api';
export type { FleetViewInput, FleetViewStats } from '@space-sim/game-api';
export interface FleetViewTuning { readonly marginPixels?: number; readonly stillPixels?: number }

interface Placed { readonly coast: Coast; time: number; position: Vec; readonly vMax: number; readonly rp: number; readonly ra: number }

/** Viewport margin in CSS pixels; matches the renderers' own culling. */
const MARGIN = 40;
/** A cached position is reused while the ship cannot have moved this far on screen. */
const STILL_PIXELS = 0.25;

/** Builds the other-ship list for one frame without touching ships that cannot be seen.
 * Sleeping ships are drawn from their exact coast at the frame time (no interpolation);
 * their orbit annulus culls them before any Kepler solve, and a solved position is reused
 * while the ship cannot have moved a quarter pixel (most of a zoomed-out fleet). */
export class FleetView implements FlightFleetView {
  private disposed = false;
  private owner?: WorldRead;
  private readonly marginPixels: number;
  private readonly stillPixels: number;
  constructor(options: FleetViewTuning = {}) {
    this.marginPixels = options.marginPixels ?? MARGIN; this.stillPixels = options.stillPixels ?? STILL_PIXELS;
    if (!Number.isFinite(this.marginPixels) || this.marginPixels < 40 || this.marginPixels > 256 || !Number.isFinite(this.stillPixels) || this.stillPixels < 0 || this.stillPixels > 1) throw new Error('Invalid fleet view configuration');
  }
  readonly stats: FleetViewStats = { ships: 0, culledByOrbit: 0, solved: 0, reused: 0, visible: 0 };
  private readonly placed = new Map<string, Placed>();
  private readonly labels = new Map<string, { readonly key: string; readonly text: string }>();
  private sweep = 0;

  build(input: FleetViewInput): RenderShip[] {
    if (this.disposed) throw new Error('Fleet view disposed');
    const { world, time, camera, width, height } = input;
    if (world !== this.owner) { this.placed.clear(); this.labels.clear(); this.sweep = 0; this.owner = world; }
    const out: RenderShip[] = [];
    const stats = this.stats;
    stats.ships = stats.culledByOrbit = stats.solved = stats.reused = stats.visible = 0;
    const c = Math.cos(camera.rotation), s = Math.sin(camera.rotation), scale = camera.scale;
    const halfW = width / 2, halfH = height / 2;
    // Viewport radius about its centre, in world metres, for annulus tests.
    const viewRadius = (Math.hypot(halfW, halfH) + this.marginPixels) / scale;
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
          const orbit = world.contextFor(ship).services.orbits.elements(coast, coast.mu);
          placed = { coast, time: NaN, position: coast.position, rp: orbit.periapsis, ra: orbit.apoapsis ?? Infinity,
            vMax: Math.sqrt(Math.max(0, 2 * (orbit.energy + coast.mu / orbit.periapsis))) };
          this.placed.set(ship.id, placed);
        }
        // The orbit's annulus about its body, against a circle around the viewport.
        const dx = bodyAt.x - camera.center.x, dy = bodyAt.y - camera.center.y, d = Math.hypot(dx, dy);
        if (d - placed.ra > viewRadius || placed.rp - d > viewRadius) { stats.culledByOrbit++; continue; }
        if (!(Math.abs(time - placed.time) * placed.vMax * scale < this.stillPixels)) {
          const result = world.contextFor(ship).coastAt(coast, time, world.body(ship.bodyId), world.surface(ship.bodyId), { cache: false });
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
      if (sx < -this.marginPixels || sx > width + this.marginPixels || sy < -this.marginPixels || sy > height + this.marginPixels) continue;
      stats.visible++;
      const foreign = ship.ownerId !== input.playerId;
      const pilot = foreign ? input.playerName(ship.ownerId) : undefined;
      // Ships without a pilot (stress-test asteroids) are drawn as rocks, unlabeled.
      const rock = input.isRock?.(ship) ?? false;
      out.push({ ...(ship.vehicleId ? { vehicleId: ship.vehicleId } : {}), id: ship.id, position: { x, y }, heading: state.heading, status: state.status,
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
  dispose(): void { if (this.disposed) return; this.disposed = true; this.placed.clear(); this.labels.clear(); this.owner = undefined; this.sweep = 0; }

}

export function createFleetViews(options: FleetViewTuning = {}): FleetViewFactory & { dispose(): void } {
 const views = new Set<FlightFleetView>(); let disposed = false;
 return Object.freeze({ create() {
  if (disposed) throw new Error('Fleet view provider disposed');
  const view = new FleetView(options), close = view.dispose.bind(view); let closed = false;
  view.dispose = () => { if (closed) return; closed = true; views.delete(view); close(); }; views.add(view); return view;
 }, dispose() {
  if (disposed) return; disposed = true; const errors: unknown[] = [];
  for (const view of views) { try { view.dispose(); } catch (error) { errors.push(error); } }
  views.clear(); if (errors.length) throw new AggregateError(errors, 'Fleet view provider cleanup failed');
 } });
}
export default function initialize(context: ModuleInitializationV2): void {
 context.contributeGuide({ id: 'usage', audience: 'creators', title: 'Independent fleet views', summary: 'Selected-provider coast queries, per-view culling/cache and borrowed world reads.', asset: 'docs/creators/usage.json' });
 context.provide(FLEET_VIEWS, context.own(createFleetViews(context.settings)));
}
