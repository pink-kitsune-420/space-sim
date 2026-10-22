import { validatePlanetField, type PlanetFieldDefinition } from './definition';
import { fractal3, fractalSlopeBound, noise3, NOISE_GRADIENT_BOUND } from './noise';
import * as dm from '../math';

/** Deterministic F9 field. Inputs are body-fixed unit sphere (x,y,z), with z=0
 * the playable equator. Output: elevation metres, dx/dy/dz metres per unit-sphere
 * coordinate, then continent, range, hill, moisture in dimensionless [0,1].
 * Elevation gradients include the complete warp Jacobian and tectonic product.
 * Scratch is per instance (32 bytes), never global or allocated per sample.
 * A field is synchronous; make a separate instance in each worker. */
export function createPlanetField(raw: PlanetFieldDefinition) {
  const definition = validatePlanetField(raw), d = definition;
  const scratch = new Float64Array(4);
  // Fixed recipe weights are versioned with the field, not a second renderer recipe.
  const continents = d.recipe === 'oceanic' ? .72 : d.recipe === 'rocky' ? .35 : .55;
  const ranges = d.recipe === 'rocky' ? .45 : d.recipe === 'icy' ? .15 : .20;
  const hills = 1 - continents - ranges;
  const fc = d.radiusMetres / d.continentWavelengthMetres, fr = d.radiusMetres / d.rangeWavelengthMetres;
  const fh = d.radiusMetres / d.hillWavelengthMetres, warp = .18, wf = 1.7;
  const continentSlope = fractalSlopeBound(fc, d.octaves, 'fbm') * (1 + warp * 3 * wf * NOISE_GRADIENT_BOUND);
  const rangeSlope = fractalSlopeBound(fr, d.octaves, 'ridge') + .5 * continentSlope;
  const hillSlope = fractalSlopeBound(fh, d.octaves, 'billow');
  const pads = new Float64Array((d.pads?.length ?? 0) * 6);
  for (let i = 0; i < (d.pads?.length ?? 0); i++) {
    const p = d.pads![i]!, offset = i * 6, half = p.widthMetres / (2 * d.radiusMetres), shoulder = d.padShoulderMetres! / d.radiusMetres;
    pads[offset] = dm.cos(p.angleRadians); pads[offset + 1] = dm.sin(p.angleRadians);
    pads[offset + 2] = (2 * dm.sin((half + shoulder) / 2)) ** 2; pads[offset + 3] = half;
    pads[offset + 4] = shoulder; pads[offset + 5] = p.elevationMetres;
  }
  const gradientBound = d.maxReliefMetres * (continents * continentSlope + ranges * rangeSlope + hills * hillSlope)
    + (pads.length ? 2 * d.maxReliefMetres * 1.875 * 1.000001 * d.radiusMetres / d.padShoulderMetres! : 0);
  const bounds = Object.freeze({ maxAbsElevationMetres: d.maxReliefMetres,
    maxGradientMetres: gradientBound,
    maxSlope: pads.length ? gradientBound / d.radiusMetres : d.maxReliefMetres / d.radiusMetres * (continents * continentSlope + ranges * rangeSlope + hills * hillSlope) });
  const identity = 'space-sim-planet-field/2:' + JSON.stringify([
    d.seed, d.recipe, d.radiusMetres, d.maxReliefMetres, d.continentWavelengthMetres,
    d.rangeWavelengthMetres, d.hillWavelengthMetres, d.octaves, d.seaRadiusMetres ?? null, d.waterCoverage ?? null,
    ...(d.pads ? [d.padShoulderMetres, d.pads.map(p => [p.id, p.angleRadians, p.widthMetres, p.elevationMetres])] : []),
  ]);
  function evaluate(x: number, y: number, z: number, out: Float64Array): void {
    // Cheap boundary guard, no arrays/closures in the hot query.
    if (out.length < 8 || !Number.isFinite(x + y + z) || Math.abs(x * x + y * y + z * z - 1) > 1e-6)
      throw Error('Planet field requires unit-sphere coordinates and eight Float64 output slots');
    noise3(d.seed ^ 0x157a8123, x * wf, y * wf, z * wf, scratch);
    const wx = x + warp * scratch[0]!, j00 = 1 + warp * wf * scratch[1]!, j01 = warp * wf * scratch[2]!, j02 = warp * wf * scratch[3]!;
    noise3(d.seed ^ 0x6b91a2f5, x * wf, y * wf, z * wf, scratch);
    const wy = y + warp * scratch[0]!, j10 = warp * wf * scratch[1]!, j11 = 1 + warp * wf * scratch[2]!, j12 = warp * wf * scratch[3]!;
    noise3(d.seed ^ 0x3c291987, x * wf, y * wf, z * wf, scratch);
    const wz = z + warp * scratch[0]!, j20 = warp * wf * scratch[1]!, j21 = warp * wf * scratch[2]!, j22 = 1 + warp * wf * scratch[3]!;
    fractal3(d.seed ^ 0x39b812a7, wx, wy, wz, fc, d.octaves, 'fbm', scratch);
    const c = scratch[0]!, cx = scratch[1]! * j00 + scratch[2]! * j10 + scratch[3]! * j20;
    const cy = scratch[1]! * j01 + scratch[2]! * j11 + scratch[3]! * j21;
    const cz = scratch[1]! * j02 + scratch[2]! * j12 + scratch[3]! * j22;
    fractal3(d.seed ^ 0x5fa671c3, x, y, z, fr, d.octaves, 'ridge', scratch);
    const mask = (c + 1) / 2, r = scratch[0]!, rx = scratch[1]!, ry = scratch[2]!, rz = scratch[3]!;
    fractal3(d.seed ^ 0x7129de45, x, y, z, fh, d.octaves, 'billow', scratch);
    const h = scratch[0]!;
    out[0] = d.maxReliefMetres * (continents * c + ranges * mask * r + hills * h);
    out[1] = d.maxReliefMetres * (continents * cx + ranges * (mask * rx + .5 * cx * r) + hills * scratch[1]!);
    out[2] = d.maxReliefMetres * (continents * cy + ranges * (mask * ry + .5 * cy * r) + hills * scratch[2]!);
    out[3] = d.maxReliefMetres * (continents * cz + ranges * (mask * rz + .5 * cz * r) + hills * scratch[3]!);
    out[4] = (c + 1) / 2; out[5] = mask * (r + 1) / 2; out[6] = (h + 1) / 2;
    noise3(d.seed ^ 0x192b78a3, x * 3.1, y * 3.1, z * 3.1, scratch);
    out[7] = (scratch[0]! + 1) / 2;
    if (pads.length) {
      const norm = Math.sqrt(x * x + y * y + z * z), ux = x / norm, uy = y / norm, uz = z / norm;
      for (let i = 0; i < pads.length; i += 6) {
        const ax = pads[i]!, ay = pads[i + 1]!, dx = ux - ax, dy = uy - ay;
        if (dx * dx + dy * dy + uz * uz >= pads[i + 2]!) continue;
        const dot = Math.max(-1, Math.min(1, ux * ax + uy * ay)), cross = ux * ay - uy * ax;
        const sine = Math.sqrt(uz * uz * (ax * ax + ay * ay) + cross * cross), angle = dm.atan2(sine, dot);
        const t = Math.max(0, Math.min(1, (angle - pads[i + 3]!) / pads[i + 4]!)), elevation = pads[i + 5]!;
        if (t === 0) { out[0] = elevation; out[1] = out[2] = out[3] = 0; break; }
        const weight = t * t * t * (t * (6 * t - 15) + 10), difference = out[0]! - elevation;
        const derivative = 30 * t * t * (1 - t) * (1 - t) / (pads[i + 4]! * sine * norm);
        out[0] = weight * out[0]! + (1 - weight) * elevation;
        out[1] = weight * out[1]! + difference * derivative * (dot * ux - pads[i]!);
        out[2] = weight * out[2]! + difference * derivative * (dot * uy - pads[i + 1]!);
        out[3] = weight * out[3]! + difference * derivative * dot * uz;
        break;
      }
    }
  }
  return Object.freeze({ definition, identity, bounds, storageBytes: scratch.byteLength + pads.byteLength, evaluate });
}
