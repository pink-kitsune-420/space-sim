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
/** Screen-space vector artwork (+X forward), shared by Canvas and WebGL. The hull is
 * a triangle fan and a closed outline. The flame tip extends with normalized throttle.
 * This optional presentation data never changes authority or physical geometry. */
export interface VehicleAppearance {
  /** Namespaced vehicle identifier matching a declared VehicleDefinition id. */
  readonly vehicleId: string;
  /** Hull vertices in screen coordinates relative to the craft center (3 to 32 points). */
  readonly hull: readonly Vec[];
  /** Optional thruster exhaust flame dimensions for active acceleration visuals. */
  readonly flame?: { readonly x: number; readonly halfWidth: number; readonly length: number; readonly throttleLength: number };
}

/** Lookup table resolving optional vector appearance artwork by namespaced vehicle ID. */
export interface VehicleArtwork {
  /** Retrieve artwork for a vehicle ID, or undefined to fall back to generic VEHICLE_MARKER. */
  get(vehicleId?: string): VehicleAppearance | undefined;
}

const VEHICLE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,31}$/;
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
export function captureVehicleDefinition(value: unknown): VehicleDefinition {
  const raw = object(value, ['id', 'name', 'handling']);
  const id = vehicleId(raw.id);
  if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 128) throw new Error('Invalid vehicle name');
  let handling: Readonly<VehicleDefaults> | undefined;
  if (raw.handling !== undefined) {
    const h = object(raw.handling, ['acceleration', 'turnRate', 'initialThrottle']);
    handling = Object.freeze({ acceleration: bounded(h.acceleration, 0, 1e9), turnRate: bounded(h.turnRate, 0, 1e6), initialThrottle: bounded(h.initialThrottle, 0, 1) });
  }
  return Object.freeze({ id, name: raw.name, ...(handling ? { handling } : {}) });
}
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
  const raw = object(value, ['vehicleId', 'hull', 'flame']);
  const id = vehicleId(raw.vehicleId);
  if (!Array.isArray(raw.hull) || raw.hull.length < 3 || raw.hull.length > 32) throw new Error('Vehicle hull requires 3–32 points');
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
  return Object.freeze({ vehicleId: id, hull, ...(flame ? { flame } : {}) });
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
