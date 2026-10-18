import type { WorldRead } from '../../../packages/game-api/src/index';
import type { Camera, GhostEnd, GhostSample, OverlayPrimitive, Vec } from '../../../packages/game-api/src/index';
import type { Ship } from '../../../packages/sim-core/src/world';
import { hermiteControls } from '../../../packages/render-2d/src/frame';

export type OtherOrbitMode = 'auto' | 'always' | 'off';
export const OTHER_ORBIT_PILOT_LIMIT = 8;
export const OTHER_ORBIT_PATH_LIMIT = 16;
const REFRESH_MS = 1000;
const MAX_SAMPLES = 256;
type Point = { x: number; y: number };
interface Entry {
  readonly id: string;
  readonly ownerId: string;
  readonly bodyId: string;
  nextAt: number;
  end: GhostEnd;
  samples: readonly GhostSample[];
  local: readonly Vec[];
  points: Point[];
  overlay?: OverlayPrimitive;
  radius: number;
}
interface Pass {
  readonly entry: Entry;
  readonly job: Generator<GhostSample, GhostEnd>;
  readonly samples: GhostSample[];
  dispose(): void;
}

export function showOtherOrbits(mode: OtherOrbitMode, otherPilots: number): boolean {
  return otherPilots > 0 && mode !== 'off' && (mode === 'always' || otherPilots <= OTHER_ORBIT_PILOT_LIMIT);
}

/** Lower-priority coast previews. Jobs own isolated prediction contexts; a shared wall-clock
 * budget and sample/path caps bound work independently of fleet size. One job runs at a time,
 * and completed geometry stays visible while a later pass refreshes it. SI body-relative
 * samples are translated into system coordinates at draw time. No live controls are changed. */
export class OtherOrbits {
  readonly stats = { starts: 0, completed: 0, paths: 0, workMs: 0, enabled: false };
  maxMs = .5;
  private world?: WorldRead;
  private excludedOwner?: string;
  private nextScan = -Infinity;
  private readonly entries = new Map<string, Entry>();
  private queue: Entry[] = [];
  private cursor = 0;
  private pass?: Pass;
  private readonly output: OverlayPrimitive[] = [];

  clear(): void {
    this.cancel(); this.entries.clear(); this.queue = []; this.output.length = 0;
    this.world = undefined; this.nextScan = -Infinity; this.cursor = 0;
    this.stats.paths = 0; this.stats.enabled = false; this.stats.workMs = 0;
  }

  private cancel(): void {
    const pass = this.pass;
    this.pass = undefined;
    if (pass) {
      try { pass.job.return('open'); } catch { /* a failed provider still needs disposal */ }
      try { pass.dispose(); } catch { /* keep provider cleanup isolated from the live world */ }
    }
  }

