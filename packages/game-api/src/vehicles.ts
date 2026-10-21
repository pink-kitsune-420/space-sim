import type { VehicleDefaults } from './universe';
import type { Vec } from './state';

/** Legacy craft map to this definition without changing state or old save bytes. */
export const TRAINER_VEHICLE_ID = 'spacelab.trainer/orbit-trainer';
/** A valid universe needs installed vehicle packages, rather than damaged-file recovery. */
export class VehicleConfigurationError extends Error {}

/** Immutable authoritative handling, in SI units. Omitted handling uses the selected
 * system's vehicleDefaults, preserving the trainer's existing configuration precedence. */
export interface VehicleDefinition {
  readonly id: string;
  readonly name: string;
  readonly handling?: Readonly<VehicleDefaults>;
}
/** Explicit opt-in for mixed-vehicle saves/sessions. Definitions come from enabled,
 * approved modules; saved definitions never install or execute missing packages. */
export interface VehicleCatalog {
  readonly format: 'space-sim-vehicles/1';
  readonly defaultId: string;
  readonly definitions: readonly VehicleDefinition[];
}
/** Vector artwork (+X forward), shared by Canvas and WebGL. Units are CSS pixels
 * unless metresPerUnit opts into world-space scaling. The hull is
 * a triangle fan and a closed outline. The flame tip extends with normalized throttle.
 * This optional presentation data never changes authority or physical geometry. */
export interface VehicleAppearance {
  /** Namespaced vehicle identifier matching a declared VehicleDefinition id. */
  readonly vehicleId: string;
  /** Hull vertices in local artwork units relative to the craft centre (3 to 128 points). */
  readonly hull: readonly Vec[];
  /** Optional world metres per artwork unit. Close views use physical scale; below
   * 8 CSS pixels across, renderers show a position marker. Omitted retains pixel art. */
  readonly metresPerUnit?: number;
  /** Optional open detail paths in the same local units, e.g. cockpit and hatch. */
  readonly lines?: readonly (readonly Vec[])[];
  /** Optional thruster exhaust flame dimensions for active acceleration visuals. */
  readonly flame?: { readonly x: number; readonly halfWidth: number; readonly length: number; readonly throttleLength: number };
}

/** Lookup table resolving optional vector appearance artwork by namespaced vehicle ID. */
export interface VehicleArtwork {
  /** Retrieve artwork for a vehicle ID, or undefined to fall back to generic VEHICLE_MARKER. */
  get(vehicleId?: string): VehicleAppearance | undefined;
}

