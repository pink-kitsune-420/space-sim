import { expect, it } from 'vitest';
import { createSurfaceProfile, generateSurface, querySurface } from '../../packages/sim-core/src/surface';
import { terrainGeometry, TERRAIN_ERROR } from '../../packages/render-2d/src/terrain';
import { project, type Camera } from '../../packages/render-2d/src/index';

const distance = (p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};
const elevations = [0, 30, -20, 10, -12, 24, -10, 4];
const orientation = .27;
const profile = createSurfaceProfile(160, elevations, orientation);

it('keeps the polar silhouette within half a CSS pixel through seams, zoom and camera rotation', () => {
  for (const angle of [0, .27, 1.57, 2 * Math.PI - .001]) for (const scale of [.012, 1, 20, 2000]) {
    for (const rotation of [0, .7, -2]) {
      const radius = querySurface(profile, angle).groundRadius;
      const position = { x: 1e10, y: -2e10 };
      const camera: Camera = { center: { x: position.x + radius * Math.cos(angle), y: position.y + radius * Math.sin(angle) }, rotation, scale };
      const body = { id: 'fixture', name: 'Fixture', radius: 160, position, surface: profile };
      const geometry = terrainGeometry(body, camera, 800, 600);
      expect(geometry.boundary.length).toBeGreaterThan(1);
      for (let j = 1; j < geometry.boundary.length; j++) {
        const a = geometry.boundary[j - 1]!, b = geometry.boundary[j]!;
        for (let k = 0; k <= 20; k++) {
          const theta = a.angle + (b.angle - a.angle) * k / 20;
          // Independent polar interpolation of hand-authored samples.
          const phase = ((theta - orientation) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) * 8 / (2 * Math.PI);
          const i = Math.floor(phase), t = phase - i;
          const r = 160 + elevations[i % 8]! * (1 - t) + elevations[(i + 1) % 8]! * t;
          // Subtract world origins before projection, matching double precision coordinates.
          const p = project({ x: r * Math.cos(theta), y: r * Math.sin(theta) },
            { ...camera, center: { x: camera.center.x - position.x, y: camera.center.y - position.y } }, 800, 600);
          expect(distance(p, a, b)).toBeLessThanOrEqual(TERRAIN_ERROR + 1e-6);
        }
      }
      for (const face of geometry.faces) for (const p of face.points) {
        expect(p.x).toBeGreaterThanOrEqual(-2.00001); expect(p.x).toBeLessThanOrEqual(802.00001);
        expect(p.y).toBeGreaterThanOrEqual(-2.00001); expect(p.y).toBeLessThanOrEqual(602.00001);
      }
    }
  }
}, 15_000); // About a second alone; slower while the whole suite runs in parallel.

it('selects only the visible angular intervals on a large planet and retains local horizon curvature', () => {
  const profile = createSurfaceProfile(6.371e8, new Float64Array(65536));
  const camera = { center: { x: 0, y: 6.371e8 }, rotation: .32, scale: 20 };
  const body = { id: 'earth', name: 'Earth', radius: profile.referenceRadius, position: { x: 0, y: 0 }, surface: profile };
  const geometry = terrainGeometry(body, camera, 1200, 800);
  expect(geometry.sourcePoints).toBeLessThan(20);
  expect(geometry.edge.length).toBeGreaterThan(0);
  for (const p of geometry.boundary) {
    const theta = p.angle - Math.PI / 2;
    // Stable independent circle sagitta relative to the north point.
    const x = -profile.referenceRadius * Math.sin(theta), y = -2 * profile.referenceRadius * Math.sin(theta / 2) ** 2;
    const exact = project({ x, y }, { ...camera, center: { x: 0, y: 0 } }, 1200, 800);
    expect(Math.hypot(p.x - exact.x, p.y - exact.y)).toBeLessThan(.00001);
  }
  expect(terrainGeometry(body, { ...camera }, 1200, 800)).toBe(geometry);
  expect(terrainGeometry(body, { ...camera, rotation: .33 }, 1200, 800)).not.toBe(geometry);
});

