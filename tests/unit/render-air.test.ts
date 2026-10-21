import { describe, expect, it } from 'vitest';
import { AIR_SEGMENTS, AirMesh, airCloudCoverage, type RenderAir, type RenderBody } from '../../packages/game-api/src/index';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import { terrainGeometry } from '../../packages/render-2d/src/terrain';

const air: RenderAir = { mode: 'clouds', heightMetres: 60, cloudAltitudeMetres: 18, cloudThicknessMetres: 4,
  color: [.4, .7, .9], opacity: .12, phaseRadians: .2 };
const body: RenderBody = { id: 'fixture', name: '', radius: 1000, position: { x: 0, y: 0 }, air };
const camera = { center: { x: 0, y: 0 }, rotation: 0, scale: .2 };

describe('independent radial air mesh', () => {
  it('replaces the near-view skybox by lighting, then fades with altitude and overview zoom', () => {
    const mesh = new AirMesh(), near = { center: {x:0,y:1002}, rotation:0, scale:10 };
    mesh.update({ ...body, air: { ...air, sunDirection: {x:0,y:1} } }, near, 800, 600, 'far');
    expect(mesh.vertices[5]).toBe(1); const dayBlue = mesh.vertices[4]!;
    mesh.update({ ...body, air: { ...air, sunDirection: {x:0,y:-1} } }, near, 800, 600, 'far');
    expect(mesh.vertices[5]).toBe(1); expect(mesh.vertices[4]!).toBeLessThan(dayBlue / 5);
    mesh.update(body, camera, 800, 600, 'far'); expect(mesh.vertices[5]!).toBeLessThan(1);
    mesh.update(body, { ...near, center:{x:0,y:1061} }, 800, 600, 'far');
    if(mesh.length)expect(mesh.vertices[5]!).toBeLessThan(1);
    mesh.update({ ...body, air: { ...air, mode:'off' } }, near, 800, 600, 'far'); expect(mesh.length).toBe(0);
  });

  it('keeps coverage periodic and body-fixed with no camera or cell-resolution input', () => {
    for (let a = -7; a < 7; a += .013) {
      const value = airCloudCoverage(a, .2);
      expect(value).toBeGreaterThanOrEqual(0); expect(value).toBeLessThanOrEqual(1);
      expect(airCloudCoverage(a + Math.PI * 2, .2)).toBeCloseTo(value, 10);
      expect(airCloudCoverage(a + .7, .9)).toBeCloseTo(value, 10);
    }
  });

  it('retains clear gaps between cloud patches around the complete shell', () => {
    let clear = 0, dense = 0, total = 0;
    for (let a = -Math.PI; a < Math.PI; a += .001) {
      const coverage = airCloudCoverage(a, .2); total++;
      if (coverage === 0) clear++; if (coverage > .5) dense++;
    }
    expect(clear / total).toBeGreaterThan(.35); expect(dense / total).toBeGreaterThan(.1);
  });

  it('reuses capped buffers, suppresses off/invalid/star/underground and separates air/cloud geometry', () => {
    const mesh = new AirMesh(), storage = mesh.vertices;
    mesh.update(body, camera, 800, 600, 'near'); const clouds = mesh.length;
    expect(clouds).toBeGreaterThan(0); expect(mesh.length).toBeLessThanOrEqual(AIR_SEGMENTS * 6 * 36);
    mesh.update({ ...body, air: { ...air, mode: 'air' } }, camera, 800, 600, 'near');
    expect(mesh.length).toBeLessThan(clouds);
    for (const changed of [{ ...air, mode: 'off' as const }, { ...air, phaseRadians: NaN }, { ...air, opacity: 2 }]) {
      mesh.update({ ...body, air: changed }, camera, 800, 600, 'near'); expect(mesh.length).toBe(0);
    }
    mesh.update({ ...body, surfaceFeatures: 'star' }, camera, 800, 600, 'near'); expect(mesh.length).toBe(0);
    mesh.update(body, { ...camera, scale: 10 }, 800, 600, 'near'); expect(mesh.length).toBe(0);
    mesh.update(body, { ...camera, center: { x: 1e6, y: 1e6 } }, 800, 600, 'far'); expect(mesh.length).toBe(0);
    expect(mesh.vertices).toBe(storage);
  });

  it('preserves the shell through rotation, large system origins, ground/shell crossing and close zoom', () => {
    const mesh = new AirMesh();
    for (const radius of [1024, 2048, 4096]) for (const scale of [.08, 1, 50]) for (const spin of [0, .7, 2]) {
      const b = { ...body, radius, air: { ...air, heightMetres: radius * .06,
        cloudAltitudeMetres: radius * .018, cloudThicknessMetres: radius * .004 }, rotation: spin };
      const c = { center: { x: radius * Math.cos(spin), y: radius * Math.sin(spin) }, rotation: -spin, scale };
      mesh.update(b, c, 800, 600, 'near');
      expect(mesh.length).toBeGreaterThan(0);
      const original = mesh.vertices.slice(0, mesh.length);
      mesh.update({ ...b, position: { x: 1e10, y: -2e10 } },
        { ...c, center: { x: c.center.x + 1e10, y: c.center.y - 2e10 } }, 800, 600, 'near');
      expect(mesh.length).toBe(original.length);
      for (let i = 0; i < mesh.length; i += 6) {
        expect(mesh.vertices[i]).toBeCloseTo(original[i]!, 2);
        expect(mesh.vertices[i + 1]).toBeCloseTo(original[i + 1]!, 2);
      }
      const cloudRadius = radius * 1.018;
      mesh.update(b, { ...c, center: { x: cloudRadius * Math.cos(spin), y: cloudRadius * Math.sin(spin) } }, 800, 600, 'near');
      expect(mesh.length).toBeGreaterThan(0); expect(mesh.vertices.subarray(0, mesh.length).every(Number.isFinite)).toBe(true);
    }
  });

  it('uses supplied sun consistently while keeping canonical geometry/ground colors unchanged', () => {
    const surface = createSurfaceProfile(1000, [0, 20, -10, 3, 0, -8, 12, 4]);
    const b = { ...body, surface, atmosphereColor: '#6ab4ec80' };
    const before = terrainGeometry({ ...b, air: undefined }, camera, 800, 600);
    const after = terrainGeometry(b, camera, 800, 600);
    expect(after.boundary).toEqual(before.boundary); expect(after.groundClip).toEqual(before.groundClip);
    expect(after.faces.filter(f => f.color[3] === 1)).toEqual(before.faces.filter(f => f.color[3] === 1));
    expect(after.faces.filter(f => f.color[3] !== 1)).toHaveLength(0);
    const mesh = new AirMesh();
    mesh.update({ ...body, air: { ...air, sunDirection: { x: 0, y: 1 } } }, camera, 800, 600, 'near');
    let north = 0, south = 0;
    for (let i = 0; i < mesh.length; i += 6) {
      if (mesh.vertices[i + 1]! < 120) north = Math.max(north, mesh.vertices[i + 5]!);
      if (mesh.vertices[i + 1]! > 480) south = Math.max(south, mesh.vertices[i + 5]!);
    }
    expect(north).toBeGreaterThan(south * 3);
  });
});
