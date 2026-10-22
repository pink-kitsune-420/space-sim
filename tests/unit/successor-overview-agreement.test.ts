import { describe, expect, it } from 'vitest';
import { linearColor, displayColor, surfaceOverviewColor, type RenderOverviewSurface } from '../../packages/game-api/src/index';
import { buildOverview, SuccessorOverview } from '../../apps/web/src/successor-overview';
import { appearanceAt, MATERIAL_DOMAINS, MATERIAL_SLOTS } from '../../apps/web/src/successor-materials';
import { requestedBuiltinGame } from '../../apps/web/src/bundled-games';
import { prepareGame } from '../../packages/modules/src/index';
import { createSurfaceProfile, querySurface } from '../../packages/sim-core/src/surface';
import { terrainGeometry as cg } from '../../modules/render-canvas/src/terrain';
import { terrainGeometry as wg } from '../../modules/render-webgl/src/terrain';
const game = requestedBuiltinGame('?game=space-sim-successor');
const setup = (scale = 4) => prepareGame({ environment: 'node', data: game.bundle.modules, profile: game.bundle.profile,
  universeKey: game.bundle.selection.universe, systemId: scale === 4 ? 'primus-system' : `primus-system-${scale}x` });
const bytes = (s: RenderOverviewSurface) => s.samples.byteLength + s.levels.reduce((n, l) => n + l.fractions.byteLength, 0);

