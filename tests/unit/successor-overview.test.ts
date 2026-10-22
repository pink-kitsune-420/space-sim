import { describe, expect, it, vi } from 'vitest';
import { averageOverview, displayColor, linearColor, overviewColor, type Renderer } from '../../packages/game-api/src/index';
import { buildOverview } from '../../apps/web/src/successor-overview';
import { SuccessorFocus } from '../../apps/web/src/successor-focus';
import { buildTilePatch, SuccessorTiles } from '../../apps/web/src/successor-tiles';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_SLOTS } from '../../apps/web/src/successor-materials';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame } from '../../packages/modules/src/index';
import { querySurface } from '../../packages/sim-core/src/surface';
const game = requestedBuiltinGame('?game=space-sim-successor');
const setup = () => prepareGame({ environment: 'node', data: game.bundle.modules, profile: game.bundle.profile, universeKey: game.bundle.selection.universe });
const renderer: Renderer = { draw() {}, features: { tileChunks: { version: 1, rotation: true, clipPolygon: true }, tilePalettes: { register() {} } } };

describe('bounded pseudo-sphere overview and circumference inspection', () => {
  it('averages linear premultiplied colors by area, preserving transparent edges', () => {
    const out = new Float32Array(4);
    averageOverview([1, 0, 0, 1, 0, 0, 0, 0], [1, 3], out);
    expect([...out]).toEqual([.25, 0, 0, .25]);
    averageOverview([0, 0, 0, 1, 1, 1, 1, 1], [1, 1], out);
    expect(displayColor(out[0]!)).toBeCloseTo(.735357, 5);
    expect(linearColor(displayColor(.2))).toBeCloseTo(.2, 12);
  });
  it('builds bounded deterministic area-weighted summaries with rotation-independent anchors', () => {
    const { world, candidate } = setup();
    try { for (const id of ['planet', 'moon'] as const) {
      const profile = world.surface(id)!, a = buildOverview(profile, MATERIAL_DOMAINS[id]), b = buildOverview(profile, MATERIAL_DOMAINS[id]);
      expect(a).toEqual(b); expect(a.levels.reduce((n, l) => n + l.rgba.byteLength, 0)).toBeLessThan(256 * 1024);
      const fine = a.levels.at(-1)!, coarse = a.levels[0]!;
      for (let c = 0; c < 4; c++) {
        let weighted = 0, area = 0;
        for (let y = 0; y < fine.rings; y++) for (let x = 0; x < fine.sectors; x++) { const w = 2 * y + 1; weighted += fine.rgba[(y * fine.sectors + x) * 4 + c]! * w; area += w; }
        expect(coarse.rgba[c]).toBeCloseTo(weighted / area, 6);
      }
      const out = new Float64Array(4), body = { id, name: id, radius: profile.referenceRadius, position: { x: 0, y: 0 }, overview: a };
      overviewColor(body, .7, .6, 5000, out); const fixed = [...out];
      overviewColor({ ...body, rotation: 2 }, .7, .6, 5000, out); expect([...out]).toEqual(fixed);
      expect(overviewColor(body, .7 + Math.PI * 2, .6, 5000, out)).toBe(true); expect([...out]).toEqual(fixed);
    } } finally { candidate.dispose(); }
  });
  it('keeps target identity through spin/world motion and rejects ambiguous center focus', () => {
    const { world, candidate } = setup(); try { for (const id of ['planet', 'moon'] as const) {
      const p = world.surface(id)!, f = new SuccessorFocus();
      expect(f.acquire(id, p, { x: p.referenceRadius, y: 0 }, .3)).toBe(true);
      const angle = f.angle!; const r = querySurface(p, angle).groundRadius;
      for (const spin of [0, .7, 5]) { const q = f.point(r, spin, { x: 1e11, y: -1e10 })!;
        expect(Math.hypot(q.x - 1e11, q.y + 1e10)).toBeCloseTo(r, 4); expect(f.angle).toBe(angle); }
      expect(f.acquire(id, p, { x: 0, y: 0 }, 0)).toBe(false); expect(f.angle).toBe(angle);
    } } finally { candidate.dispose(); }
  });
  it('remote patches keep canonical ground and the original pad-based material frame', () => {
    const { world, candidate } = setup(); try { for (const id of ['planet', 'moon'] as const) {
      const p = world.surface(id)!, pad = p.pads.find(p => p.id === 'landing-area')!, angle = pad.angleRadians + 1.3;
      const patch = buildTilePatch(p, 1, a => querySurface(p, a).groundRadius, MATERIAL_DOMAINS[id], 'colored', angle);
      expect(patch.chunks.length).toBeLessThanOrEqual(512);
      for (const v of patch.boundary) { const a = angle + Math.atan2(-v.x, v.y + p.referenceRadius); expect(Math.hypot(v.x, v.y + p.referenceRadius)).toBeCloseTo(querySurface(p, a).groundRadius, 7); }
      const d = angle - pad.angleRadians;
      for (const chunk of patch.chunks) for (let y = 0; y < 32; y += 7) for (let x = 0; x < 32; x += 7) {
        const lx = chunk.origin.x + x + .5, ly = chunk.origin.y + y + .5;
        const expected = appearanceAt(MATERIAL_DOMAINS[id], lx * Math.cos(d) - (ly + p.referenceRadius) * Math.sin(d), lx * Math.sin(d) + (ly + p.referenceRadius) * Math.cos(d) - p.referenceRadius);
        expect(MATERIAL_SLOTS[chunk.tiles[y * 32 + x]! - 1]).toBe(expected);
      }
    } } finally { candidate.dispose(); }
  });
  it('zero-demand overview, delayed readiness, hysteresis, stale-target cancellation and independent views', () => {
    const { world, candidate } = setup(); const now = vi.spyOn(performance, 'now'); let clock = 0; now.mockImplementation(() => clock);
    try {
      const p = world.surface('moon')!, a = new SuccessorTiles(), b = new SuccessorTiles(); a.delayMs = 500;
      const query = (a: number) => querySurface(p, a).groundRadius;
      const camera = { center: { x: 0, y: p.referenceRadius }, rotation: 0, scale: .001 };
      expect(a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon')).toHaveLength(0);
      expect(a.stats.fineRequests).toBe(0); expect(a.stats.residentChunks).toBe(0);
      camera.scale = 4; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); expect(a.stats.pending).toBe(true);
      clock = 499; a.targetAngle = 1; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon');
      clock = 501; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); expect(a.stats.pending).toBe(true);
      clock = 1000; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); expect(a.stats.residentChunks).toBeGreaterThan(0);
      camera.scale = 3.2; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); expect(a.stats.residentChunks).toBeGreaterThan(0);
      b.draw(p, query, renderer, { x: 0, y: 0 }, 0, { ...camera, scale: .001 }, 800, 600, 'moon'); expect(b.stats.fineRequests).toBe(0);
      camera.scale = 2.9; a.draw(p, query, renderer, { x: 0, y: 0 }, 0, camera, 800, 600, 'moon'); expect(a.stats.bufferBytes).toBe(0);
    } finally { now.mockRestore(); candidate.dispose(); }
  });
});

