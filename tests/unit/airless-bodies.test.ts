import { expect, it } from 'vitest';
import defaultUniverse from '../../games/space-sim/universes/sandbox/default/universe.json';
import solar from '../../games/space-sim/universes/astronomy/solar-system/universe.json';
import fullSolar from '../../games/space-sim/universes/astronomy/full-solar-system/universe.json';
import { setBodyUniforms, type BodyUniformLocations } from '../../modules/render-webgl/src/scene-bodies';
import { terrainGeometry as canvasTerrain } from '../../modules/render-canvas/src/terrain';
import { terrainGeometry as webglTerrain } from '../../modules/render-webgl/src/terrain';
import { createSurfaceProfile, querySurface } from '../../packages/sim-core/src/surface';

it('declares the bundled Moon and Parvus airless without removing atmospheric worlds', () => {
  for (const [universe, moonName] of [[defaultUniverse, 'Parvus'], [solar, 'Moon'], [fullSolar, 'Moon']] as const) {
    const systems: readonly { bodies: readonly { id: string; name: string; atmosphereColor?: string }[] }[] = universe.systems;
    const bodies = systems.flatMap(system => system.bodies);
    expect(bodies.find(body => body.name === moonName)?.atmosphereColor).toBe('#00000000');
    expect(bodies.find(body => body.id === (universe === defaultUniverse ? 'planet' : 'earth'))?.atmosphereColor).not.toBe('#00000000');
  }
});

it('keeps sunlight while passing zero atmospheric opacity to WebGL for explicit airless bodies', () => {
  const writes = new Map<unknown, unknown[]>();
  const gl = new Proxy({}, { get: () => (...args: unknown[]) => { writes.set(args[0], args.slice(1)); } }) as WebGL2RenderingContext;
  const locations = new Proxy({}, { get: (_, name) => name }) as BodyUniformLocations;
  const body = { id: 'moon', name: 'Moon', radius: 128, position: { x: 0, y: 0 }, atmosphereColor: '#00000000', sunDirection: { x: 1, y: 0 } };
  setBodyUniforms(gl, locations, body, body.position, 128, body.position, { center: body.position, rotation: 0, scale: 1 });
  expect(writes.get('atmosphere')).toEqual([0, 0, 0, 0]);
  expect(writes.get('sunDir')?.[0]).toBe(1);
  expect(Math.abs(writes.get('sunDir')?.[1] as number)).toBe(0);
});

it.each([canvasTerrain, webglTerrain])('omits airless terrain glow at the terminator while retaining terrain and atmospheric twilight', terrain => {
  const body = { id: 'moon', name: 'Moon', radius: 128, position: { x: 0, y: 0 }, surface: createSurfaceProfile(128, new Float64Array(64)),
    atmosphereColor: '#00000000', sunDirection: { x: 1, y: 0 } };
  const camera = { center: { x: 0, y: 128 }, rotation: 0, scale: 3 };
  const airless = terrain(body, camera, 800, 600, { querySurface });
  expect(airless.faces.length).toBeGreaterThan(0);
  expect(airless.faces.some(face => face.gradient?.color[3] === 0)).toBe(false);
  const atmosphere = terrain({ ...body, atmosphereColor: '#48cae480' }, camera, 800, 600, { querySurface });
  expect(atmosphere.faces.some(face => face.gradient?.color[3] === 0 && face.color[3] > 0)).toBe(true);
});