const VEHICLE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,31}$/;
/** Validate and return a namespaced vehicle identifier (`<module-id>/<local-name>`, max 160 chars). Throws if malformed. */
export function vehicleId(value: unknown): string {
  if (typeof value !== 'string' || value.length > 160 || !VEHICLE_ID.test(value)) throw new Error('Vehicle requires a namespaced ID');
  return value;
}
function object(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !fields.includes(key))) throw new Error('Invalid vehicle fields');
  return value as Record<string, unknown>;
}
function bounded(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) throw new Error('Invalid vehicle numeric value');
  return value;
}
/** Validate, bound SI handling parameters (`acceleration` in `m/s²`, `turnRate` in `rad/s`, `initialThrottle` in `[0, 1]`), and freeze a `VehicleDefinition`. */
export function captureVehicleDefinition(value: unknown): VehicleDefinition {
  const raw = object(value, ['id', 'name', 'handling']);
  const id = vehicleId(raw.id);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 128) throw new Error('Invalid vehicle name');
  let handling: Readonly<VehicleDefaults> | undefined;
  if (raw.handling !== undefined) {
    const h = object(raw.handling, ['acceleration', 'turnRate', 'initialThrottle', 'contactRadiusMetres']);
    handling = Object.freeze({ acceleration: bounded(h.acceleration, 0, 1e9), turnRate: bounded(h.turnRate, 0, 1e6), initialThrottle: bounded(h.initialThrottle, 0, 1),
      ...(h.contactRadiusMetres === undefined ? {} : { contactRadiusMetres: bounded(h.contactRadiusMetres, 0, 32) }) });
  }
  return Object.freeze({ id, name: raw.name, ...(handling ? { handling } : {}) });
}
/** Validate, sort by ID, and freeze a `space-sim-vehicles/1` catalog (1–128 unique vehicle definitions). Throws on duplicate or missing `defaultId`. */
export function captureVehicleCatalog(value: unknown): VehicleCatalog {
  const raw = object(value, ['format', 'defaultId', 'definitions']);
  if (raw.format !== 'space-sim-vehicles/1' || !Array.isArray(raw.definitions) || !raw.definitions.length || raw.definitions.length > 128) throw new Error('Invalid vehicle catalog');
  const definitions = raw.definitions.map(captureVehicleDefinition).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const ids = new Set(definitions.map(d => d.id));
  if (ids.size !== definitions.length || !ids.has(vehicleId(raw.defaultId))) throw new Error('Duplicate or missing default vehicle');
  return Object.freeze({ format: 'space-sim-vehicles/1', defaultId: raw.defaultId as string, definitions: Object.freeze(definitions) });
}
/** Validate, bound and freeze a vehicle appearance definition. Throws on invalid fields, non-namespaced ID, or out-of-bounds geometry. */
export function captureVehicleAppearance(value: unknown): VehicleAppearance {
  const raw = object(value, ['vehicleId', 'hull', 'flame', 'metresPerUnit', 'lines']);
  const id = vehicleId(raw.vehicleId);
  if (!Array.isArray(raw.hull) || raw.hull.length < 3 || raw.hull.length > 128) throw new Error('Vehicle hull requires 3–128 points');
  const hull = Object.freeze(raw.hull.map(value => {
    const p = object(value, ['x', 'y']);
    return Object.freeze({ x: bounded(p.x, -32, 32), y: bounded(p.y, -32, 32) });
  }));
  let flame: VehicleAppearance['flame'];
  if (raw.flame !== undefined) {
    const f = object(raw.flame, ['x', 'halfWidth', 'length', 'throttleLength']);
    flame = Object.freeze({ x: bounded(f.x, -32, 32), halfWidth: bounded(f.halfWidth, 0, 32),
      length: bounded(f.length, 0, 32), throttleLength: bounded(f.throttleLength, 0, 32) });
  }
  const metresPerUnit = raw.metresPerUnit === undefined ? undefined : bounded(raw.metresPerUnit, Number.MIN_VALUE, 1000);
  if (raw.lines !== undefined && (!Array.isArray(raw.lines) || raw.lines.length > 16)) throw new Error('Invalid vehicle detail paths');
  const lines = raw.lines === undefined ? undefined : Object.freeze((raw.lines as unknown[]).map(line => {
    if (!Array.isArray(line) || line.length < 2 || line.length > 32) throw new Error('Invalid vehicle detail path');
    return Object.freeze(line.map(value => {
      const point = object(value, ['x', 'y']);
      return Object.freeze({ x: bounded(point.x, -32, 32), y: bounded(point.y, -32, 32) });
    }));
  }));
  return Object.freeze({ vehicleId: id, hull, ...(flame ? { flame } : {}),
    ...(metresPerUnit === undefined ? {} : { metresPerUnit }), ...(lines ? { lines } : {}) });
}
/** Capture once at composition, then read without allocating during drawing. Unknown
 * vehicles have no artwork; renderers retain their generic position marker. */
export function createVehicleArtwork(values: readonly VehicleAppearance[]): VehicleArtwork {
  const map = new Map<string, VehicleAppearance>();
  if (values.length > 128) throw new Error('Too many vehicle appearances');
  for (const value of values) {
    const captured = captureVehicleAppearance(value);
    if (map.has(captured.vehicleId)) throw new Error(`Duplicate appearance for ${captured.vehicleId}`);
    map.set(captured.vehicleId, captured);
  }
  return Object.freeze({ get: (id = TRAINER_VEHICLE_ID) => map.get(id) });
}

/** Scale for world-space artwork, or zero when its projected extent is below
 * eight CSS pixels and the renderer should use a position marker. Pixel art uses 1. */
export function vehicleArtworkScale(artwork: VehicleAppearance, pixelsPerMetre: number): number {
  if (artwork.metresPerUnit === undefined) return 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of artwork.hull) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const scale = artwork.metresPerUnit * pixelsPerMetre;
  return Math.max(maxX - minX, maxY - minY) * scale < 8 ? 0 : scale;
}
