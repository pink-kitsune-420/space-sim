/** Bundled only by the browser test; no test hooks or assets ship in the app. */
import { CanvasRenderer, WebGLRenderer, DEFAULT_SHADERS, project, type Camera, type RenderBody, type Renderer } from '../../packages/render-2d/src/index';
import { createSurfaceProfile, generateSurface, querySurface, initialState, type SurfaceProfile } from '../../packages/sim-core/src/index';
import { terrainGeometry } from '../../packages/render-2d/src/terrain';
import examples from '../../games/space-sim/universes/sandbox/terrain/universe.json';

let renderer: Renderer | undefined;
const profiles = new Map<string, SurfaceProfile>();
export function draw(options: { renderer: 'canvas' | 'webgl'; world: 'planet' | 'moon' | 'large' | 'ocean' | 'large-ocean'; angle: number;
  scale: number; rotation: number; orbit?: boolean; custom?: boolean; offset?: number }) {
  renderer?.dispose?.();
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width:800px;height:600px;display:block';
  canvas.id = 'terrain';
  document.body.replaceChildren(canvas);
  let profile = profiles.get(options.world);
  if (!profile) {
    const definition = examples.systems[options.world === 'planet' ? 0 : 1]!.bodies[0]!;
    profile = options.world === 'ocean' ? createSurfaceProfile(100, [-10, 15, -10, 15, -10, 15, -10, 15], 0, 100)
      : options.world === 'large-ocean' ? createSurfaceProfile(6.371e8, [-2e4, 2e4, -1e4, 1e4, -3e4, 2e4, -1e4, 0], 0, 6.371e8)
      : options.world === 'large' ? createSurfaceProfile(6.371e8, [0, 2e4, -1e4, 1e4, 0, -3e4, 2e4, 0])
      : generateSurface(definition as Parameters<typeof generateSurface>[0]);
    profiles.set(options.world, profile);
  }
  const radius = querySurface(profile, options.angle).firstContactRadius;
  const position = { x: options.offset ?? 0, y: -(options.offset ?? 0) };
  const camera: Camera = { center: options.orbit ? position : {
    x: position.x + radius * Math.cos(options.angle), y: position.y + radius * Math.sin(options.angle),
  }, scale: options.scale, rotation: options.rotation };
  const body: RenderBody & { surface: SurfaceProfile } = { id: 'terrain', name: 'Terrain',
    position, radius: profile.referenceRadius, surface: profile, color: '#a87954', accentColor: '#e0bb8a', atmosphereColor: '#00000000' };
  const geometry = terrainGeometry(body, camera, 800, 600);
  const pack = options.custom ? { ...DEFAULT_SHADERS, name: 'Hostile legacy pack', passes: {
    ...DEFAULT_SHADERS.passes,
    scene: { ...DEFAULT_SHADERS.passes.scene, fragment: '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(0.2,0.4,0.6,1.0);}' },
    vector: { ...DEFAULT_SHADERS.passes.vector, fragment: '#version 300 es\nprecision highp float;\nout vec4 fragColor;\nvoid main(){fragColor=vec4(0.0);}' },
  } } : DEFAULT_SHADERS;
  renderer = options.renderer === 'canvas' ? new CanvasRenderer(canvas) : new WebGLRenderer(canvas, pack);
  renderer.draw({ theme: { highQuality: false, starsVisible: false, nebulaVisible: false, galaxiesVisible: false, gridEnabled: false, backdropStyle: 'void' }, state: initialState(), path: [], pathClosed: false, engine: false, camera,
    bodies: [body], shipWorldPosition: { x: 1e20, y: 1e20 }, padPosition: { x: 1e20, y: 1e20 } });
  const dpr = canvas.width / 800;
  const gl = options.renderer === 'webgl' ? canvas.getContext('webgl2')! : null;
  const ctx = options.renderer === 'canvas' ? canvas.getContext('2d')! : null;
  const pixels = gl ? new Uint8Array(canvas.width * canvas.height * 4) : ctx!.getImageData(0, 0, canvas.width, canvas.height).data;
  if (gl) gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels as Uint8Array);
  const pixel = (x: number, y: number) => {
    const px = Math.floor(x * dpr), py = gl ? canvas.height - 1 - Math.floor(y * dpr) : Math.floor(y * dpr);
    return Array.from(pixels.slice((py * canvas.width + px) * 4, (py * canvas.width + px) * 4 + 4));
  };
  const probes: { x: number; y: number; inside: number[]; outside: number[] }[] = [];
  // Probe independent authoritative positions, rather than vertices from render geometry.
  for (let j = 0; j < 1024; j++) {
    const angle = j * 2 * Math.PI / 1024;
    const r = querySurface(profile, angle).firstContactRadius;
    const toScreen = (radius: number) => project({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) },
      { ...camera, center: { x: camera.center.x - position.x, y: camera.center.y - position.y } }, 800, 600);
    const p = toScreen(r), a = toScreen(r - 4 / options.scale), b = toScreen(r + 4 / options.scale);
    if ([p, a, b].every(p => p.x > 10 && p.x < 790 && p.y > 10 && p.y < 570)) {
      probes.push({ x: p.x, y: p.y, inside: pixel(a.x, a.y), outside: pixel(b.x, b.y) });
    }
  }
  // In extreme close views uniform whole-circle angles can miss the visible section.
  if (!probes.length && !options.orbit) {
    const toScreen = (r: number) => project({ x: r * Math.cos(options.angle), y: r * Math.sin(options.angle) },
      { ...camera, center: { x: camera.center.x - position.x, y: camera.center.y - position.y } }, 800, 600);
    const a = toScreen(radius - 4 / options.scale), b = toScreen(radius + 4 / options.scale);
    probes.push({ x: 400, y: 300, inside: pixel(a.x, a.y), outside: pixel(b.x, b.y) });
  }
  return { probes, error: gl?.getError() ?? 0, vertices: geometry.boundary.length, source: geometry.sourcePoints,
    pixels: [canvas.width, canvas.height], center: pixel(400, 300) };
}
