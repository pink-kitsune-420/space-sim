import { buildPlanetMap, linearColor, type RenderOverview, type SurfaceProfile } from '../../../packages/game-api/src/index';
import { querySurface } from '../../../packages/sim-core/src/surface';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_SLOTS, type MaterialDomain } from './successor-materials';

/** Harmonic continuation of the actual circumference mixture. High angular
 * frequencies decay inward as r^n instead of turning into polar spokes. This is
 * an illustration of the visible upper4m, never a new interior geography authority.
 * Integrate each polar bin by area before constructing its linear-light mips. */
function diffuseFace(samples: Uint8Array, columns: number, rows: number, palette: readonly (readonly number[])[]): RenderOverview['levels'] {
  const sectors = 64, rings = 8, modes = 31, topRows = Math.min(rows, 2), edge = new Float64Array(sectors * 3);
  for (let x = 0; x < sectors; x++) {
    const count = [0, 0, 0], stride = columns / sectors;
    for (let y = 0; y < topRows; y++) for (let dx = 0; dx < stride; dx++) {
      const pair = samples[y * columns + x * stride + dx]!;
      count[pair & 3]!++; count[(pair >> 2) & 3]!++;
    }
    for (let c = 0; c < 3; c++) for (let material = 0; material < 3; material++)
      edge[x * 3 + c] = edge[x * 3 + c]! + count[material]! * palette[material]![c]! / (topRows * stride * 2);
  }
  const coefficients = new Float64Array((modes + 1) * 6);
  for (let n = 0; n <= modes; n++) for (let x = 0; x < sectors; x++) {
    const a = (x + .5) * 2 * Math.PI / sectors;
    for (let c = 0; c < 3; c++) {
      coefficients[n * 6 + c] = coefficients[n * 6 + c]! + edge[x * 3 + c]! * Math.cos(n * a) * (n ? 2 : 1) / sectors;
      coefficients[n * 6 + 3 + c] = coefficients[n * 6 + 3 + c]! + edge[x * 3 + c]! * Math.sin(n * a) * 2 / sectors;
    }
  }
  const rgba = new Float32Array(sectors * rings * 4);
  for (let y = 0; y < rings; y++) for (let x = 0; x < sectors; x++) {
    const lo = y / rings, hi = (y + 1) / rings, a = (x + .5) * 2 * Math.PI / sectors, i = (y * sectors + x) * 4;
    for (let c = 0; c < 3; c++) rgba[i + c] = coefficients[c]!;
    for (let n = 1; n <= modes; n++) {
      const radial = 2 * (hi ** (n + 2) - lo ** (n + 2)) / ((n + 2) * (hi * hi - lo * lo));
      const angular = Math.sin(n * Math.PI / sectors) / (n * Math.PI / sectors);
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c]! + radial * angular *
        (coefficients[n * 6 + c]! * Math.cos(n * a) + coefficients[n * 6 + 3 + c]! * Math.sin(n * a));
    }
    rgba[i + 3] = 1;
  }
  const levels = [{ sectors, rings, rgba }];
  while (levels[0]!.sectors > 1 || levels[0]!.rings > 1) {
    const child = levels[0]!, sectors = child.sectors / 2, rings = Math.max(1, child.rings / 2), rgba = new Float32Array(sectors * rings * 4);
    for (let y = 0; y < rings; y++) for (let x = 0; x < sectors; x++) {
      let weight = 0;
      for (let dy = 0; dy < (child.rings > 1 ? 2 : 1); dy++) for (let dx = 0; dx < 2; dx++) {
        const cy = y * (child.rings > 1 ? 2 : 1) + dy, w = 2 * cy + 1, ci = (cy * child.sectors + x * 2 + dx) * 4;
        weight += w;
        for (let c = 0; c < 4; c++) rgba[(y * sectors + x) * 4 + c] = rgba[(y * sectors + x) * 4 + c]! + child.rgba[ci + c]! * w;
      }
      for (let c = 0; c < 4; c++) rgba[(y * sectors + x) * 4 + c] = rgba[(y * sectors + x) * 4 + c]! / weight;
    }
    levels.unshift({ sectors, rings, rgba });
  }
  return levels;
}

/** Bounded quadrature of the actual 16m surface ribbon, not the disc interior or
 * fine cells. Original pad tangent X points clockwise; remote targets never reset
 * that frame. Two angular strata/bin, with 2m radial support, cost 131072 queries.
 * Packed identities and angular-only mixture mips keep both bodies below 512KiB. */