  update(world: WorldRead, excludedOwner: string | undefined, isPilot: (id: string) => boolean,
    now: number, enabled: boolean): void {
    if (!enabled) { if (this.world) this.clear(); return; }
    if (world !== this.world || excludedOwner !== this.excludedOwner) {
      this.clear(); this.world = world; this.excludedOwner = excludedOwner;
    }
    this.stats.enabled = true; this.stats.workMs = 0;
    // Discard stale frames/status immediately, rather than waiting for the next slow scan.
    for (const [id, entry] of this.entries) {
      const ship = world.record(id);
      if (!ship || ship.bodyId !== entry.bodyId || ship.ownerId !== entry.ownerId
        || ship.state.status !== 'flying' || ship.fault || !isPilot(ship.ownerId)) {
        if (this.pass?.entry === entry) this.cancel();
        this.entries.delete(id); this.nextScan = -Infinity;
      }
    }
    if (now >= this.nextScan) {
      this.nextScan = now + REFRESH_MS;
      const eligible: Ship[] = [];
      for (const ship of world.records()) {
        if (ship.ownerId !== excludedOwner && ship.state.status === 'flying' && !ship.fault && isPilot(ship.ownerId)) eligible.push(ship);
      }
      // Prefer one vessel per pilot before filling spare capacity with their other ships.
      const owners = new Set<string>(), chosen = new Set<string>();
      for (const ship of eligible) {
        if (chosen.size === OTHER_ORBIT_PATH_LIMIT) break;
        if (!owners.has(ship.ownerId)) { owners.add(ship.ownerId); chosen.add(ship.id); }
      }
      for (const ship of eligible) { if (chosen.size === OTHER_ORBIT_PATH_LIMIT) break; chosen.add(ship.id); }
      for (const id of this.entries.keys()) if (!chosen.has(id)) {
        if (this.pass?.entry.id === id) this.cancel();
        this.entries.delete(id);
      }
      for (const id of chosen) if (!this.entries.has(id)) {
        const ship = world.record(id)!;
        this.entries.set(id, { id, ownerId: ship.ownerId, bodyId: ship.bodyId, nextAt: now,
          end: 'open', samples: [], local: [], points: [], radius: 0 });
      }
      this.queue = [...this.entries.values()];
    }
    const start = performance.now();
    try {
      if (!this.pass && this.queue.length) {
        for (let n = 0; n < this.queue.length; n++) {
          const entry = this.queue[this.cursor++ % this.queue.length]!;
          if (!this.entries.has(entry.id) || now < entry.nextAt) continue;
          const ship = world.ship(entry.id);
          if (!ship) continue;
          entry.nextAt = now + REFRESH_MS;
          if (world.requiresWorldPrediction) {
            this.pass = { entry, job: world.predictShip(entry.id), samples: [], dispose() {} };
          } else {
            const context = world.contextFor(ship).cloneForPrediction();
            try {
              this.pass = { entry, job: context.predict(structuredClone(ship.state), false, world.body(ship.bodyId), world.surface(ship.bodyId)),
                samples: [], dispose: () => context.dispose() };
            } catch (error) { context.dispose(); throw error; }
          }
          this.stats.starts++;
          break;
        }
      }
      for (let n = 0; this.pass && n < 64 && performance.now() - start < this.maxMs; n++) {
        const result = this.pass.job.next();
        if (!result.done) this.pass.samples.push(result.value);
        if (result.done || this.pass.samples.length >= MAX_SAMPLES) {
          const { entry, samples } = this.pass;
          entry.samples = samples;
          entry.end = result.done ? result.value : 'open';
          this.geometry(entry);
          this.stats.completed++;
          this.cancel();
          break;
        }
      }
    } catch {
      // A provider failure must not stop the live world or other pilots' previews.
      if (this.pass) { this.pass.entry.local = []; this.pass.entry.overlay = undefined; }
      this.cancel();
    }
    this.stats.workMs = performance.now() - start;
    let paths = 0;
    for (const entry of this.entries.values()) if (entry.overlay) paths++;
    this.stats.paths = paths;
  }

  private geometry(entry: Entry): void {
    const local: Vec[] = [], samples = entry.samples;
    if (samples.length > 1 && entry.end !== 'failed') {
      local.push(samples[0]!.position);
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1]!, b = samples[i]!, [c1, c2] = hermiteControls(a, b);
        const steps = b.linear ? 1 : 4;
        for (let n = 1; n <= steps; n++) {
          const t = n / steps, u = 1 - t;
          local.push({ x: u*u*u*a.position.x + 3*u*u*t*c1.x + 3*u*t*t*c2.x + t*t*t*b.position.x,
            y: u*u*u*a.position.y + 3*u*u*t*c1.y + 3*u*t*t*c2.y + t*t*t*b.position.y });
        }
      }
    }
    entry.local = local; entry.points = local.map(() => ({ x: 0, y: 0 }));
    entry.radius = 0;
    for (const point of local) entry.radius = Math.max(entry.radius, Math.hypot(point.x, point.y));
    entry.overlay = local.length > 1 ? { kind: 'line', space: 'world', points: entry.points, color: '#efb66b66', width: 1 } : undefined;
  }

  /** Geometry storage is reused. Call and consume for one viewport before building another. */
  overlays(world: WorldRead, time: number, viewer: string, camera: Camera, width: number, height: number): readonly OverlayPrimitive[] {
    this.output.length = 0;
    if (world !== this.world) return this.output;
    const viewRadius = Math.hypot(width, height) / (2 * camera.scale);
    for (const entry of this.entries.values()) {
      if (!entry.overlay || entry.ownerId === viewer) continue;
      if (entry.end !== 'closed' && (entry.samples.at(-1)?.time ?? -Infinity) <= time) continue;
      const origin = world.system.getBodyPosition(entry.bodyId, time);
      if (Math.hypot(origin.x - camera.center.x, origin.y - camera.center.y) > entry.radius + viewRadius + 40 / camera.scale) continue;
      for (let i = 0; i < entry.local.length; i++) {
        const local = entry.local[i]!, point = entry.points[i]!;
        point.x = origin.x + local.x; point.y = origin.y + local.y;
      }
      this.output.push(entry.overlay);
    }
    return this.output;
  }
}