// Independent orthonormal world-coordinate projections, not the overview builder's
// angle-difference formula or the remote patch's coordinate transform.
function address(pad: number, angle: number, radius: number, reference: number) {
  const point = { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
  return { x: point.x * Math.sin(pad) - point.y * Math.cos(pad),
    y: point.x * Math.cos(pad) + point.y * Math.sin(pad) - reference };
}

describe('canonical circumference/material agreement', () => {
  it.each([2, 4, 8])('samples actual ground in the original clockwise pad frame, including remote anchors at %ix', scale => {
    const { world, candidate } = setup(scale);
    try { for (const id of ['planet', 'moon'] as const) {
      const p = world.surface(id)!, domain = MATERIAL_DOMAINS[id], atlas = buildOverview(p, domain).surface!;
      const pad = p.pads.find(p => p.id === 'landing-area')!.angleRadians;
      // Named pads/features, seam, remote angles and descriptor transitions are
      // independent query targets. Compare the actual stored pair, not a sampler
      // asking another sampler for its own expected answer.
      const angles = [0, 2 * Math.PI - 1e-5, pad + 2, ...p.pads.map(p => p.angleRadians), ...p.features.map(f => f.angleRadians)];
      for (let i = 0; i < atlas.sectors; i += 137) angles.push(i * 2 * Math.PI / atlas.sectors);
      for (const angle of angles) {
        const column = Math.floor(((angle / (2 * Math.PI)) % 1 + 1) % 1 * atlas.sectors);
        for (let row = 0; row < atlas.rows; row++) for (let stratum = 0; stratum < 2; stratum++) {
          const a = (column + (stratum + .5) / 2) * 2 * Math.PI / atlas.sectors;
          const radius = querySurface(p, a).groundRadius - (row + .5) * atlas.depthMetres / atlas.rows;
          const q = address(pad, a, radius, p.referenceRadius);
          const expected = MATERIAL_SLOTS.indexOf(appearanceAt(domain, q.x, q.y));
          const packed = atlas.samples[row * atlas.sectors + column]!;
          expect((packed >> (2 * stratum)) & 3).toBe(expected);
        }
      }
      expect(bytes(atlas)).toBe(196592);
      expect(atlas.samples.length * 2).toBeLessThanOrEqual(131072);
    } } finally { candidate.dispose(); }
  });

  it('counts all owned summaries and reuses immutable data without fine demand', () => {
    const { world, candidate } = setup();
    try {
      const o = new SuccessorOverview();
      for (const id of ['planet', 'moon'] as const) {
        const a = o.forBody(world.surface(id)!, id);
        expect(o.forBody(world.surface(id)!, id)).toBe(a);
      }
      expect(o.stats.summaryBytes).toBe(415168); expect(o.stats.summaryBytes).toBeLessThanOrEqual(512 * 1024);
      expect(o.stats.descriptorSamples).toBe(262144); expect(o.stats.generatedBodies).toBe(2); expect(o.stats.fineRequests).toBe(0);
      o.clear(); expect(o.stats.summaryBytes).toBe(0);
    } finally { candidate.dispose(); }
  });

  it('preserves independently counted mixture weights instead of averaging identities or display RGB', () => {
    const { world, candidate } = setup();
    try { for (const id of ['planet', 'moon'] as const) {
      const s = buildOverview(world.surface(id)!, MATERIAL_DOMAINS[id]).surface!;
      for (const level of s.levels) for (let row = 0; row < s.rows; row += 3) for (let x = 0; x < level.sectors; x += 251) {
        const stride = s.sectors / level.sectors, counts = [0, 0, 0];
        for (let j = 0; j < stride; j++) { const pair = s.samples[row * s.sectors + x * stride + j]!; counts[pair & 3]!++; counts[pair >> 2]!++; }
        const first = level.fractions[(row * level.sectors + x) * 2]! / 255;
        const second = level.fractions[(row * level.sectors + x) * 2 + 1]! / 255;
        expect(first + second).toBeLessThanOrEqual(1 + 1e-12);
        expect(Math.abs(first - counts[0]! / (stride * 2))).toBeLessThan(.026);
        expect(Math.abs(second - counts[1]! / (stride * 2))).toBeLessThan(.026);
      }
    } } finally { candidate.dispose(); }
  });

  it('filters linear mixtures continuously in angle, depth and zoom, keeping the seam/body frame fixed', () => {
    const surface: RenderOverviewSurface = { sectors: 2, rows: 2, depthMetres: 16,
      samples: new Uint8Array([0, 5, 10, 10]), palette: [[0, 0, 0], [1, 1, 1], [.2, .2, .2]],
      levels: [{ sectors: 1, fractions: new Uint8Array([128, 127, 0, 0]) }] };
    const body = { id: '', name: '', radius: 100, position: { x: 0, y: 0 }, overview: { levels: [], surface } }, out = new Float64Array(4);
    surfaceOverviewColor(body, Math.PI, 4, 1, out); expect(out[0]).toBeCloseTo(displayColor(.5), 6);
    surfaceOverviewColor(body, Math.PI / 2, 4, 1, out); expect(out[0]).toBe(0);
    surfaceOverviewColor(body, Math.PI / 2, 12, 1, out); expect(out[0]).toBeCloseTo(displayColor(.2), 6);
    for (const angle of [-.000001, .000001, 2 * Math.PI + .000001]) {
      surfaceOverviewColor(body, angle, 5, 100, out); const a = [...out];
      surfaceOverviewColor({ ...body, rotation: 2 }, angle + 2 * Math.PI, 5, 100, out);
      a.forEach((c, i) => expect(out[i]).toBeCloseTo(c, 9));
    }
    let previous = 0;
    for (let footprint = 1; footprint < 1000; footprint += .1) {
      surfaceOverviewColor(body, 1, 7, footprint, out);
      if (footprint > 1) expect(Math.abs(out[0]! - previous)).toBeLessThan(.02);
      previous = out[0]!;
    }
    expect(linearColor(displayColor(.5))).toBeCloseTo(.5, 12);
  });

  it('keeps material coverage at intermediate zoom without changing the canonical masks or demanding cells', () => {
    const { world, candidate } = setup();
    try { for (const id of ['planet', 'moon'] as const) {
      const p = world.surface(id)!, overview = buildOverview(p, MATERIAL_DOMAINS[id]);
      for (const spin of [0, .7, 2]) for (const geometry of [cg, wg]) {
        const body = { id, name: id, radius: p.referenceRadius, position: { x: 0, y: 0 }, rotation: spin, surface: p };
        const a = p.pads[0]!.angleRadians + spin;
        const camera = { center: { x: p.referenceRadius * Math.cos(a), y: p.referenceRadius * Math.sin(a) }, rotation: -.3, scale: 1 };
        const plain = geometry(body, camera, 1000, 800, { querySurface });
        const g = geometry({ ...body, overview }, camera, 1000, 800, { querySurface });
        expect(g.groundClip).toEqual(plain.groundClip); expect(g.boundary).toEqual(plain.boundary); expect(g.accents).toEqual(plain.accents);
        expect(g.faces.filter(f => !f.overview)).toEqual(plain.faces);
        const added = g.faces.filter(f => f.overview);
        expect(added.length).toBeGreaterThan(0);
        expect(added.reduce((n, f) => n + f.points.length - 2, 0)).toBeLessThanOrEqual(geometry === cg ? 1024 : 4096);
      }
    } } finally { candidate.dispose(); }
  });

  it('retains wet canonical coast/sea authority independently of dry illustration', () => {
    const p = createSurfaceProfile(100, [-5, 5, 5, -5], 0, 100);
    // This fixture has exact crossings at pi/4 and 5pi/4, independent of rendering.
    expect(querySurface(p, 0).material).toBe('water'); expect(querySurface(p, Math.PI).material).toBe('rock');
    for (const geometry of [cg, wg]) {
      const body = { id: '', name: '', radius: 100, position: { x: 0, y: 0 }, surface: p };
      const camera = { center: { x: 0, y: 0 }, rotation: .3, scale: 2 };
      const plain = geometry(body, camera, 500, 500, { querySurface });
      const g = geometry({ ...body, overview: { levels: [{ sectors: 1, rings: 1, rgba: new Float32Array([.1, .1, .1, 1]) }] } }, camera, 500, 500, { querySurface });
      expect(g.groundClip).toEqual(plain.groundClip); expect(g.boundary).toEqual(plain.boundary);
      for (const coast of [Math.PI / 4, 5 * Math.PI / 4]) expect(g.boundary.some(v => Math.abs(v.angle - coast) < 1e-10)).toBe(true);
    }
  });
});

it('anchors restrained filled relief to existing feature geometry while leaving the physical ribbon unlit', async () => {
  const { overviewColor } = await import('../../packages/game-api/src/index');
  const { world, candidate } = setup();
  try { for (const id of ['planet', 'moon'] as const) {
    const p = world.surface(id)!, feature = p.features.find(f => f.kind === 'crater')!, summary = buildOverview(p, MATERIAL_DOMAINS[id]);
    const body = { id, name: id, radius: p.referenceRadius, position: { x: 0, y: 0 }, surface: p,
      sunDirection: { x: -.6, y: .8 }, overview: summary };
    const r = p.bounds.minRadius * .65 / p.bounds.maxRadius, actual = new Float64Array(4), plain = new Float64Array(4);
    const withoutFeatures = { ...p, features: [] };
    overviewColor(body, feature.angleRadians, r, 600, actual);
    overviewColor({ ...body, surface: withoutFeatures }, feature.angleRadians, r, 600, plain);
    expect(actual[0]).toBeLessThan(plain[0]!); expect(actual[0]! / plain[0]!).toBeGreaterThanOrEqual(.55);
    surfaceOverviewColor(body, feature.angleRadians, 2, 4, actual);
    surfaceOverviewColor({ ...body, surface: withoutFeatures, rotation: 2, sunDirection: { x: 1, y: 0 } }, feature.angleRadians, 2, 4, plain);
    expect([...actual]).toEqual([...plain]);
    // The same world sun transformed with physical spin preserves every body-local cue.
    const spin = 1.1, c = Math.cos(spin), s = Math.sin(spin);
    overviewColor(body, feature.angleRadians, r, 600, actual);
    overviewColor({ ...body, rotation: spin, sunDirection: { x: -.6 * c - .8 * s, y: -.6 * s + .8 * c } }, feature.angleRadians, r, 600, plain);
    [...actual].forEach((v, i) => expect(plain[i]).toBeCloseTo(v, 10));
  } } finally { candidate.dispose(); }
});

it('diffuses circumference variation inward by area instead of painting polar spokes', () => {
  const { world, candidate } = setup();
  try { for (const id of ['planet', 'moon'] as const) {
    const s = buildOverview(world.surface(id)!, MATERIAL_DOMAINS[id]), face = s.levels.at(-1)!;
    expect(face.sectors).toBe(64); expect(face.rings).toBe(8);
    const spread = (row: number, channel: number) => {
      const values = Array.from({ length: face.sectors }, (_, x) => face.rgba[(row * face.sectors + x) * 4 + channel]!);
      return Math.max(...values) - Math.min(...values);
    };
    for (let c = 0; c < 3; c++) {
      expect(spread(7, c)).toBeGreaterThan(1e-5);
      expect(spread(0, c)).toBeLessThan(spread(7, c) * .2);
    }
  } } finally { candidate.dispose(); }
});

it('shares overview mesh points and colors inside a tightened transport/storage budget', () => {
  const { world, candidate } = setup();
  try { for (const id of ['planet', 'moon'] as const) {
    const p = world.surface(id)!, overview = buildOverview(p, MATERIAL_DOMAINS[id]);
    const body = { id, name: '', radius: p.referenceRadius, surface: p, overview, position: { x: 0, y: 0 } };
    const g = wg(body, { center: { x: 0, y: 0 }, rotation: .3, scale: 90 / p.referenceRadius }, 800, 600, { querySurface });
    const faces = g.faces.filter(f => f.overview), points = faces.flatMap(f => f.points), colors = faces.flatMap(f => f.vertexColors ?? []);
    expect(faces.length).toBeGreaterThan(0);
    expect(faces.reduce((n, f) => n + f.points.length - 2, 0)).toBeLessThanOrEqual(1536);
    expect(new Set(points).size).toBeLessThan(points.length * .4);
    expect(new Set(colors).size).toBeLessThan(colors.length * .4);
  } } finally { candidate.dispose(); }
});

it('filters angular coverage independently from the physical radial footprint', () => {
  const surface: RenderOverviewSurface = { sectors: 2, rows: 2, depthMetres: 16,
    samples: new Uint8Array([0, 5, 10, 10]), palette: [[0, 0, 0], [1, 1, 1], [.2, .2, .2]],
    levels: [{ sectors: 1, fractions: new Uint8Array([128, 127, 0, 0]) }] };
  const body = { id: '', name: '', radius: 100, position: { x: 0, y: 0 }, overview: { levels: [], surface } }, out = new Float64Array(4);
  surfaceOverviewColor(body, 1, 4, 1000, out, 1);
  expect(linearColor(out[0]!)).toBeCloseTo(127 / 255, 6);
  surfaceOverviewColor(body, 1, 12, 1000, out, 1);
  expect(linearColor(out[0]!)).toBeCloseTo(.2, 6);
});

it('shows actual physical depth at a rim-focused intermediate view even on the smaller body', () => {
  const { world, candidate } = setup();
  try { for (const id of ['planet', 'moon'] as const) for (const geometry of [cg, wg]) {
    const p = world.surface(id)!, overview = buildOverview(p, MATERIAL_DOMAINS[id]);
    const g = geometry({ id, name: '', radius: p.referenceRadius, position: { x: 0, y: 0 }, surface: p, overview },
      { center: { x: 0, y: p.referenceRadius }, rotation: 0, scale: 1 }, 1000, 800, { querySurface });
    const depths = g.faces.filter(f => f.overview).flatMap(f => f.points).map(point => {
      // Independently undo this known camera in world coordinates; inspect the
      // canonical profile, not renderer metadata or a material sampling helper.
      const x = point.x - 500, y = p.referenceRadius + 400 - point.y;
      return querySurface(p, Math.atan2(y, x)).groundRadius - Math.hypot(x, y);
    });
    expect(depths.length).toBeGreaterThan(0);
    expect(Math.min(...depths)).toBeGreaterThan(-.6);
    expect(Math.max(...depths)).toBeGreaterThan(12);
    expect(Math.max(...depths)).toBeLessThan(16.6);
  } } finally { candidate.dispose(); }
});
