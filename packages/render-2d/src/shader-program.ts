import { SHADER_PASSES, type ShaderPack, type ShaderPass } from './shaders';

export type ShaderPrograms = Record<ShaderPass, WebGLProgram>;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to allocate a shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`${type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment'} compilation failed:\n${log}`);
  }
  return shader;
}

/** Inspect once at load time. Reject incompatible inputs before they can break drawing. */
function checkInterface(gl: WebGL2RenderingContext, program: WebGLProgram, pass: ShaderPass): void {
  const uniforms: Record<string, number> = { u_resolution: gl.FLOAT_VEC2, u_time: gl.FLOAT };
  if (pass === 'scene') uniforms.u_bodyCount = gl.INT;
  else uniforms.u_style = gl.INT;
  if (pass === 'text') uniforms.u_tex = gl.SAMPLER_2D;
  const bodyTypes: Record<string, number> = {
    screenPos: gl.FLOAT_VEC2, horizonPoint: gl.FLOAT_VEC2, horizonNormal: gl.FLOAT_VEC2,
    radius: gl.FLOAT, color: gl.FLOAT_VEC3, accent: gl.FLOAT_VEC3, atmosphere: gl.FLOAT_VEC4, isStar: gl.INT,
  };
  if (gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS)) throw new Error('Uniform blocks are unsupported.');
  const uniformCount = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < uniformCount; i++) {
    const info = gl.getActiveUniform(program, i)!;
    const body = pass === 'scene' ? /^u_bodies\[([0-7])\]\.(\w+)$/.exec(info.name) : null;
    const expected = body ? bodyTypes[body[2]!] : uniforms[info.name];
    if (expected !== info.type || info.size !== 1) {
      throw new Error(`Unsupported uniform or type: ${info.name}. See the shader format documentation.`);
    }
  }
  const attributeCount = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < attributeCount; i++) {
    const info = gl.getActiveAttrib(program, i)!;
    const location = info.name === 'a_position' ? 0 : pass === 'text' && info.name === 'a_uv' ? 1 : -1;
    if (location < 0 || info.type !== gl.FLOAT_VEC2 || info.size !== 1 || gl.getAttribLocation(program, info.name) !== location) {
      throw new Error(`Unsupported attribute or location: ${info.name}. Use vec2 a_position at 0 and text vec2 a_uv at 1.`);
    }
  }
  if (gl.getFragDataLocation(program, 'fragColor') !== 0) throw new Error('Write the fragment output to vec4 fragColor at location 0.');
}

function link(gl: WebGL2RenderingContext, pack: ShaderPack, pass: ShaderPass): WebGLProgram {
  let vertex: WebGLShader | undefined;
  let fragment: WebGLShader | undefined;
  let program: WebGLProgram | null = null;
  let linked = false;
  try {
    vertex = compile(gl, gl.VERTEX_SHADER, pack.passes[pass].vertex);
    fragment = compile(gl, gl.FRAGMENT_SHADER, pack.passes[pass].fragment);
    program = gl.createProgram();
    if (!program) throw new Error('Unable to allocate a shader program.');
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    // Stable locations let every pack reuse the existing VAOs and GPU buffers.
    gl.bindAttribLocation(program, 0, 'a_position');
    gl.bindAttribLocation(program, 1, 'a_uv');
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`Link failed:\n${gl.getProgramInfoLog(program)}`);
    checkInterface(gl, program, pass);
    linked = true;
    return program;
  } catch (error) {
    throw new Error(`${pass}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    if (program && vertex) gl.detachShader(program, vertex);
    if (program && fragment) gl.detachShader(program, fragment);
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    if (program && !linked) gl.deleteProgram(program);
  }
}

/** Build every stage before committing; a failed load keeps the previous pack live. */
export function compileShaderPack(gl: WebGL2RenderingContext, pack: ShaderPack): ShaderPrograms {
  const programs: Partial<ShaderPrograms> = {};
  try {
    for (const pass of SHADER_PASSES) programs[pass] = link(gl, pack, pass);
    return programs as ShaderPrograms;
  } catch (error) {
    for (const program of Object.values(programs)) gl.deleteProgram(program);
    throw error;
  }
}

function privateProgram(gl: WebGL2RenderingContext, vertexSource: string, fragmentSource: string, label: string): WebGLProgram {
  const vertex = compile(gl, gl.VERTEX_SHADER, vertexSource);
  let fragment: WebGLShader | undefined;
  let program: WebGLProgram | null = null;
  let linked = false;
  try {
    fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    program = gl.createProgram();
    if (!program) throw new Error(`Unable to allocate ${label} shader.`);
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(`${label} link failed: ${gl.getProgramInfoLog(program)}`);
    linked = true;
    return program;
  } finally {
    if (program) { gl.detachShader(program, vertex); if (fragment) gl.detachShader(program, fragment); }
    gl.deleteShader(vertex); if (fragment) gl.deleteShader(fragment);
    if (program && !linked) gl.deleteProgram(program);
  }
}

/** Private CPU terrain pass. Deliberately outside the user-replaceable v1 pack ABI. */
export function compileTerrainProgram(gl: WebGL2RenderingContext): WebGLProgram {
  return privateProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec2 a_position;
    layout(location=1) in vec4 a_color;
    uniform vec2 u_resolution;
    out vec4 v_color;
    void main() {
      vec2 p = a_position / u_resolution * 2.0 - 1.0;
      gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
      v_color = a_color;
    }`, `#version 300 es
      precision highp float;
      in vec4 v_color;
      out vec4 fragColor;
      void main() { fragColor = v_color; }`, 'Terrain');
}

/** Private text pass for module overlays: exact colors whatever shader pack is loaded.
 * Shares the text VAO layout (a_position at 0, a_uv at 1). Compiled on first use. */
export function compileOverlayTextProgram(gl: WebGL2RenderingContext): WebGLProgram {
  return privateProgram(gl, `#version 300 es
    precision highp float;
    layout(location=0) in vec2 a_position;
    layout(location=1) in vec2 a_uv;
    uniform vec2 u_resolution;
    out vec2 v_uv;
    void main() {
      v_uv = a_uv;
      vec2 p = a_position / u_resolution * 2.0 - 1.0;
      gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
    }`, `#version 300 es
      precision mediump float;
      in vec2 v_uv;
      uniform sampler2D u_tex;
      uniform vec4 u_color;
      out vec4 fragColor;
      void main() { fragColor = vec4(u_color.rgb, u_color.a * texture(u_tex, v_uv).a); }`, 'Overlay text');
}
