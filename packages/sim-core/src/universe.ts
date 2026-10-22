/** Host-only universe validation, celestial body ephemerides, and patched-conic SOI transitions (`packages/sim-core`).
 * Modules access universe validation and system loading through `@space-sim/game-api` `CORE_MOTION` (`CoreMotion.validateUniverse`, `CoreMotion.services.bodies.load`), `BODY_FRAMES` (`BodyProvider.load`), and `WorldRead.system` (`LoadedSystem`).
 * Uses SI units (`radius` and positions in `m`, velocities in `m/s`, `mass` in `kg`, `mu = GM` in `m³/s²`, angles in `rad`, `period` and `time` in `s`) and deterministic IEEE-754 float64 `dmath`. */
import { APPEARANCE_TUNING } from '../../game-api/src/index';
import type { AppearanceStyle, AppearanceTuning, BodyAppearance, Ephemeris, CelestialBodyDefinition, RotationDefinition, PresetDefinition, VehicleDefaults, SystemDefinition, UniverseDefinition, ResolvedBody, LoadedSystem, PhysicsMode, CollisionMode, UniversePhysicsConfig, ResolvedUniversePhysics } from '../../game-api/src/index';
export type { SOI, Ephemeris, CelestialBodyDefinition, PresetDefinition, VehicleDefaults, SystemDefinition, UniverseDefinition, ResolvedBody, LoadedSystem, PhysicsMode, CollisionMode, UniversePhysicsConfig, ResolvedUniversePhysics } from '../../game-api/src/index';
import defaultUniverseJson from '../../../games/space-sim/universes/sandbox/default/universe.json';
import type { State, Vec } from '../../game-api/src/index';
import { SURFACE_LIMITS, querySurface, surfaceIdentity, validateSurfaceDefinition, type SurfaceDefinition, type SurfaceProfile } from './surface';
import { surfaceContactTolerance } from './surface-contact';
import { safeSurfaceLanding, surfaceSupport, validateMotionSurface } from './surface-flight';
import * as dm from './dmath';

/** Standard gravitational constant $G$ in $\text{m}^3 / (\text{kg} \cdot \text{s}^2)$ (`6.67430e-11`). Host-only (`packages/sim-core`). */
export const GRAVITATIONAL_CONSTANT = 6.67430e-11;

/** Smallest computed sphere of influence, in dimensionless body radii (`1.5`; authored `soi` values are kept). Host-only (`packages/sim-core`). */
export const MIN_SOI_RADII = 1.5;

/** Calculate standard Laplace sphere of influence radius $r_{\text{SOI}} = a (m / M)^{2/5}$ in `m` (`semiMajorAxis` in `m`, `bodyMass` and `parentMass` in `kg`) using deterministic `dmath.twoFifths`. Host-only (`packages/sim-core`). */
export function calculateLaplaceSOI(semiMajorAxis: number, bodyMass: number, parentMass: number): number {
  if (parentMass <= 0 || bodyMass <= 0 || semiMajorAxis <= 0) return 0;
  return semiMajorAxis * dm.twoFifths(bodyMass / parentMass);
}

/** Preserve the existing implicit star/style selection for legacy universes. */
function bodySurfaceFeatures(b: Pick<CelestialBodyDefinition, 'id' | 'name' | 'parentId' | 'surfaceFeatures'>): ResolvedBody['surfaceFeatures'] {
  return b.surfaceFeatures ?? (b.id === 'sun' || b.name.toLowerCase().includes('sun') || b.name.toLowerCase().includes('star')
    ? 'star' : b.parentId === null ? 'globe-lines' : 'craters');
}

const APPEARANCE_STYLES: readonly AppearanceStyle[] = ['rocky', 'arid', 'oceanic', 'banded', 'icy', 'hazy', 'volcanic', 'star'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
/** Tunable appearance settings, in shader order (see BodyAppearance). */
export { APPEARANCE_TUNING } from '../../game-api/src/index';

function validateAppearance(raw: unknown, where: string): BodyAppearance {
  if (!raw || typeof raw !== 'object') throw new Error(`${where} must be an object`);
  const a = raw as Record<string, unknown>;
  if (!APPEARANCE_STYLES.includes(a.style as AppearanceStyle)) throw new Error(`${where}: style must be one of ${APPEARANCE_STYLES.join(', ')}`);
  if (a.colors !== undefined && (!Array.isArray(a.colors) || a.colors.length > 4
    || !a.colors.every(c => typeof c === 'string' && HEX_COLOR.test(c)))) throw new Error(`${where}: colors must be up to four #rrggbb strings`);
  if (a.seed !== undefined && (typeof a.seed !== 'number' || !(a.seed >= 0 && a.seed <= 1000))) throw new Error(`${where}: seed must be a number from 0 to 1000`);
  const tuning: Partial<Record<AppearanceTuning, number>> = {};
  for (const key of APPEARANCE_TUNING) {
    const value = a[key];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !(value >= 0 && value <= 1)) throw new Error(`${where}: ${key} must be a number from 0 to 1`);
    tuning[key] = value;
  }
  return { style: a.style as AppearanceStyle, ...(a.colors ? { colors: [...a.colors as string[]] } : {}),
    ...(a.seed !== undefined ? { seed: a.seed as number } : {}), ...tuning };
}

/** Scale a #rrggbb colour's brightness. */
function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1, 7), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

