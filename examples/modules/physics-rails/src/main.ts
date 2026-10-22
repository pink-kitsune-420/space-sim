import {
  BODY_FRAMES,
  MOTION_CONTEXTS,
  ORBITAL_MOTION,
  RAILS_POLICY,
  SURFACE_GEOMETRY,
  type BodyFrameProvider,
  type Elements,
  type ModuleInitializationV2,
  type OrbitalProvider,
  type OrbitalState,
  type RailsProvider,
  type ServiceKey,
  type SimulationContext,
  type SimulationContextFactory,
  type SurfaceProvider,
  type VehicleDefaults,
} from '@space-sim/game-api';

export interface MotionKernelDiagnostics {
  readonly hasContext: boolean;
  readonly orbitalModel: string;
  readonly railsCompatible: boolean;
}

export interface MotionKernelHelper {
  /** For finite ocean/rock contact, pass e.g. { contactRadiusMetres: 2.5 }.
   * The hull centre is the state position; omitting the radius keeps legacy points. */
  createContext(vehicle?: Partial<VehicleDefaults>): SimulationContext;
  computeElements(state: OrbitalState, mu: number): Elements;
  diagnose(): MotionKernelDiagnostics;
}

export const MOTION_KERNEL_HELPER: ServiceKey<MotionKernelHelper> = Object.freeze({
  slot: 'example.physics-rails',
  version: '1.0.0',
});

const DEFAULT_VEHICLE: VehicleDefaults = Object.freeze({
  mass: 1000,
  acceleration: 20,
  turnRate: 3.0,
  initialThrottle: 0,
});

/** SurfaceProvider.generate accepts frozen radial v1 or shared planet v2 definitions.
 * Consume profile.planet as immutable macro data; collision samples stay private. */
export function createMotionKernelHelper(
  motion: SimulationContextFactory,
  orbits: OrbitalProvider,
  bodies: BodyFrameProvider,
  surfaces: SurfaceProvider,
  rails: RailsProvider,
): MotionKernelHelper {
  return Object.freeze({
    createContext(vehicle?: Partial<VehicleDefaults>): SimulationContext {
      const resolved: VehicleDefaults = { ...DEFAULT_VEHICLE, ...vehicle };
      return motion(resolved, { services: { orbits, bodies, surfaces, rails } });
    },
    computeElements(state: OrbitalState, mu: number): Elements {
      return orbits.elements(state, mu);
    },
    diagnose(): MotionKernelDiagnostics {
      return {
        hasContext: typeof motion === 'function',
        orbitalModel: orbits.modelIdentity,
        railsCompatible: rails.compatible.length > 0,
      };
    },
  });
}

export default function initialize(context: ModuleInitializationV2): void {
  const motion = context.use(MOTION_CONTEXTS);
  const orbits = context.use(ORBITAL_MOTION);
  const bodies = context.use(BODY_FRAMES);
  const surfaces = context.use(SURFACE_GEOMETRY);
  const rails = context.use(RAILS_POLICY);

  context.provide(
    MOTION_KERNEL_HELPER,
    createMotionKernelHelper(motion, orbits, bodies, surfaces, rails),
  );
}
