/** First-party MIT renderer helper. Immutable summary resources, independent of tile caches. */
import type { RenderOverviewSurface, SurfaceProfile } from '@space-sim/game-api';
import type { TerrainGeometry } from './terrain';
import { compileSurfaceAtlasProgram } from './shader-program';

type Ribbon = NonNullable<TerrainGeometry['ribbonMaterial']>;
interface Atlas {
  readonly surface: RenderOverviewSurface;
  readonly profile: SurfaceProfile;
  readonly materials: WebGLTexture;
  readonly heights: WebGLTexture;
  readonly atlasWidth: number;
  readonly heightWidth: number;
  readonly palette: Float32Array;
  readonly bytes: number;
}
/** At most two immutable body summaries, <=640KiB logical GPU storage total.
 * Temporary height upload is <=256KiB and is not retained. Eviction/disposal frees
 * both textures. No camera history, fine cells, module shader ABI or simulation state. */
export class SurfaceAtlasPass {
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<string, WebGLUniformLocation | null> = {};
  private readonly atlases = new Map<RenderOverviewSurface, Atlas>();
  private disposed = false;
  constructor(private readonly gl: WebGL2RenderingContext) {
    this.program = compileSurfaceAtlasProgram(gl);
    for (const name of ['resolution', 'scale', 'axes', 'atlas', 'heights', 'atlasWidth', 'heightWidth',
      'sectors', 'rows', 'samples', 'depth', 'palette[0]', 'cameraRadius', 'referenceOffset', 'angles', 'sharpness'])
      this.uniforms[name] = gl.getUniformLocation(this.program, 'u_' + name);
  }
  get resourceBytes(): number { let bytes = 0; for (const a of this.atlases.values()) bytes += a.bytes; return bytes; }
  get resourceCount(): number { return this.atlases.size; }

  prepare(ribbon: Ribbon): Atlas | undefined {
    if (this.disposed) return;
    const { surface: s, profile: p } = ribbon;
    if (p.hasWater && !p.planet || !Number.isInteger(s.sectors) || s.sectors < 1 || s.sectors > 8192
      || !Number.isInteger(s.rows) || s.rows < 1 || s.rows > 8 || !(s.depthMetres > 0)
      || s.samples.length !== s.sectors * s.rows || s.palette.length !== 3
      || !Number.isInteger(p.sampleCount) || p.sampleCount < 2 || p.sampleCount > 65536) return;
    let atlas = this.atlases.get(s);
    if (atlas?.profile === p) {
      this.atlases.delete(s); this.atlases.set(s, atlas); return atlas;
    }
    if (atlas) { this.free(atlas); this.atlases.delete(s); }
    // Evict before allocation, so transient GPU ownership also stays bounded.
    if (this.atlases.size === 2) {
      const oldest = this.atlases.entries().next().value!;
      this.free(oldest[1]); this.atlases.delete(oldest[0]);
    }
    for (const pair of s.samples) if ((pair & 3) > 2 || ((pair >> 2) & 3) > 2) return;
    const palette = new Float32Array(9);
    for (let i = 0; i < 3; i++) for (let c = 0; c < 3; c++) {
      const value = s.palette[i]![c]; if (typeof value !== 'number' || !Number.isFinite(value)) return;
      palette[i * 3 + c] = value;
    }
    const atlasWidth = Math.min(1024, s.sectors), heightWidth = Math.min(1024, p.sampleCount);
    if (s.samples.length % atlasWidth || p.sampleCount % heightWidth) return;
    const heights = new Float32Array(p.sampleCount);
    for (let i = 0; i < heights.length; i++) {
      heights[i] = p.sampleElevation(i); if (!Number.isFinite(heights[i])) return;
    }
    const gl = this.gl, materialTexture = gl.createTexture(), heightTexture = gl.createTexture();
    if (!materialTexture || !heightTexture) {
      if (materialTexture) gl.deleteTexture(materialTexture);
      if (heightTexture) gl.deleteTexture(heightTexture);
      throw new Error('Unable to allocate surface summary textures');
    }
    const alignment = gl.getParameter(gl.UNPACK_ALIGNMENT) as number;
    try {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      const configure = (texture: WebGLTexture, unit: number) => {
        gl.activeTexture(unit); gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      };
      configure(materialTexture, gl.TEXTURE2);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, atlasWidth, s.samples.length / atlasWidth, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, s.samples);
      configure(heightTexture, gl.TEXTURE3);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, heightWidth, heights.length / heightWidth, 0, gl.RED, gl.FLOAT, heights);
      atlas = { surface: s, profile: p, materials: materialTexture, heights: heightTexture, atlasWidth, heightWidth, palette,
        bytes: s.samples.byteLength + heights.byteLength };
      this.atlases.set(s, atlas);
      return atlas;
    } catch (error) {
      gl.deleteTexture(materialTexture); gl.deleteTexture(heightTexture); throw error;
    } finally { gl.pixelStorei(gl.UNPACK_ALIGNMENT, alignment); gl.activeTexture(gl.TEXTURE0); }
  }

  /** Uses the caller's terrain VAO/buffer; one batch, no warm content uploads. */
  draw(ribbon: Ribbon, atlas: Atlas, width: number, height: number, first: number, count: number): void {
    const gl = this.gl, u = this.uniforms, { camera, origin, profile: p, surface: s } = ribbon;
    const x = camera.center.x - origin.x, y = camera.center.y - origin.y;
    const radius = Math.hypot(x, y), angle = Math.atan2(y, x), axes = angle + camera.rotation;
    gl.useProgram(this.program);
    gl.uniform2f(u.resolution!, width, height); gl.uniform1f(u.scale!, camera.scale);
    gl.uniform2f(u.axes!, Math.cos(axes), Math.sin(axes));
    gl.uniform1f(u.cameraRadius!, radius); gl.uniform1f(u.referenceOffset!, p.referenceRadius - radius);
    gl.uniform2f(u.angles!, angle / (2 * Math.PI) * s.sectors, (angle - p.orientationRadians) / (2 * Math.PI) * p.sampleCount);
    gl.uniform1f(u.sharpness!, ribbon.sharpness); gl.uniform1f(u.depth!, s.depthMetres);
    gl.uniform1i(u.sectors!, s.sectors); gl.uniform1i(u.rows!, s.rows); gl.uniform1i(u.samples!, p.sampleCount);
    gl.uniform1i(u.atlasWidth!, atlas.atlasWidth); gl.uniform1i(u.heightWidth!, atlas.heightWidth);
    gl.uniform3fv(u['palette[0]']!, atlas.palette);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, atlas.materials); gl.uniform1i(u.atlas!, 2);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, atlas.heights); gl.uniform1i(u.heights!, 3);
    gl.drawArrays(gl.TRIANGLES, first, count); gl.activeTexture(gl.TEXTURE0);
  }
  private free(atlas: Atlas): void { this.gl.deleteTexture(atlas.materials); this.gl.deleteTexture(atlas.heights); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const atlas of this.atlases.values()) this.free(atlas);
    this.atlases.clear(); this.gl.deleteProgram(this.program);
  }
}