it('draws actual ground when the whole viewport is below a crater floor or far outside the circle', () => {
  const body = { id: 'fixture', name: 'Fixture', radius: 160, position: { x: 0, y: 0 }, surface: profile };
  const underground = terrainGeometry(body, { center: { x: 0, y: 0 }, rotation: 0, scale: 1000 }, 800, 600);
  expect(underground.faces.some(f => f.points.length >= 3 && f.color[3] === 1)).toBe(true);
  const outside = terrainGeometry(body, { center: { x: 1e6, y: 1e6 }, rotation: .8, scale: 20 }, 800, 600);
  expect(outside.faces).toHaveLength(0);
  expect(outside.edge).toHaveLength(0);
});

it('keeps generated feature accents fixed in the body frame and changes cached geometry with appearance', () => {
  const surface = generateSurface({ radius: 160, surface: { kind: 'radial', generatorVersion: 1, seed: 12345,
    sampleCount: 2048, maxReliefMetres: 12, minFeatureWidthMetres: 4, orientationRadians: 0,
    mountainRangeCount: 2, craterCount: 18 } });
  const body = { id: 'moon', name: 'Moon', radius: 160, position: { x: 0, y: 0 }, surface };
  const camera = { center: { x: 0, y: 0 }, rotation: 0, scale: 1 };
  const a = terrainGeometry(body, camera, 800, 600);
  expect(a.accents.length).toBeGreaterThan(100);
  const moved = terrainGeometry({ ...body, position: { x: 1e12, y: -1e12 } },
    { ...camera, center: { x: 1e12, y: -1e12 } }, 800, 600);
  expect(moved).toBe(a);
  const changed = terrainGeometry({ ...body, color: '#aabbcc' }, camera, 800, 600);
  expect(changed).not.toBe(a);
  expect(changed.boundary).toEqual(a.boundary);
});

it('preserves exact coastline vertices and the independent land/sea envelope within half a pixel', () => {
  const samples = [-10, 15, -10, 15, -10, 15, -10, 15];
  const surface = createSurfaceProfile(100, samples, .27, 100);
  const body = { id: 'ocean', name: 'Ocean', radius: 100, position: { x: 0, y: 0 }, surface };
  for (const angle of [0, .27, .27 + Math.PI / 10, 2 * Math.PI - .001]) for (const scale of [.1, 2, 30, 1000]) {
    const phase = ((angle - .27) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) * 4 / Math.PI;
    const i = Math.floor(phase), t = phase - i;
    const r = Math.max(100, 100 + samples[i % 8]! * (1 - t) + samples[(i + 1) % 8]! * t);
    const camera = { center: { x: r * Math.cos(angle), y: r * Math.sin(angle) }, scale, rotation: .8 };
    const geometry = terrainGeometry(body, camera, 800, 600);
    for (let j = 1; j < geometry.boundary.length; j++) {
      const a = geometry.boundary[j - 1]!, b = geometry.boundary[j]!;
      // A simplification chord must never cross a material boundary.
      for (const coast of surface.coastAngles) for (const turn of [-1, 0, 1]) {
        expect(coast + turn * 2 * Math.PI > a.angle + 1e-12 && coast + turn * 2 * Math.PI < b.angle - 1e-12).toBe(false);
      }
      for (let k = 0; k <= 20; k++) {
        const theta = a.angle + (b.angle - a.angle) * k / 20;
        const u = ((theta - .27) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) * 4 / Math.PI;
        const i = Math.floor(u), t = u - i;
        const r = Math.max(100, 100 + samples[i % 8]! * (1 - t) + samples[(i + 1) % 8]! * t);
        const p = project({ x: r * Math.cos(theta), y: r * Math.sin(theta) }, camera, 800, 600);
        expect(distance(p, a, b)).toBeLessThan(TERRAIN_ERROR + 1e-6);
      }
    }
  }
});

it('retains zoom simplification on a maximum-resolution flat profile exactly at sea level', () => {
  const surface = createSurfaceProfile(160, new Float64Array(65536), 0, 160);
  expect(surface.hasWater).toBe(false);
  expect(surface.coastAngles).toHaveLength(0);
  const body = { id: 'flat', name: 'Flat', radius: 160, position: { x: 0, y: 0 }, surface };
  const geometry = terrainGeometry(body, { center: { x: 0, y: 0 }, scale: 1, rotation: 0 }, 800, 600);
  expect(geometry.boundary.length).toBeLessThan(128);
  const plateau = createSurfaceProfile(160, [-1, 0, 0, 0, -1], 0, 160);
  expect(plateau.coastAngles).toEqual([2 * Math.PI / 5, 6 * Math.PI / 5]);
});
