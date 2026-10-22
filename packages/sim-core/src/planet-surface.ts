/** Host adapter for the public reusable F9 field/bake. No independent noise or
 * renderer authority; fixed macro resolution is versioned with surface/2. */
import { createPlanetBake, createPlanetField, validatePlanetField,
  type PlanetFieldDefinition, type PlanetSurfaceDefinition } from '../../game-api/src/index';

const TAU = 2 * Math.PI;
export const PLANET_SURFACE_MAP = Object.freeze({ columns: 512, rows: 256 });

/** A sample margin keeps the advertised pad core level after polar-linear
 * interpolation. It belongs to the fixed physical recipe, never camera LOD. */
export function planetDefinitionForSamples(surface: PlanetSurfaceDefinition): PlanetFieldDefinition {
  const { kind: _kind, sampleCount, orientationRadians: _orientation, ...field } = surface;
  if (!field.pads) return field;
  const margin = TAU * field.radiusMetres / sampleCount;
  return { ...field, pads: field.pads.map(p => ({ ...p, widthMetres: p.widthMetres + 2 * margin })) };
}

export function validatePlanetSurface(raw: unknown, radius: number, context: string): Readonly<PlanetSurfaceDefinition> {
  const fail = (message: string): never => { throw Error(`${context}: ${message}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('planet surface must be an object');
  const s = raw as Record<string, unknown>;
  if (s.kind !== 'planet' || s.generatorVersion !== 2) return fail('planet surface requires kind planet and generatorVersion2');
  const { kind: _kind, sampleCount: count, orientationRadians: orientation, ...rawField } = s;
  const field = validatePlanetField(rawField);
  if (field.radiusMetres !== radius) return fail('planet field radius must match body radius');
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 32 || count > 65536 || (count & (count - 1)) !== 0)
    return fail('planet sampleCount must be a power of two in32..65536');
  if (typeof orientation !== 'number' || !Number.isFinite(orientation) || orientation < 0 || orientation >= TAU)
    return fail('planet orientationRadians must be in[0,2*pi)');
  const spacing = TAU * radius / count;
  const narrowest = Math.min(field.continentWavelengthMetres, field.rangeWavelengthMetres, field.hillWavelengthMetres) / 2 ** (field.octaves - 1);
  if (narrowest < 4 * spacing) return fail('planet wavelengths need at least four profile intervals at the highest octave');
  if (field.pads) {
    if (field.padShoulderMetres! < 4 * spacing || field.pads.some(p => p.widthMetres < 4 * spacing))
      return fail('planet pad cores and shoulders need at least four profile intervals');
    if (field.waterCoverage === 1 || (field.seaRadiusMetres !== undefined && field.pads.some(p => radius + p.elevationMetres <= field.seaRadiusMetres!)))
      return fail('planet pads must be above sea level');
  }
  const result: PlanetSurfaceDefinition = Object.freeze({ kind: 'planet', ...field, sampleCount: count, orientationRadians: orientation });
  validatePlanetField(planetDefinitionForSamples(result));
  return result;
}

export function planetSurfaceIdentity(surface: PlanetSurfaceDefinition): string {
  return JSON.stringify(['space-sim-surface/2', createPlanetField(planetDefinitionForSamples(surface)).identity,
    surface.sampleCount, surface.orientationRadians, PLANET_SURFACE_MAP.columns, PLANET_SURFACE_MAP.rows]);
}

export function bakePlanetSurface(surface: PlanetSurfaceDefinition) {
  const job = createPlanetBake(planetDefinitionForSamples(surface), { columns: PLANET_SURFACE_MAP.columns, rows: PLANET_SURFACE_MAP.rows,
    equatorSamples: surface.sampleCount, orientationRadians: surface.orientationRadians });
  // World creation is synchronous. Work is finite and never repeated per frame;
  // interactive tools use the same public cooperative bake between yields.
  while (job.status === 'pending') job.step(1024);
  const result = job.takeResult();
  if (result.seaRadiusMetres !== undefined && surface.pads?.some(p => surface.radiusMetres + p.elevationMetres <= result.seaRadiusMetres!))
    throw Error('Planet pads must be above the resolved coverage sea level');
  return result;
}
