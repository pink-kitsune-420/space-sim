import { expect, it, vi } from 'vitest';
import * as shaders from '../../modules/render-webgl/src/shader-program';
import { SurfaceAtlasPass } from '../../modules/render-webgl/src/surface-atlas';
import { createSurfaceProfile } from '../../packages/sim-core/src/surface';
import type { RenderOverviewSurface } from '../../packages/game-api/src/index';

it('bounds immutable summary textures, uploads only cold content, evicts and disposes independent resources', () => {
  const compile = vi.spyOn(shaders, 'compileSurfaceAtlasProgram').mockReturnValue({} as WebGLProgram);
  const live = new Set<object>(); let peak = 0, uploads = 0, programsFreed = 0;
  const gl = { createTexture() { const t = {}; live.add(t); peak = Math.max(peak, live.size); return t; },
    deleteTexture(t: object) { expect(live.delete(t)).toBe(true); }, deleteProgram() { programsFreed++; },
    getUniformLocation() { return null; }, getParameter() { return 4; }, pixelStorei() {}, activeTexture() {},
    bindTexture() {}, texParameteri() {}, texImage2D() { uploads++; },
  } as unknown as WebGL2RenderingContext;
  const pass = new SurfaceAtlasPass(gl);
  const profile = createSurfaceProfile(6.371e6, new Float64Array(65536));
  const make = (): RenderOverviewSurface => ({ sectors: 8192, rows: 8, depthMetres: 16,
    samples: new Uint8Array(65536).fill(5), levels: [], palette: [[0, 0, 0], [.2, .3, .4], [1, 1, 1]] });
  const ribbon = (surface: RenderOverviewSurface) => ({ surface, profile, camera: { center: { x: 0, y: 6.371e6 }, scale: 1, rotation: 0 },
    origin: { x: 0, y: 0 }, sharpness: 1 });
  try {
    const a = ribbon(make()), b = ribbon(make()), c = ribbon(make());
    const first = pass.prepare(a); expect(first).toBeDefined();
    for (let i = 0; i < 500; i++) expect(pass.prepare(a)).toBe(first);
    expect(uploads).toBe(2); expect(pass.resourceBytes).toBe(320 * 1024);
    pass.prepare(b); expect(pass.resourceBytes).toBe(640 * 1024); expect(pass.resourceCount).toBe(2);
    pass.prepare(c); expect(pass.resourceBytes).toBe(640 * 1024); expect(pass.resourceCount).toBe(2);
    expect(peak).toBe(4); expect(live.size).toBe(4); expect(uploads).toBe(6);
    expect(pass.prepare(ribbon({ ...make(), samples: new Uint8Array(1) }))).toBeUndefined();
    pass.dispose(); pass.dispose(); expect(live.size).toBe(0); expect(programsFreed).toBe(1);
    expect(pass.prepare(a)).toBeUndefined(); expect(pass.resourceBytes).toBe(0);
  } finally { pass.dispose(); compile.mockRestore(); }
});
