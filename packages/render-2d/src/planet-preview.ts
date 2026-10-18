import type { RenderBody } from '../../game-api/src/index';
import { DEFAULT_SHADERS, validateShaderPack, type ShaderPack } from './shaders';
import { startProgram, type PendingProgram } from './shader-program';
import { bodyUniformLocations, setBodyUniforms, type BodyUniformLocations } from './scene-bodies';
import { createNoiseTexture } from './noise-texture';

/** One planet drawn by the game's own scene shader, for the planet designer. The body's
 * `position` is ignored: it is centred and fills most of the canvas. */
export class PlanetPreview {
  private readonly gl: WebGL2RenderingContext;
  private program: WebGLProgram | undefined;
  private pending: PendingProgram | undefined;
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private body!: BodyUniformLocations;
  private resolution: WebGLUniformLocation | null = null;
  private count: WebGLUniformLocation | null = null;
  private noiseLoc: WebGLUniformLocation | null = null;
  private starsVisibleLoc: WebGLUniformLocation | null = null;
  private starDensityLoc: WebGLUniformLocation | null = null;
  /** Why the shader could not be used, once it has failed. */
  error: string | undefined;
  private readonly noise: WebGLTexture;

  constructor(private readonly canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) {
    // Kept so the picture can be saved as an image after it is drawn.
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('The planet preview needs WebGL 2.');
    this.gl = gl;
    // Only the scene pass, linked in the background so opening the designer never stalls.
    this.pending = startProgram(gl, validateShaderPack(shaders), 'scene');
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.noise = createNoiseTexture(gl);
  }

  /** False until the shader has finished compiling; drawing before then does nothing. */
  get ready(): boolean {
    if (this.program) return true;
    if (!this.pending?.ready()) return false;
    let program: WebGLProgram;
    try { program = this.pending.finish(); }
    catch (error) { this.error = error instanceof Error ? error.message : String(error); this.pending = undefined; return false; }
    this.pending = undefined;
    this.program = program;
    this.body = bodyUniformLocations(this.gl, program, 0);
    this.resolution = this.gl.getUniformLocation(program, 'u_resolution');
    this.count = this.gl.getUniformLocation(program, 'u_bodyCount');
    this.noiseLoc = this.gl.getUniformLocation(program, 'u_noise');
    this.starsVisibleLoc = this.gl.getUniformLocation(program, 'u_starsVisible');
    this.starDensityLoc = this.gl.getUniformLocation(program, 'u_starDensity');
    return true;
  }

  /** Draw `body` filling `fill` of the smaller canvas side. */
  draw(body: RenderBody, fill = 0.8): void {
    if (!this.ready) return;
    const { gl, canvas } = this;
    const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(this.program!);
    gl.uniform2f(this.resolution, width, height);
    gl.uniform1i(this.count, 1);
    gl.uniform1i(this.starsVisibleLoc, 1);
    gl.uniform1f(this.starDensityLoc, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.noise);
    gl.uniform1i(this.noiseLoc, 1);
    const center = { x: width / 2, y: height / 2 };
    setBodyUniforms(gl, this.body, body, center, Math.min(width, height) * fill / 2, center, { center, rotation: 0, scale: 1 });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.noise);
    this.pending?.cancel();
    if (this.program) gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
