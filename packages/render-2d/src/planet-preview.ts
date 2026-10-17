import type { RenderBody } from '../../game-api/src/index';
import { DEFAULT_SHADERS, type ShaderPack } from './shaders';
import { compileShaderPack } from './shader-program';
import { bodyUniformLocations, setBodyUniforms, type BodyUniformLocations } from './scene-bodies';

/** One planet drawn by the game's own scene shader, for the planet designer. The body's
 * `position` is ignored: it is centred and fills most of the canvas. */
export class PlanetPreview {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly others: readonly WebGLProgram[];
  private readonly vao: WebGLVertexArrayObject;
  private readonly buffer: WebGLBuffer;
  private readonly body: BodyUniformLocations;
  private readonly resolution: WebGLUniformLocation | null;
  private readonly count: WebGLUniformLocation | null;

  constructor(private readonly canvas: HTMLCanvasElement, shaders: ShaderPack = DEFAULT_SHADERS) {
    // Kept so the picture can be saved as an image after it is drawn.
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error('The planet preview needs WebGL 2.');
    this.gl = gl;
    const programs = compileShaderPack(gl, shaders);
    this.program = programs.scene;
    this.others = [programs.vector, programs.text];
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    this.buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.body = bodyUniformLocations(gl, this.program, 0);
    this.resolution = gl.getUniformLocation(this.program, 'u_resolution');
    this.count = gl.getUniformLocation(this.program, 'u_bodyCount');
  }

  /** Draw `body` filling `fill` of the smaller canvas side. */
  draw(body: RenderBody, fill = 0.8): void {
    const { gl, canvas } = this;
    const width = canvas.clientWidth || canvas.width, height = canvas.clientHeight || canvas.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(width * dpr), pixelHeight = Math.round(height * dpr);
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    gl.viewport(0, 0, pixelWidth, pixelHeight);
    gl.useProgram(this.program);
    gl.uniform2f(this.resolution, width, height);
    gl.uniform1i(this.count, 1);
    const center = { x: width / 2, y: height / 2 };
    setBodyUniforms(gl, this.body, body, center, Math.min(width, height) * fill / 2, center, { center, rotation: 0, scale: 1 });
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const { gl } = this;
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.buffer);
    for (const program of [this.program, ...this.others]) gl.deleteProgram(program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