export function buildOverview(profile: SurfaceProfile, domain: MaterialDomain): RenderOverview {
  const sectors = 8192, rows = 8, depthMetres = 16;
  const samples = new Uint8Array(sectors * rows);
  const pad = profile.pads.find(p => p.id === 'landing-area') ?? { angleRadians: Math.PI / 2 };
  const palette = MATERIAL_SLOTS.map(id => [1, 3, 5].map(i => linearColor(parseInt(domain.colors[id].slice(i, i + 2), 16) / 255)));
  const levels: { sectors: number; fractions: Uint8Array }[] = [];
  let childSectors = sectors, child: Uint8Array | undefined;
  for (let x = 0; x < sectors; x++) for (let stratum = 0; stratum < 2; stratum++) {
    const a = (x + (stratum + .5) / 2) * 2 * Math.PI / sectors;
    const r = querySurface(profile, a).groundRadius, d = a - pad.angleRadians;
    const c = Math.cos(d), s = Math.sin(d);
    for (let y = 0; y < rows; y++) {
      const radius = r - (y + .5) * depthMetres / rows;
      const id = appearanceAt(domain, -radius * s, radius * c - profile.referenceRadius);
      samples[y * sectors + x] = samples[y * sectors + x]! | (MATERIAL_SLOTS.indexOf(id) << (stratum * 2));
    }
  }
  while (childSectors > 1) {
    const count = childSectors / 2, fractions = new Uint8Array(count * rows * 2);
    for (let y = 0; y < rows; y++) for (let x = 0; x < count; x++) {
      let first = 0, second = 0;
      for (let dx = 0; dx < 2; dx++) {
        if (child) { const i = (y * childSectors + x * 2 + dx) * 2; first += child[i]! / 2; second += child[i + 1]! / 2; }
        else { const packed = samples[y * sectors + x * 2 + dx]!;
          for (const id of [packed & 3, packed >> 2]) { if (id === 0) first += 255 / 4; if (id === 1) second += 255 / 4; }
        }
      }
      const i = (y * count + x) * 2;
      fractions[i] = Math.round(first); fractions[i + 1] = Math.min(255 - fractions[i]!, Math.round(second));
    }
    levels.unshift({ sectors: count, fractions }); child = fractions; childSectors = count;
  }
  const planet = profile.planet ? buildPlanetMap(profile) : undefined;
  return { levels: planet?.levels ?? diffuseFace(samples, sectors, rows, palette), surface: { sectors, rows, depthMetres, samples, levels, palette },
    ...(planet ? { planet: planet.planet } : {}) };
}

export class SuccessorOverview {
  private cache = new WeakMap<SurfaceProfile, Map<'planet' | 'moon', RenderOverview>>();
  readonly stats = { summaryBytes: 0, generatedBodies: 0, descriptorSamples: 0, mapBytes: 0, mapPixels: 0, fineRequests: 0, buildMs: 0 };
  clear(): void { this.cache = new WeakMap(); this.stats.summaryBytes = this.stats.generatedBodies = this.stats.descriptorSamples = this.stats.mapBytes = this.stats.mapPixels = this.stats.buildMs = 0; }
  forBody(profile: SurfaceProfile, body: 'planet' | 'moon'): RenderOverview {
    let domains = this.cache.get(profile);
    if (!domains) { domains = new Map(); this.cache.set(profile, domains); }
    let summary = domains.get(body);
    if (!summary) {
      const started = performance.now();
      summary = buildOverview(profile, MATERIAL_DOMAINS[body]); this.stats.buildMs += performance.now() - started; domains.set(body, summary);
      this.stats.generatedBodies++; this.stats.descriptorSamples += 131072;
      this.stats.summaryBytes += summary.levels.reduce((sum, level) => sum + level.rgba.byteLength, 0)
        + summary.surface!.samples.byteLength + summary.surface!.levels.reduce((n, l) => n + l.fractions.byteLength, 0);
      if (summary.planet) {
        this.stats.mapBytes += summary.planet.storageBytes; this.stats.summaryBytes += summary.planet.storageBytes;
        let pixels = 0; for (let i=3;i<summary.planet.rgba.length;i+=4) if (summary.planet.rgba[i]) pixels++;
        this.stats.mapPixels += pixels; this.stats.descriptorSamples += pixels + profile.sampleCount;
      }
    }
    return summary;
  }
}
