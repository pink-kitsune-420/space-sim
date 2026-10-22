import { linearColor, type RenderOverview, type SurfaceProfile } from '../../../packages/game-api/src/index';
import { appearanceAt, MATERIAL_DOMAINS, type MaterialDomain } from './successor-materials';

/** 512 body-fixed polar bins, 64 equal-area stratified samples per bin. Bounded
 * quadrature of the accepted descriptor, not a generated fine-cell planet. */
export function buildOverview(profile: SurfaceProfile, domain: MaterialDomain): RenderOverview {
  const sectors = 64, rings = 8, rgba = new Float32Array(sectors * rings * 4);
  const pad = profile.pads.find(p => p.id === 'landing-area')!, ca = Math.cos(pad.angleRadians), sa = Math.sin(pad.angleRadians);
  const palette = Object.fromEntries(Object.entries(domain.colors).map(([id, hex]) => [id,
    [1, 3, 5].map(i => linearColor(parseInt(hex.slice(i, i + 2), 16) / 255))]));
  for (let y = 0; y < rings; y++) for (let x = 0; x < sectors; x++) {
    const i = (y * sectors + x) * 4;
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const a = (x + (sx + .5) / 8) * 2 * Math.PI / sectors;
      const r = profile.bounds.maxRadius * Math.sqrt((y * y + ((sy + .5) / 8) * (2 * y + 1)) / (rings * rings));
      const bx = r * Math.cos(a), by = r * Math.sin(a);
      const id = appearanceAt(domain, -bx * sa + by * ca, bx * ca + by * sa - profile.referenceRadius);
      for (let c = 0; c < 3; c++) rgba[i + c] = rgba[i + c]! + palette[id]![c]! / 64;
    }
    rgba[i + 3] = 1;
  }
  const levels = [{ sectors, rings, rgba }];
  while (levels[0]!.sectors > 1 || levels[0]!.rings > 1) {
    const child = levels[0]!, sectors = Math.max(1, child.sectors / 2), rings = Math.max(1, child.rings / 2);
    const rgba = new Float32Array(sectors * rings * 4);
    for (let y = 0; y < rings; y++) for (let x = 0; x < sectors; x++) {
      let weight = 0;
      for (let dy = 0; dy < (child.rings > 1 ? 2 : 1); dy++) for (let dx = 0; dx < 2; dx++) {
        const cy = y * (child.rings > 1 ? 2 : 1) + dy, w = 2 * cy + 1;
        const ci = (cy * child.sectors + x * 2 + dx) * 4;
        weight += w;
        for (let c = 0; c < 4; c++) rgba[(y * sectors + x) * 4 + c] = rgba[(y * sectors + x) * 4 + c]! + child.rgba[ci + c]! * w;
      }
      for (let c = 0; c < 4; c++) rgba[(y * sectors + x) * 4 + c] = rgba[(y * sectors + x) * 4 + c]! / weight;
    }
    levels.unshift({ sectors, rings, rgba });
  }
  return { levels };
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
      this.stats.generatedBodies++; this.stats.descriptorSamples += 32768;
      this.stats.summaryBytes += summary.levels.reduce((sum, level) => sum + level.rgba.byteLength, 0);
    }
    return summary;
  }
}