/** A body's look: its authored appearance, else one derived from its legacy style and colours. */
function resolveAppearance(b: CelestialBodyDefinition, features: ResolvedBody['surfaceFeatures'], color: string, accent: string): ResolvedBody['appearance'] {
  const authored = b.appearance ? validateAppearance(b.appearance, `Body ${b.id} appearance`) : undefined;
  const style = features === 'star' ? 'star' : authored?.style
    ?? (features === 'craters' ? 'rocky' : features === 'smooth' ? 'hazy' : 'oceanic');
  const base = (HEX_COLOR.test(color) ? color : '#233c47').slice(0, 7), light = (HEX_COLOR.test(accent) ? accent : '#659497').slice(0, 7);
  // Fallbacks keep each colour role sensible; polar frost defaults to the ground (no cap).
  const defaults = style === 'oceanic' ? [base, '#4f7d3a', '#c2a46a', '#eef3f6']
    : style === 'arid' ? [base, shade(base, .6), shade(base, 1.35), '#f2eee8']
    : style === 'volcanic' ? [base, shade(base, .5), '#ff6a1f', '#d9b23a']
    : style === 'star' ? ['#fff6e0', base, light, shade(base, .55)]
    : style === 'icy' || style === 'hazy' ? [base, shade(base, .6), light, base]
    : [base, shade(base, .6), light, base];
  const colors = defaults.map((d, i) => authored?.colors?.[i] ?? d) as [string, string, string, string];
  const { colors: _colors, style: _style, ...settings } = authored ?? {};
  return Object.freeze({ ...settings, style, colors: Object.freeze(colors) });
}

/** A spin whose ground outruns a surface orbit would fling resting ships off the equator. */
function validateRotation(raw: unknown, radius: number, mu: number, where: string): RotationDefinition {
  if (!raw || typeof raw !== 'object') throw new Error(`${where} must be an object`);
  const r = raw as Record<string, unknown>;
  const period = r.period, direction = r.direction ?? -1, phase = r.phaseRadiansAtEpoch ?? 0;
  if (typeof period !== 'number' || !Number.isFinite(period) || period <= 0) throw new Error(`${where}: period must be a positive number of seconds`);
  if (direction !== 1 && direction !== -1) throw new Error(`${where}: direction must be 1 or -1`);
  if (typeof phase !== 'number' || !Number.isFinite(phase)) throw new Error(`${where}: phaseRadiansAtEpoch must be a finite number`);
  const omega = 2 * Math.PI / period;
  if (omega * omega * radius * radius * radius >= mu) throw new Error(`${where}: period is shorter than a surface orbit, so the body would break up`);
  return { period, direction, phaseRadiansAtEpoch: phase };
}

/** Allowed keys for UniversePhysicsConfig. Any additional keys are rejected for typo safety. */
const ALLOWED_PHYSICS_KEYS = new Set([
  'mode',
  'substeps',
  'softeningRatio',
  'enableJ2',
  'enableTidalTorque',
  'collisionMode',
  'restitution',
  'maxWarp',
]);

/** Default universe physics settings when omitted or resolving a rails universe. */
export const DEFAULT_UNIVERSE_PHYSICS: ResolvedUniversePhysics = Object.freeze({
  mode: 'rails',
  substeps: 1,
  softeningRatio: Math.sqrt(0.05),
  enableJ2: false,
  enableTidalTorque: false,
  collisionMode: 'merge',
  restitution: 0.5,
  maxWarp: 100_000,
});

/** Fully resolves universe physics settings with canonical defaults for any omitted fields. */
export function resolveUniversePhysics(universe: UniverseDefinition): ResolvedUniversePhysics {
  const p = universe.physics;
  if (!p) return DEFAULT_UNIVERSE_PHYSICS;
  const mode: PhysicsMode = p.mode ?? 'rails';
  const defaultMaxWarp = mode === 'rails' ? 100_000 : 4;
  return Object.freeze({
    mode,
    substeps: p.substeps ?? 1,
    softeningRatio: p.softeningRatio ?? Math.sqrt(0.05),
    enableJ2: p.enableJ2 ?? false,
    enableTidalTorque: p.enableTidalTorque ?? false,
    collisionMode: p.collisionMode ?? 'merge',
    restitution: p.restitution ?? 0.5,
    maxWarp: p.maxWarp ?? defaultMaxWarp,
  });
}

