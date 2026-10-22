import { linearColor, type RenderOverview, type SurfaceProfile } from '../../../packages/game-api/src/index';
import { querySurface } from '../../../packages/sim-core/src/surface';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_SLOTS, type MaterialDomain } from './successor-materials';

/** Bounded quadrature of the actual 16m surface ribbon, not the disc interior or
 * fine cells. Original pad tangent X points clockwise; remote targets never reset
 * that frame. Two angular strata/bin, with 2m radial support, cost 131072 queries.
 * Packed identities and angular-only mixture mips keep both bodies below 512KiB. */
export function buildOverview(profile: SurfaceProfile, domain: MaterialDomain): RenderOverview {
  const sectors = 8192, rows = 8, depthMetres = 16;
  const samples = new Uint8Array(sectors * rows);
  const pad = profile.pads.find(p => p.id === 'landing-area')!;
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
  const rgba = new Float32Array(4);
  for (let y = 0; y < rows; y++) {
    const f = levels[0]!.fractions, a = f[y * 2]! / 255, b = f[y * 2 + 1]! / 255;
    for (let c = 0; c < 3; c++) rgba[c] = rgba[c]! + (a * palette[0]![c]! + b * palette[1]![c]! + (1 - a - b) * palette[2]![c]!) / rows;
  }
  rgba[3] = 1;
  return { levels: [{ sectors: 1, rings: 1, rgba }], surface: { sectors, rows, depthMetres, samples, levels, palette } };
}

export class SuccessorOverview {
  private cache = new WeakMap<SurfaceProfile, Map<'planet' | 'moon', RenderOverview>>();
  readonly stats = { summaryBytes: 0, generatedBodies: 0, descriptorSamples: 0, fineRequests: 0, buildMs: 0 };
  clear(): void { this.cache = new WeakMap(); this.stats.summaryBytes = this.stats.generatedBodies = this.stats.descriptorSamples = this.stats.buildMs = 0; }
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
    }
    return summary;
  }
}