it('preserves the exact canonical rim, air-mask faces and bounded geometry in both providers', async () => {
  const { terrainGeometry: canvasGeometry } = await import('../../modules/render-canvas/src/terrain');
  const { terrainGeometry: glGeometry } = await import('../../modules/render-webgl/src/terrain');
  const { world, candidate } = setup();
  try { for (const id of ['planet', 'moon'] as const) for (const rotation of [0, .7, 2]) {
    const p = world.surface(id)!, body = { id, name: id, radius: p.referenceRadius, surface: p, position: { x: 0, y: 0 }, rotation };
    const summary = buildOverview(p, MATERIAL_DOMAINS[id]);
    const camera = { center: { x: 0, y: 0 }, rotation: -.3, scale: 220 / p.referenceRadius };
    for (const geometry of [canvasGeometry, glGeometry]) {
      const plain = geometry(body, camera, 1000, 800, { querySurface });
      const shaded = geometry({ ...body, overview: summary }, camera, 1000, 800, { querySurface });
      expect(shaded.groundClip).toEqual(plain.groundClip); expect(shaded.boundary).toEqual(plain.boundary);
      expect(shaded.faces.filter(f => !f.overview)).toEqual(plain.faces);
      const added = shaded.faces.filter(f => f.overview);
      expect(added.length).toBeGreaterThan(0); expect(added.reduce((sum, f) => sum + f.points.length - 2, 0)).toBeLessThanOrEqual(geometry === canvasGeometry ? 1024 : 8192);
      expect(shaded.accents).toEqual(plain.accents);
    }
  } } finally { candidate.dispose(); }
});