/** Validates authored universe physics configuration. Rejects unknown keys or out-of-bounds numerical values. */
export function validatePhysics(raw: unknown, where = 'Universe physics'): UniversePhysicsConfig | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${where} must be an object`);
  const p = raw as Record<string, unknown>;
  for (const key of Object.keys(p)) {
    if (!ALLOWED_PHYSICS_KEYS.has(key)) {
      throw new Error(`${where}: unknown setting "${key}"`);
    }
  }
  if (p.mode !== undefined) {
    if (p.mode !== 'rails' && p.mode !== 'nbody' && p.mode !== 'full-body') {
      throw new Error(`${where}: mode must be 'rails', 'nbody' or 'full-body'`);
    }
  }
  if (p.substeps !== undefined) {
    if (typeof p.substeps !== 'number' || !Number.isInteger(p.substeps) || p.substeps < 1 || p.substeps > 64) {
      throw new Error(`${where}: substeps must be an integer from 1 to 64`);
    }
  }
  if (p.softeningRatio !== undefined) {
    if (typeof p.softeningRatio !== 'number' || !Number.isFinite(p.softeningRatio) || p.softeningRatio < 0) {
      throw new Error(`${where}: softeningRatio must be a non-negative finite number`);
    }
  }
  if (p.enableJ2 !== undefined && typeof p.enableJ2 !== 'boolean') {
    throw new Error(`${where}: enableJ2 must be boolean`);
  }
  if (p.enableTidalTorque !== undefined && typeof p.enableTidalTorque !== 'boolean') {
    throw new Error(`${where}: enableTidalTorque must be boolean`);
  }
  if (p.collisionMode !== undefined) {
    if (p.collisionMode !== 'merge' && p.collisionMode !== 'bounce' && p.collisionMode !== 'none') {
      throw new Error(`${where}: collisionMode must be 'merge', 'bounce' or 'none'`);
    }
  }
  if (p.restitution !== undefined) {
    if (typeof p.restitution !== 'number' || !Number.isFinite(p.restitution) || p.restitution < 0 || p.restitution > 1) {
      throw new Error(`${where}: restitution must be a number from 0 to 1`);
    }
  }
  if (p.maxWarp !== undefined) {
    if (typeof p.maxWarp !== 'number' || !Number.isFinite(p.maxWarp) || p.maxWarp < 1 || p.maxWarp > 100_000) {
      throw new Error(`${where}: maxWarp must be a finite number from 1 to 100000`);
    }
  }
  const validated: UniversePhysicsConfig = Object.freeze({
    ...(p.mode !== undefined ? { mode: p.mode as PhysicsMode } : {}),
    ...(p.substeps !== undefined ? { substeps: p.substeps as number } : {}),
    ...(p.softeningRatio !== undefined ? { softeningRatio: p.softeningRatio as number } : {}),
    ...(p.enableJ2 !== undefined ? { enableJ2: p.enableJ2 as boolean } : {}),
    ...(p.enableTidalTorque !== undefined ? { enableTidalTorque: p.enableTidalTorque as boolean } : {}),
    ...(p.collisionMode !== undefined ? { collisionMode: p.collisionMode as CollisionMode } : {}),
    ...(p.restitution !== undefined ? { restitution: p.restitution as number } : {}),
    ...(p.maxWarp !== undefined ? { maxWarp: p.maxWarp as number } : {}),
  });
  return Object.keys(validated).length > 0 ? validated : undefined;
}

/** Validate and normalize a universe definition */
export function validateUniverse(raw: unknown): UniverseDefinition {
  if (!raw || typeof raw !== 'object') throw new Error('Universe data must be a JSON object');
  const u = raw as Record<string, unknown>;

  // If a single system format is provided, wrap it into a Universe container
  if (!Array.isArray(u.systems) && Array.isArray(u.bodies) && typeof u.id === 'string') {
    return validateUniverse({
      schemaVersion: 1,
      id: `${u.id}-universe`,
      name: `${u.name ?? u.id} Universe`,
      description: u.description ?? 'Wrapped single system universe',
      defaultSystemId: u.id,
      systems: [u],
      ...(u.physics !== undefined ? { physics: u.physics } : {}),
    });
  }

  if (u.schemaVersion !== 1) {
    throw new Error(`Unsupported universe schemaVersion: ${u.schemaVersion}. Expected 1.`);
  }
  if (typeof u.id !== 'string' || !u.id.trim()) throw new Error('Universe missing valid id');
  if (typeof u.name !== 'string' || !u.name.trim()) throw new Error('Universe missing valid name');
  if (typeof u.defaultSystemId !== 'string' || !u.defaultSystemId.trim()) {
    throw new Error('Universe missing valid defaultSystemId');
  }
  if (!Array.isArray(u.systems) || u.systems.length === 0) {
    throw new Error('Universe must contain at least one system');
  }

  const systemIds = new Set<string>();
  const validatedSystems: SystemDefinition[] = [];
  let totalSurfaceSamples = 0;
  let totalSurfaceFeatures = 0;

  for (const rawSys of u.systems) {
    if (!rawSys || typeof rawSys !== 'object') throw new Error('System must be an object');
    const sys = rawSys as Record<string, unknown>;
    if (typeof sys.id !== 'string' || !sys.id.trim()) throw new Error('System missing valid id');
    if (systemIds.has(sys.id)) throw new Error(`Duplicate system id: ${sys.id}`);
    systemIds.add(sys.id);
    if (typeof sys.name !== 'string' || !sys.name.trim()) throw new Error(`System ${sys.id} missing name`);
    if (!Array.isArray(sys.bodies) || sys.bodies.length === 0) {
      throw new Error(`System ${sys.id} must have at least one body`);
    }

    const bodyIds = new Set<string>();
    const bodies: CelestialBodyDefinition[] = [];
    for (const rawBody of sys.bodies) {
      if (!rawBody || typeof rawBody !== 'object') throw new Error('Body must be an object');
      const b = rawBody as Record<string, unknown>;
      if (typeof b.id !== 'string' || !b.id.trim()) throw new Error('Body missing valid id');
      if (bodyIds.has(b.id)) throw new Error(`Duplicate body id ${b.id} in system ${sys.id}`);
      bodyIds.add(b.id);
      const radius = Number(b.radius ?? b.radiusMetres);
      if (!Number.isFinite(radius) || radius <= 0) {
        throw new Error(`Body ${b.id} must have radius > 0`);
      }
      let mass = Number(b.mass);
      let mu = Number(b.mu);
      if (!Number.isFinite(mu) || mu <= 0) {
        if (Number.isFinite(mass) && mass > 0) {
          mu = mass * GRAVITATIONAL_CONSTANT;
        } else {
          throw new Error(`Body ${b.id} must specify positive mass or mu`);
        }
      }
      if (!Number.isFinite(mass) || mass <= 0) {
        mass = mu / GRAVITATIONAL_CONSTANT;
      }
      if (b.color !== undefined && typeof b.color !== 'string') {
        throw new Error(`Body ${b.id} color must be a string`);
      }
      if (b.accentColor !== undefined && typeof b.accentColor !== 'string') {
        throw new Error(`Body ${b.id} accentColor must be a string`);
      }
      if (b.atmosphereColor !== undefined && typeof b.atmosphereColor !== 'string') {
        throw new Error(`Body ${b.id} atmosphereColor must be a string`);
      }
      if (b.horizonColor !== undefined && typeof b.horizonColor !== 'string') {
        throw new Error(`Body ${b.id} horizonColor must be a string`);
      }
      if (b.skyColor !== undefined && typeof b.skyColor !== 'string') {
        throw new Error(`Body ${b.id} skyColor must be a string`);
      }
      if (b.surfaceFeatures !== undefined && !['globe-lines', 'craters', 'smooth', 'star'].includes(b.surfaceFeatures as string)) {
        throw new Error(`Body ${b.id} surfaceFeatures must be globe-lines, craters, smooth or star`);
      }
      const rotation = b.rotation === undefined ? undefined : validateRotation(b.rotation, radius, mu, `Body ${b.id} rotation`);
      const appearance = b.appearance === undefined ? undefined : validateAppearance(b.appearance, `Body ${b.id} appearance`);
      let surface: SurfaceDefinition | undefined;
      if (b.surface !== undefined) {
        if (bodySurfaceFeatures({ id: b.id, name: typeof b.name === 'string' ? b.name : b.id,
          parentId: typeof b.parentId === 'string' ? b.parentId : null,
          surfaceFeatures: b.surfaceFeatures as CelestialBodyDefinition['surfaceFeatures'] }) === 'star') {
          throw new Error(`Body ${b.id} surface: terrain settings are not supported on stars`);
        }
        surface = validateSurfaceDefinition(b.surface, radius, `Body ${b.id} surface`);
        totalSurfaceSamples += surface.sampleCount;
        totalSurfaceFeatures += surface.mountainRangeCount + surface.craterCount + (surface.pads?.length ?? 0);
        if (totalSurfaceSamples > SURFACE_LIMITS.maxUniverseSamples || totalSurfaceFeatures > SURFACE_LIMITS.maxUniverseFeatures) {
          throw new Error(`Universe surface budget exceeded: at most ${SURFACE_LIMITS.maxUniverseSamples} samples and ${SURFACE_LIMITS.maxUniverseFeatures} features`);
        }
      }
      bodies.push({
        ...b,
        ...(surface ? { surface } : {}),
        id: b.id,
        name: typeof b.name === 'string' ? b.name : b.id,
        parentId: typeof b.parentId === 'string' ? b.parentId : null,
        radius,
        radiusMetres: radius,
        mass,
        mu,
        ...(rotation ? { rotation } : {}),
        ...(appearance ? { appearance } : {}),
      } as CelestialBodyDefinition);
    }

    // Check parent hierarchy: no cycles, parents must exist
    for (const b of bodies) {
      if (b.parentId) {
        if (!bodyIds.has(b.parentId)) {
          throw new Error(`Body ${b.id} references non-existent parentId: ${b.parentId}`);
        }
        if (b.parentId === b.id) throw new Error(`Body ${b.id} cannot be its own parent`);
        let current: string | null = b.parentId;
        const visited = new Set<string>([b.id]);
        while (current) {
          if (visited.has(current)) {
            throw new Error(`Circular parent hierarchy detected involving body ${b.id}`);
          }
          visited.add(current);
          const parentBody = bodies.find(p => p.id === current);
          current = parentBody?.parentId ?? null;
        }
      }
    }

    // Presets
    if (!Array.isArray(sys.presets) || sys.presets.length === 0) {
      throw new Error(`System ${sys.id} must contain at least one preset`);
    }
    const presetIds = new Set<string>();
    const presets: PresetDefinition[] = [];
    for (const rawPreset of sys.presets) {
      if (!rawPreset || typeof rawPreset !== 'object') throw new Error('Preset must be an object');
      const p = rawPreset as Record<string, unknown>;
      if (typeof p.id !== 'string' || !p.id.trim()) throw new Error('Preset missing valid id');
      if (presetIds.has(p.id)) throw new Error(`Duplicate preset id ${p.id} in system ${sys.id}`);
      presetIds.add(p.id);
      if (typeof p.bodyId !== 'string' || !bodyIds.has(p.bodyId)) {
        throw new Error(`Preset ${p.id} references invalid bodyId: ${p.bodyId}`);
      }
      presets.push(p as unknown as PresetDefinition);
    }

    if (sys.vehicleDefaults && typeof sys.vehicleDefaults === 'object') {
      const handling = sys.vehicleDefaults as Record<string, unknown>;
      for (const [key, min, max] of [['contactRadiusMetres', 0, 32]] as const) {
        const value = handling[key];
        if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)) throw new Error(`Invalid ${key}`);
      }
    }

    validatedSystems.push({
      id: sys.id,
      name: sys.name,
      description: typeof sys.description === 'string' ? sys.description : undefined,
      centralBodyId: typeof sys.centralBodyId === 'string' ? sys.centralBodyId : undefined,
      bodies,
      vehicleDefaults: sys.vehicleDefaults as Partial<VehicleDefaults> | undefined,
      presets,
    });
  }

  if (!systemIds.has(u.defaultSystemId)) {
    throw new Error(`defaultSystemId "${u.defaultSystemId}" not found in universe systems`);
  }

  const physics = u.physics === undefined ? undefined : validatePhysics(u.physics, 'Universe physics');

  return {
    schemaVersion: 1,
    id: u.id,
    name: u.name,
    description: typeof u.description === 'string' ? u.description : undefined,
    author: typeof u.author === 'string' ? u.author : undefined,
    defaultSystemId: u.defaultSystemId,
    systems: validatedSystems,
    ...(physics ? { physics } : {}),
  };
}

/** Resolves and loads one system from a universe definition. Only one system is loaded at a time. */
export function loadSystem(universe: UniverseDefinition, systemId?: string, surfaces?: import('../../game-api/src/index').SurfaceProvider): LoadedSystem {
  const query = surfaces?.query ?? querySurface;
  const supportAt = surfaces?.support ?? surfaceSupport;
  const validateSurface = surfaces?.validate ?? validateMotionSurface;
  const targetId = systemId ?? universe.defaultSystemId;
  const foundSystem = universe.systems.find(s => s.id === targetId);
  if (!foundSystem) {
    throw new Error(`System "${targetId}" not found in universe "${universe.id}"`);
  }
  const system: SystemDefinition = foundSystem;

  const bodiesMap = new Map<string, ResolvedBody>();
  const moonsMap = new Map<string, ResolvedBody[]>();

  // Determine root/central body
  let rootDef = system.centralBodyId ? system.bodies.find(b => b.id === system.centralBodyId) : undefined;
  if (!rootDef) {
    rootDef = system.bodies.find(b => b.parentId === null) ?? system.bodies[0]!;
  }

  // Pre-calculate body values and resolve SOI
  for (const b of system.bodies) {
    const parentDef = b.parentId ? system.bodies.find(p => p.id === b.parentId) : null;
    const radius = b.radius ?? b.radiusMetres ?? 512;
    const mu = b.mu ?? (b.mass ? b.mass * GRAVITATIONAL_CONSTANT : 13107200);
    const mass = b.mass ?? mu / GRAVITATIONAL_CONSTANT;
    const surfaceFeatures = bodySurfaceFeatures(b);
    // Also detach/validate typed callers' settings, not just JSON imports.
    const surface = b.surface === undefined ? undefined : validateSurfaceDefinition(b.surface, radius, `Body ${b.id} surface`);
    if (surface && surfaceFeatures === 'star') throw new Error(`Body ${b.id} surface: terrain settings are not supported on stars`);

    // Typed callers skip validateUniverse, so check spin here too.
    const spin = b.rotation === undefined ? undefined : validateRotation(b.rotation, radius, mu, `Body ${b.id} rotation`);
    const rotation = spin && Object.freeze({ period: spin.period, direction: spin.direction === 1 ? 1 : -1,
      phase: spin.phaseRadiansAtEpoch ?? 0 } as const);

    // Ephemeris
    let ephemeris: Ephemeris = b.ephemeris ?? { kind: 'fixed-inertial', position: [0, 0], velocity: [0, 0] };
    if (!b.parentId && ephemeris.kind !== 'fixed-inertial') {
      ephemeris = { kind: 'fixed-inertial', position: [0, 0], velocity: [0, 0] };
    }

    // Orbit radius if circular
    const orbitRadius = ephemeris.kind === 'circular-kepler'
      ? (ephemeris.radius ?? ephemeris.radiusMetres ?? 10000)
      : undefined;

    // SOI: compute Laplace SOI if child of another body and not explicitly set
    let soiRadius = b.soi?.radius;
    if (!soiRadius) {
      if (parentDef && orbitRadius) {
        soiRadius = calculateLaplaceSOI(orbitRadius, mass, parentDef.mass ?? (parentDef.mu ? parentDef.mu / GRAVITATIONAL_CONSTANT : 1));
        // Small moons (Phobos, Pan, most irregulars) have a Laplace sphere inside their own
        // surface: a ship would fly through the moon in the parent frame and then enter the
        // moon's frame underground. Keep a computed sphere clear of the surface.
        if (soiRadius > 0) soiRadius = Math.max(soiRadius, radius * MIN_SOI_RADII);
      } else {
        soiRadius = Infinity;
      }
    }
    const entryMetres = b.soi?.entryMetres ?? (soiRadius === Infinity ? Infinity : soiRadius * 0.97);
    const exitMetres = b.soi?.exitMetres ?? (soiRadius === Infinity ? Infinity : soiRadius);

    const resolved: ResolvedBody = Object.freeze({
      id: b.id,
      name: b.name,
      parentId: b.parentId ?? null,
      radius,
      mass,
      mu,
      ...(surface ? { surface } : {}),
      surfaceIdentity: surfaceIdentity({ radius, surface }),
      soi: Object.freeze({
        radius: soiRadius,
        entryMetres,
        exitMetres,
      }),
      color: b.color ?? '#233c47',
      accentColor: b.accentColor ?? '#659497',
      atmosphereColor: b.atmosphereColor ?? b.skyColor,
      horizonColor: b.horizonColor,
      skyColor: b.skyColor ?? b.atmosphereColor,
      surfaceFeatures,
      ephemeris,
      ...(rotation ? { rotation } : {}),
      appearance: resolveAppearance(b, surfaceFeatures, b.color ?? '#233c47', b.accentColor ?? '#659497'),
    });

    bodiesMap.set(b.id, resolved);
  }

  interface BodyKinematics {
    readonly body: ResolvedBody;
    readonly parentId: string | null;
    readonly fixedState?: { readonly position: Vec; readonly velocity: Vec };
    readonly orbitRadius?: number;
    readonly dirOmega?: number;
    readonly speed?: number;
    readonly theta0?: number;
    readonly entryMetresSq: number;
    readonly exitMetresSq: number;
  }

  const kinematicsMap = new Map<string, BodyKinematics>();

  // Populate moons map and precompute per-body kinematics
  for (const resolved of bodiesMap.values()) {
    if (resolved.parentId) {
      const list = moonsMap.get(resolved.parentId) ?? [];
      list.push(resolved);
      moonsMap.set(resolved.parentId, list);
    }

    const entryMetresSq = resolved.soi.entryMetres === Infinity
      ? Infinity
      : resolved.soi.entryMetres <= 0 ? 0 : resolved.soi.entryMetres * resolved.soi.entryMetres;
    const exitMetresSq = resolved.soi.exitMetres === Infinity
      ? Infinity
      : resolved.soi.exitMetres * resolved.soi.exitMetres;

    if (resolved.ephemeris.kind === 'fixed-inertial' || !resolved.parentId) {
      const pos: Vec = resolved.ephemeris.kind === 'fixed-inertial' && resolved.ephemeris.position
        ? Object.freeze({ x: resolved.ephemeris.position[0], y: resolved.ephemeris.position[1] })
        : Object.freeze({ x: 0, y: 0 });
      const vel: Vec = resolved.ephemeris.kind === 'fixed-inertial' && resolved.ephemeris.velocity
        ? Object.freeze({ x: resolved.ephemeris.velocity[0], y: resolved.ephemeris.velocity[1] })
        : Object.freeze({ x: 0, y: 0 });
      kinematicsMap.set(resolved.id, {
        body: resolved,
        parentId: null,
        fixedState: Object.freeze({ position: pos, velocity: vel }),
        entryMetresSq,
        exitMetresSq,
      });
    } else if (resolved.ephemeris.kind === 'circular-kepler') {
      const parent = bodiesMap.get(resolved.parentId)!;
      const a = resolved.ephemeris.radius ?? resolved.ephemeris.radiusMetres ?? 10000;
      const omega = Math.sqrt(parent.mu / (a * a * a));
      const dir = resolved.ephemeris.direction ?? -1;
      const theta0 = resolved.ephemeris.phaseRadiansAtEpoch ?? 0;
      kinematicsMap.set(resolved.id, {
        body: resolved,
        parentId: parent.id,
        orbitRadius: a,
        dirOmega: dir * omega,
        speed: dir * a * omega,
        theta0,
        entryMetresSq,
        exitMetresSq,
      });
    } else {
      kinematicsMap.set(resolved.id, {
        body: resolved,
        parentId: resolved.parentId,
        entryMetresSq,
        exitMetresSq,
      });
    }
  }

  /** Children of each body that a ship can enter, sorted by circular orbit radius. */
  interface MoonIndex {
    readonly radii: Float64Array;
    readonly entries: Float64Array;
    readonly moons: readonly ResolvedBody[];
    /** Position in the parent's moon list: the earliest listed moon wins a tie. */
    readonly order: Int32Array;
    readonly maxEntry: number;
    /** Children without a circular orbit about the parent; always tested exactly. */
    readonly others: readonly { readonly moon: ResolvedBody; readonly order: number; readonly entryMetresSq: number }[];
  }
  const moonIndex = new Map<string, MoonIndex>();
  for (const [parentId, list] of moonsMap) {
    const circular: { moon: ResolvedBody; order: number; radius: number; entry: number }[] = [];
    const others: { moon: ResolvedBody; order: number; entryMetresSq: number }[] = [];
    list.forEach((moon, order) => {
      const kin = kinematicsMap.get(moon.id)!;
      if (kin.entryMetresSq <= 0 || kin.entryMetresSq === Infinity) return;
      if (kin.orbitRadius !== undefined && kin.parentId === parentId) {
        circular.push({ moon, order, radius: Math.abs(kin.orbitRadius), entry: Math.sqrt(kin.entryMetresSq) });
      } else others.push({ moon, order, entryMetresSq: kin.entryMetresSq });
    });
    if (!circular.length && !others.length) continue;
    circular.sort((a, b) => a.radius - b.radius || a.order - b.order);
    moonIndex.set(parentId, {
      radii: Float64Array.from(circular, c => c.radius),
      entries: Float64Array.from(circular, c => c.entry),
      moons: circular.map(c => c.moon),
      order: Int32Array.from(circular, c => c.order),
      maxEntry: circular.reduce((max, c) => Math.max(max, c.entry), 0),
      others,
    });
  }

  const initialBodiesMap = new Map(bodiesMap);
  const allBodies: readonly ResolvedBody[] = Object.freeze([...bodiesMap.values()]);
  const emptyBodies: readonly ResolvedBody[] = Object.freeze([]);
  for (const [parentId, list] of moonsMap.entries()) {
    moonsMap.set(parentId, Object.freeze(list) as unknown as ResolvedBody[]);
  }

  const rootBody = bodiesMap.get(rootDef.id)!;

  const vehicleDefaults: VehicleDefaults = Object.freeze({
    acceleration: system.vehicleDefaults?.acceleration ?? 125,
    turnRate: system.vehicleDefaults?.turnRate ?? 1.227184630308513,
    initialThrottle: system.vehicleDefaults?.initialThrottle ?? 0.5,
    ...(system.vehicleDefaults?.contactRadiusMetres === undefined ? {} : { contactRadiusMetres: system.vehicleDefaults.contactRadiusMetres }),
  });

  let cachedStateTime = NaN;
  const stateAtTimeCache = new Map<string, { position: Vec; velocity: Vec }>();
  let hasDynamicStates = false;
  const dynamicStates = new Map<string, { position: Vec; velocity: Vec }>();
  const removedBodies = new Set<string>();

  function setDynamicBodyState(
    bodyId: string,
    position: Vec,
    velocity: Vec,
    physical?: {
      readonly mass: number;
      readonly mu: number;
      readonly radius: number;
      readonly spinPeriod?: number;
      readonly spinDirection?: number;
    },
  ): void {
    hasDynamicStates = true;
    dynamicStates.set(bodyId, { position, velocity });
    cachedStateTime = NaN;
    stateAtTimeCache.clear();
    if (physical) {
      const existing = bodiesMap.get(bodyId);
      if (
        existing &&
        (existing.mass !== physical.mass ||
          existing.mu !== physical.mu ||
          existing.radius !== physical.radius ||
          (physical.spinPeriod !== undefined && existing.rotation && existing.rotation.period !== physical.spinPeriod))
      ) {
        bodiesMap.set(
          bodyId,
          Object.freeze({
            ...existing,
            mass: physical.mass,
            mu: physical.mu,
            radius: physical.radius,
            ...(existing.rotation && physical.spinPeriod !== undefined
              ? {
                  rotation: Object.freeze({
                    ...existing.rotation,
                    period: physical.spinPeriod,
                    ...(physical.spinDirection !== undefined
                      ? { direction: physical.spinDirection === 1 ? 1 : -1 }
                      : {}),
                  }),
                }
              : {}),
          }),
        );
      }
    }
  }

  function removeDynamicBody(bodyId: string): void {
    removedBodies.add(bodyId);
    dynamicStates.delete(bodyId);
    cachedStateTime = NaN;
    stateAtTimeCache.clear();
  }

  function clearDynamicBodies(): void {
    hasDynamicStates = false;
    dynamicStates.clear();
    removedBodies.clear();
    cachedStateTime = NaN;
    stateAtTimeCache.clear();
    for (const [id, b] of initialBodiesMap) {
      bodiesMap.set(id, b);
    }
  }

  // Calculate body absolute position and velocity relative to central body at time t
  function getBodyStateAt(bodyId: string, time: number): { position: Vec; velocity: Vec } {
    if (hasDynamicStates) {
      const dyn = dynamicStates.get(bodyId);
      if (dyn) return dyn;
    }

    const kin = kinematicsMap.get(bodyId);
    if (!kin) throw new Error(`Unknown body: ${bodyId}`);

    if (kin.fixedState) {
      return kin.fixedState;
    }

    if (time !== cachedStateTime) {
      cachedStateTime = time;
      stateAtTimeCache.clear();
    } else {
      const cached = stateAtTimeCache.get(bodyId);
      if (cached) return cached;
    }

    const parentState = getBodyStateAt(kin.parentId!, time);

    if (kin.orbitRadius !== undefined && kin.dirOmega !== undefined && kin.speed !== undefined && kin.theta0 !== undefined) {
      const theta = kin.theta0 + kin.dirOmega * time;
      const cos = dm.cos(theta);
      const sin = dm.sin(theta);
      const relX = kin.orbitRadius * cos;
      const relY = kin.orbitRadius * sin;
      const relVx = -kin.speed * sin;
      const relVy = kin.speed * cos;

      const computed = {
        position: { x: parentState.position.x + relX, y: parentState.position.y + relY },
        velocity: { x: parentState.velocity.x + relVx, y: parentState.velocity.y + relVy },
      };
      stateAtTimeCache.set(bodyId, computed);
      return computed;
    }

    stateAtTimeCache.set(bodyId, parentState);
    return parentState;
  }

  function getBodyPosition(bodyId: string, time: number): Vec {
    return getBodyStateAt(bodyId, time).position;
  }

  function getBodyVelocity(bodyId: string, time: number): Vec {
    return getBodyStateAt(bodyId, time).velocity;
  }

  function initialState(presetId?: string, surface?: SurfaceProfile): { state: State; body: ResolvedBody } {
    const p = (presetId ? system.presets.find(p => p.id === presetId) : null) ?? system.presets[0]!;
    const body = bodiesMap.get(p.bodyId) ?? rootBody;

    let position: Vec;
    let velocity: Vec;
    let heading = p.headingRadians ?? (p.kind === 'landed' ? Math.PI / 2 : 0);
    const fail = (reason: string): never => { throw new Error(`Preset ${p.id}: ${reason}`); };
    if (surface) validateSurface(body, surface);

    if (p.kind === 'state') {
      if (!p.position || !p.velocity) return fail('state requires position and velocity');
      position = { x: p.position[0], y: p.position[1] };
      velocity = { x: p.velocity[0], y: p.velocity[1] };
    } else if (p.kind === 'circular-orbit') {
      const r = p.radius ?? p.radiusMetres ?? (p.altitude !== undefined ? body.radius + p.altitude : body.radius * 1.25);
      const phase = p.phaseRadians ?? Math.PI / 2, dir = p.direction ?? -1;
      position = { x: r * dm.cos(phase), y: r * dm.sin(phase) };
      velocity = { x: -dir * Math.sqrt(body.mu / r) * dm.sin(phase), y: dir * Math.sqrt(body.mu / r) * dm.cos(phase) };
    } else if (p.kind !== 'landed') {
      return fail('unsupported kind');
    } else {
      position = p.position ? { x: p.position[0], y: p.position[1] } : { x: 0, y: body.radius };
      velocity = p.velocity ? { x: p.velocity[0], y: p.velocity[1] } : { x: 0, y: 0 };
      if (surface) {
        if (dm.hypot(velocity.x, velocity.y) !== 0) fail('landed terrain starts require zero velocity');
        if (p.position && !(dm.hypot(position.x, position.y) > 0)) fail('landed position has no radial direction');
        // Explicit positions retain their angle; legacy north starts prefer the
        // first authored pad. Relocate radially in either direction onto ground.
        const angle = p.position ? dm.atan2(position.y, position.x)
          : p.phaseRadians ?? surface.pads[0]?.angleRadians ?? Math.PI / 2;
        const support = supportAt(surface, angle);
        if (support.surface.material === 'water') fail('ordinary landed starts must be on dry ground');
        const normal = support.normals.reduce((sum, n) => ({ x: sum.x + n.x, y: sum.y + n.y }), { x: 0, y: 0 });
        heading = p.headingRadians ?? dm.atan2(normal.y, normal.x);
        if (!safeSurfaceLanding(support, heading, 0)) fail('landed terrain start needs safe slope and normal alignment');
        position = { x: support.surface.groundRadius * dm.cos(angle), y: support.surface.groundRadius * dm.sin(angle) };
      }
    }

    if (![position.x, position.y, velocity.x, velocity.y, heading].every(Number.isFinite)) fail('nonfinite state');
    if (surface && p.kind !== 'landed') {
      const r = dm.hypot(position.x, position.y);
      const ground = query(surface, dm.atan2(position.y, position.x)).groundRadius;
      if (r < ground - surfaceContactTolerance(surface)) fail('flying start is inside terrain');
    }

    return {
      state: {
        time: 0,
        position,
        velocity,
        heading,
        throttle: vehicleDefaults.initialThrottle,
        status: p.kind === 'landed' ? 'landed' : 'flying',
        revision: 0,
      },
      body,
    };
  }

  /** Checks for patched-conic SOI transitions. Local coordinates are converted across frame changes. */
  function checkSOI(
    state: State,
    currentBodyId: string,
    time: number
  ): { switched: boolean; newBody: ResolvedBody; newState: State } {
    const currentKin = kinematicsMap.get(currentBodyId) ?? kinematicsMap.get(rootBody.id)!;
    const currentBody = bodiesMap.get(currentKin.body.id) ?? currentKin.body;

    // Check if exiting current body SOI to parent
    if (currentBody.parentId && currentKin.exitMetresSq < Infinity) {
      const distSq = state.position.x * state.position.x + state.position.y * state.position.y;
      if (distSq >= currentKin.exitMetresSq) {
        const parent = bodiesMap.get(currentBody.parentId)!;
        const currentBodyState = getBodyStateAt(currentBody.id, time);
        const parentState = getBodyStateAt(parent.id, time);

        // Convert state from currentBody frame to parent frame
        const nextPos: Vec = {
          x: state.position.x + (currentBodyState.position.x - parentState.position.x),
          y: state.position.y + (currentBodyState.position.y - parentState.position.y),
        };
        const nextVel: Vec = {
          x: state.velocity.x + (currentBodyState.velocity.x - parentState.velocity.x),
          y: state.velocity.y + (currentBodyState.velocity.y - parentState.velocity.y),
        };

        return {
          switched: true,
          newBody: parent,
          newState: {
            ...state,
            position: nextPos,
            velocity: nextVel,
            coast: undefined,
            contact: undefined,
            waterEntry: undefined,
            water: undefined,
            revision: state.revision + 1,
          },
        };
      }
    }

    // Check if entering any child moon SOI
    const index = moonIndex.get(currentBody.id);
    if (index) {
      // Only moons whose orbit radius lies within their entry radius of the ship's radius
      // can contain it (triangle inequality), so a planet with hundreds of moons costs a
      // binary search plus a few candidates. The first moon in list order still wins.
      const r = dm.hypot(state.position.x, state.position.y);
      let currentBodyState: { position: Vec; velocity: Vec } | undefined;
      let best: ResolvedBody | undefined, bestOrder = Infinity, bestX = 0, bestY = 0;
      let bestState: { position: Vec; velocity: Vec } | undefined;
      const consider = (moon: ResolvedBody, order: number, entryMetresSq: number): void => {
        if (order >= bestOrder || removedBodies.has(moon.id)) return;
        currentBodyState ??= getBodyStateAt(currentBody.id, time);
        const moonState = getBodyStateAt(moon.id, time);
        const deltaX = state.position.x - (moonState.position.x - currentBodyState.position.x);
        const deltaY = state.position.y - (moonState.position.y - currentBodyState.position.y);
        if (deltaX * deltaX + deltaY * deltaY <= entryMetresSq) {
          best = bodiesMap.get(moon.id) ?? moon; bestOrder = order; bestX = deltaX; bestY = deltaY; bestState = moonState;
        }
      };
      const { radii, moons, order, entries, maxEntry } = index;
      if (hasDynamicStates) {
        for (let i = 0; i < moons.length; i++) {
          const entry = entries[i]!;
          consider(moons[i]!, order[i]!, entry * entry);
        }
      } else {
        let lo = 0, hi = radii.length;
        const from = r - maxEntry;
        while (lo < hi) { const mid = (lo + hi) >> 1; if (radii[mid]! < from) lo = mid + 1; else hi = mid; }
        for (let i = lo; i < radii.length && radii[i]! <= r + maxEntry; i++) {
          const entry = entries[i]!;
          // Slack covers rounding in the absolute body positions the exact test subtracts.
          if (Math.abs(r - radii[i]!) > entry + 1 + radii[i]! * 1e-9) continue;
          consider(moons[i]!, order[i]!, entry * entry);
        }
      }
      for (const other of index.others) consider(other.moon, other.order, other.entryMetresSq);
      if (best && bestState && currentBodyState) {
        const parentState: { position: Vec; velocity: Vec } = currentBodyState;
        const nextVel: Vec = {
          x: state.velocity.x - (bestState.velocity.x - parentState.velocity.x),
          y: state.velocity.y - (bestState.velocity.y - parentState.velocity.y),
        };
        return {
          switched: true,
          newBody: best,
          newState: {
            ...state,
            position: { x: bestX, y: bestY },
            velocity: nextVel,
            coast: undefined,
            contact: undefined,
            waterEntry: undefined,
            water: undefined,
            revision: state.revision + 1,
          },
        };
      }
    }

    return { switched: false, newBody: currentBody, newState: state };
  }

  const loaded: HostLoadedSystem = {
    universeId: universe.id,
    universeName: universe.name,
    system,
    rootBody,
    vehicleDefaults,
    presets: system.presets,
    getResolvedBody: id => bodiesMap.get(id) ?? rootBody,
    getAllBodies: () => (hasDynamicStates ? [...bodiesMap.values()].filter(b => !removedBodies.has(b.id)) : allBodies),
    getMoonsOf: parentId => moonsMap.get(parentId) ?? emptyBodies,
    getBodyPosition,
    getBodyVelocity,
    initialState,
    checkSOI,
    setDynamicBodyState,
    removeDynamicBody,
    clearDynamicBodies,
  };
  return loaded;
}

/** Host-internal extension of `LoadedSystem` supporting dynamic celestial body coordinate and physical parameter updates. */
export interface HostLoadedSystem extends LoadedSystem {
  setDynamicBodyState?(
    bodyId: string,
    position: Vec,
    velocity: Vec,
    physical?: {
      readonly mass: number;
      readonly mu: number;
      readonly radius: number;
      readonly spinPeriod?: number;
      readonly spinDirection?: number;
    },
  ): void;
  removeDynamicBody?(bodyId: string): void;
  clearDynamicBodies?(): void;
}

/**
 * Resolves the dominant celestial body whose sphere of influence (SOI) contains worldPos at time.
 * If preferredBodyId is supplied and worldPos lies within its SOI (and not within any child moon's SOI),
 * the preferred body is maintained for smooth reference-frame stability.
 */
export function findDominantBodyForWorldPos(
  system: LoadedSystem,
  worldPos: Vec,
  time: number,
  preferredBodyId?: string,
): { body: ResolvedBody; bodyPos: Vec; relPos: Vec; dist: number } {
  if (preferredBodyId) {
    try {
      const pref = system.getResolvedBody(preferredBodyId);
      if (pref) {
        const prefPos = system.getBodyPosition(pref.id, time);
        const dx = worldPos.x - prefPos.x;
        const dy = worldPos.y - prefPos.y;
        const dist = Math.hypot(dx, dy);
        const exitLimit = pref.soi.exitMetres;

        // Check if inside any child moon of preferredBody
        let insideChildMoon = false;
        const moons = system.getMoonsOf(pref.id);
        for (const moon of moons) {
          const mPos = system.getBodyPosition(moon.id, time);
          const mDist = Math.hypot(worldPos.x - mPos.x, worldPos.y - mPos.y);
          if (mDist <= moon.soi.entryMetres) {
            insideChildMoon = true;
            break;
          }
        }

        if (!insideChildMoon && (!pref.parentId || dist < exitLimit)) {
          return { body: pref, bodyPos: prefPos, relPos: { x: dx, y: dy }, dist };
        }
      }
    } catch {
      // Fallback to full tree traversal below
    }
  }

  // Hierarchical search from root down through moon trees
  let current: ResolvedBody = system.rootBody;
  let currentPos = system.getBodyPosition(current.id, time);

  let foundChild = true;
  while (foundChild) {
    foundChild = false;
    const children = system.getMoonsOf(current.id);
    for (const child of children) {
      const childPos = system.getBodyPosition(child.id, time);
      const dx = worldPos.x - childPos.x;
      const dy = worldPos.y - childPos.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= child.soi.entryMetres) {
        current = child;
        currentPos = childPos;
        foundChild = true;
        break;
      }
    }
  }

  const relPos = { x: worldPos.x - currentPos.x, y: worldPos.y - currentPos.y };
  const dist = Math.hypot(relPos.x, relPos.y);
  return { body: current, bodyPos: currentPos, relPos, dist };
}

/** Pre-validated and frozen default universe */
export const DEFAULT_UNIVERSE: UniverseDefinition = Object.freeze(
  validateUniverse(defaultUniverseJson)
);
