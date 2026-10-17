import type { Ephemeris, CelestialBodyDefinition, PresetDefinition, VehicleDefaults, SystemDefinition, UniverseDefinition, ResolvedBody, LoadedSystem } from '../../game-api/src/index';
export type { SOI, Ephemeris, CelestialBodyDefinition, PresetDefinition, VehicleDefaults, SystemDefinition, UniverseDefinition, ResolvedBody, LoadedSystem } from '../../game-api/src/index';
import defaultUniverseJson from '../../../games/space-sim/universes/sandbox/default/universe.json';
import type { State, Vec } from '../../game-api/src/index';
import { SURFACE_LIMITS, querySurface, surfaceIdentity, validateSurfaceDefinition, type SurfaceDefinition, type SurfaceProfile } from './surface';
import { surfaceContactTolerance } from './surface-contact';
import { safeSurfaceLanding, surfaceSupport, validateMotionSurface } from './surface-flight';
import * as dm from './dmath';

/** Standard gravitational constant G in m^3 / (kg * s^2) */
export const GRAVITATIONAL_CONSTANT = 6.67430e-11;

/** Smallest computed sphere of influence, in body radii (authored `soi` values are kept). */
export const MIN_SOI_RADII = 1.5;

/** Calculate standard Laplace sphere of influence radius */
export function calculateLaplaceSOI(semiMajorAxis: number, bodyMass: number, parentMass: number): number {
  if (parentMass <= 0 || bodyMass <= 0 || semiMajorAxis <= 0) return 0;
  return semiMajorAxis * dm.twoFifths(bodyMass / parentMass);
}

/** Preserve the existing implicit star/style selection for legacy universes. */
function bodySurfaceFeatures(b: Pick<CelestialBodyDefinition, 'id' | 'name' | 'parentId' | 'surfaceFeatures'>): ResolvedBody['surfaceFeatures'] {
  return b.surfaceFeatures ?? (b.id === 'sun' || b.name.toLowerCase().includes('sun') || b.name.toLowerCase().includes('star')
    ? 'star' : b.parentId === null ? 'globe-lines' : 'craters');
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

  return {
    schemaVersion: 1,
    id: u.id,
    name: u.name,
    description: typeof u.description === 'string' ? u.description : undefined,
    author: typeof u.author === 'string' ? u.author : undefined,
    defaultSystemId: u.defaultSystemId,
    systems: validatedSystems,
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
  });

  let cachedStateTime = NaN;
  const stateAtTimeCache = new Map<string, { position: Vec; velocity: Vec }>();

  // Calculate body absolute position and velocity relative to central body at time t
  function getBodyStateAt(bodyId: string, time: number): { position: Vec; velocity: Vec } {
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
    const currentBody = currentKin.body;

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
        if (order >= bestOrder) return;
        currentBodyState ??= getBodyStateAt(currentBody.id, time);
        const moonState = getBodyStateAt(moon.id, time);
        const deltaX = state.position.x - (moonState.position.x - currentBodyState.position.x);
        const deltaY = state.position.y - (moonState.position.y - currentBodyState.position.y);
        if (deltaX * deltaX + deltaY * deltaY <= entryMetresSq) {
          best = moon; bestOrder = order; bestX = deltaX; bestY = deltaY; bestState = moonState;
        }
      };
      const { radii, moons, order, entries, maxEntry } = index;
      let lo = 0, hi = radii.length;
      const from = r - maxEntry;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (radii[mid]! < from) lo = mid + 1; else hi = mid; }
      for (let i = lo; i < radii.length && radii[i]! <= r + maxEntry; i++) {
        const entry = entries[i]!;
        // Slack covers rounding in the absolute body positions the exact test subtracts.
        if (Math.abs(r - radii[i]!) > entry + 1 + radii[i]! * 1e-9) continue;
        consider(moons[i]!, order[i]!, entry * entry);
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

  return {
    universeId: universe.id,
    universeName: universe.name,
    system,
    rootBody,
    vehicleDefaults,
    presets: system.presets,
    getResolvedBody: id => bodiesMap.get(id) ?? rootBody,
    getAllBodies: () => allBodies,
    getMoonsOf: parentId => moonsMap.get(parentId) ?? emptyBodies,
    getBodyPosition,
    getBodyVelocity,
    initialState,
    checkSOI,
  };
}

/** Pre-validated and frozen default universe */
export const DEFAULT_UNIVERSE: UniverseDefinition = Object.freeze(
  validateUniverse(defaultUniverseJson)
);