it('crossfades summary levels continuously before projected details alias', () => {
  const body = { id: 'fixture', name: 'fixture', radius: 1, position: { x: 0, y: 0 }, overview: { levels: [
    { sectors: 1, rings: 1, rgba: new Float32Array([.1, .1, .1, 1]) },
    { sectors: 2, rings: 1, rgba: new Float32Array([.8, .2, .1, 1, .1, .2, .8, 1]) },
  ] } };
  const out = new Float64Array(4); let previous = 0;
  for (let pixels = 5; pixels < 13; pixels += .001) {
    overviewColor(body, .1, .5, pixels, out);
    if (pixels > 5) expect(Math.abs(out[0]! - previous)).toBeLessThan(.001);
    previous = out[0]!;
  }
});

it('uses one average at the disc center and filters both sides of the polar seam', () => {
  const body = { id: 'fixture', name: 'fixture', radius: 1, position: { x: 0, y: 0 }, overview: { levels: [
    { sectors: 1, rings: 1, rgba: new Float32Array([.2, .2, .2, 1]) },
    { sectors: 2, rings: 1, rgba: new Float32Array([.8, .2, .1, 1, .1, .2, .8, 1]) },
  ] } };
  const a = new Float64Array(4), b = new Float64Array(4);
  overviewColor(body, 0, 0, 5000, a); overviewColor(body, 2, 0, 5000, b); expect([...a]).toEqual([...b]);
  overviewColor(body, -.000001, .5, 5000, a); overviewColor(body, .000001, .5, 5000, b);
  for (let i = 0; i < 4; i++) expect(a[i]).toBeCloseTo(b[i]!, 5);
});

it('separates body material domains even when callers share the same immutable profile', async () => {
  const { SuccessorOverview } = await import('../../apps/web/src/successor-overview');
  const { world, candidate } = setup();
  try { const p = world.surface('planet')!, o = new SuccessorOverview();
    const primus = o.forBody(p, 'planet'), parvus = o.forBody(p, 'moon');
    expect(primus).not.toEqual(parvus); expect(o.forBody(p, 'planet')).toBe(primus); expect(o.forBody(p, 'moon')).toBe(parvus);
    expect(o.stats.generatedBodies).toBe(2); expect(o.stats.descriptorSamples).toBe(65536);
  } finally { candidate.dispose(); }
});

it('composites transparent summary coverage over complete ground in both providers', async () => {
  const { terrainGeometry: cg } = await import('../../modules/render-canvas/src/terrain');
  const { terrainGeometry: wg } = await import('../../modules/render-webgl/src/terrain');
  const { world, candidate } = setup();
  try { const p = world.surface('moon')!, camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 200 / p.referenceRadius };
    const body = { id: 'moon', name: '', radius: p.referenceRadius, position: { x: 0, y: 0 }, surface: p };
    for (const alpha of [0, .25, 1]) for (const geometry of [cg, wg]) {
      const g = geometry({ ...body, overview: { levels: [{ sectors: 1, rings: 1, rgba: new Float32Array([.2 * alpha, .1 * alpha, .05 * alpha, alpha]) }] } }, camera, 1000, 800, { querySurface });
      expect(g.faces.some(f => !f.overview && f.color[3] === 1)).toBe(true);
      for (const f of g.faces.filter(f => f.overview)) {
        expect(f.color[3]).toBeCloseTo(alpha, 6); expect(f.gradient?.color[3]).toBeCloseTo(alpha, 6);
        for (const color of (f as { vertexColors?: readonly (readonly number[])[] }).vertexColors ?? []) expect(color[3]).toBeCloseTo(alpha, 6);
      }
    }
  } finally { candidate.dispose(); }
});
