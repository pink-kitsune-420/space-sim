import type { SurfacePadDefinition } from '../surface';

/** Shared F9 sphere recipe, composed by PlanetSurfaceDefinition for physical v2
 * worlds. The frozen v1 radial generator remains a separate contract. */
export interface PlanetFieldDefinition {
  readonly generatorVersion: 2;
  readonly seed: number;
  readonly recipe: 'rocky' | 'arid' | 'oceanic' | 'icy' | 'volcanic';
  readonly radiusMetres: number;
  readonly maxReliefMetres: number;
  readonly continentWavelengthMetres: number;
  readonly rangeWavelengthMetres: number;
  readonly hillWavelengthMetres: number;
  readonly octaves: number;
  readonly seaRadiusMetres?: number;
  readonly waterCoverage?: number;
  /** Optional equatorial spherical caps with a level radial core. Physical host
   * adapters must resolve their width/shoulder against the profile sample spacing. */
  readonly pads?: readonly SurfacePadDefinition[];
  /** Quintic transition width in metres outside every pad core; required with pads. */
  readonly padShoulderMetres?: number;
}

/** Strict detached immutable definition; finite physical lengths and explicit
 * octave/cell limits keep field work bounded. No water quantile is evaluated here. */
export function validatePlanetField(raw: unknown): Readonly<PlanetFieldDefinition> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Planet field must be an object');
  const v = raw as Record<string, unknown>;
  const keys = ['generatorVersion', 'seed', 'recipe', 'radiusMetres', 'maxReliefMetres', 'continentWavelengthMetres',
    'rangeWavelengthMetres', 'hillWavelengthMetres', 'octaves', 'seaRadiusMetres', 'waterCoverage', 'pads', 'padShoulderMetres'];
  for (const k of Object.keys(v)) if (!keys.includes(k)) throw Error('Unknown planet field setting: ' + k);
  if (v.generatorVersion !== 2) throw Error('Planet field generatorVersion must be 2');
  if (typeof v.recipe !== 'string' || !['rocky', 'arid', 'oceanic', 'icy', 'volcanic'].includes(v.recipe)) throw Error('Invalid planet field recipe');
  const number = (k: string): number => {
    if (typeof v[k] !== 'number' || !Number.isFinite(v[k])) throw Error('Invalid planet field ' + k);
    return v[k] as number;
  };
  const seed = number('seed'), octaves = number('octaves'), radius = number('radiusMetres'), relief = number('maxReliefMetres');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffff_ffff) throw Error('Invalid planet field seed');
  if (!Number.isInteger(octaves) || octaves < 1 || octaves > 8) throw Error('Planet field octaves must be 1..8');
  if (!(radius > 0 && radius <= 1e9 && relief >= 0 && relief < radius)) throw Error('Invalid planet field radius/relief');
  for (const k of ['continentWavelengthMetres', 'rangeWavelengthMetres', 'hillWavelengthMetres']) {
    const wavelength = number(k);
    if (!(wavelength > 0 && wavelength <= radius * 32 && radius / wavelength * 2 ** octaves < 2 ** 28))
      throw Error('Invalid planet field wavelength: ' + k);
  }
  if (v.seaRadiusMetres !== undefined && v.waterCoverage !== undefined) throw Error('Choose sea radius or water coverage');
  if (v.waterCoverage !== undefined && !(number('waterCoverage') >= 0 && number('waterCoverage') <= 1)) throw Error('Invalid water coverage');
  if (v.seaRadiusMetres !== undefined && !(number('seaRadiusMetres') > 0 && number('seaRadiusMetres') <= radius + relief)) throw Error('Invalid sea radius');
  let pads: readonly SurfacePadDefinition[] | undefined;
  if (v.pads !== undefined) {
    if (!Array.isArray(v.pads) || v.pads.length < 1 || v.pads.length > 64) throw Error('Planet pads must contain1..64 caps');
    const shoulder = number('padShoulderMetres');
    if (!(shoulder / radius >= 1e-8 && Number.isFinite(radius / shoulder) && Number.isFinite(2 * relief * radius / shoulder))) throw Error('Invalid planet pad shoulder');
    const ids = new Set<string>();
    pads = Object.freeze(v.pads.map(raw => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('Invalid planet pad');
      const p = raw as Record<string, unknown>;
      if (Object.keys(p).some(k => !['id', 'angleRadians', 'widthMetres', 'elevationMetres'].includes(k))
        || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) || ids.has(p.id)) throw Error('Invalid planet pad identity');
      ids.add(p.id);
      const { angleRadians: angle, widthMetres: width, elevationMetres: elevation } = p;
      if (typeof angle !== 'number' || !Number.isFinite(angle) || angle < 0 || angle >= 2 * Math.PI
        || typeof width !== 'number' || !Number.isFinite(width) || !(width / radius >= 1e-8 && width / 2 + shoulder <= (Math.PI - 1e-8) * radius)
        || typeof elevation !== 'number' || !Number.isFinite(elevation) || Math.abs(elevation) > relief) throw Error('Invalid planet pad dimensions');
      return Object.freeze({ id: p.id, angleRadians: angle, widthMetres: width, elevationMetres: elevation });
    }));
    for (let i = 0; i < pads.length; i++) for (let j = i + 1; j < pads.length; j++) {
      const a = pads[i]!, b = pads[j]!, delta = Math.abs(a.angleRadians - b.angleRadians);
      if (Math.min(delta, 2 * Math.PI - delta) * radius < (a.widthMetres + b.widthMetres) / 2 + 2 * shoulder)
        throw Error('Planet pad caps and shoulders must not overlap');
    }
  } else if (v.padShoulderMetres !== undefined) throw Error('Planet pad shoulder requires pads');
  return Object.freeze({ ...v, ...(pads ? { pads } : {}) }) as unknown as Readonly<PlanetFieldDefinition>;
}
