import type { Camera, RenderBody, RenderGeometry, RenderMaterial, RenderPostEffect, ShaderEffects } from '@space-sim/game-api';
import { createProjector } from '@space-sim/game-api';
import { privateProgram } from './shader-program';
import { terrainGeometry } from './terrain';

const QUAD = `#version 300 es
layout(location=0) in vec2 a_position;
out vec2 v_uv;
void main(){v_uv=(a_position+1.0)*0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
const HEADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 fragColor;
uniform vec2 u_resolution;
uniform float u_time;
`;
const COPY = `${HEADER}uniform sampler2D u_scene;
void main(){fragColor=texture(u_scene,v_uv);}`;
const MATERIAL = `uniform vec2 u_center;
uniform float u_radius;
uniform float u_radiusMetres;
uniform float u_rotation;
uniform vec2 u_horizon;
uniform vec2 u_normal;
uniform int u_hasSurface;
`;
const MATERIAL_MAIN = `void main(){
 vec2 pixel=vec2(v_uv.x,1.0-v_uv.y)*u_resolution;
 vec2 delta=pixel-u_center;
 if(u_hasSurface==0){
  if(u_radius>2048.0){vec2 q=pixel-u_horizon;if(dot(q,q)+2.0*u_radius*dot(q,u_normal)>0.0)discard;}
  else if(dot(delta,delta)>u_radius*u_radius)discard;
 }
 vec2 p=vec2(delta.x,-delta.y)/max(u_radius,0.000001);
 float c=cos(u_rotation),s=sin(u_rotation);
 fragColor=material(vec2(c*p.x+s*p.y,-s*p.x+c*p.y));
}`;
const POST = 'uniform sampler2D u_scene;\nuniform vec2 u_sourceResolution;\n';
const POST_MAIN = 'void main(){fragColor=effect(v_uv,texture(u_scene,v_uv));}';
interface Program<T> { readonly definition: T; readonly program: WebGLProgram; readonly uniforms: ReadonlyMap<string, WebGLUniformLocation | null>; readonly values: readonly {readonly location: WebGLUniformLocation | null; readonly value: number}[] }
interface Target { readonly framebuffer: WebGLFramebuffer; readonly texture: WebGLTexture; readonly stencil?: WebGLRenderbuffer; width: number; height: number }
const NAME = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+\/[a-z][a-z0-9-]{0,31}$/;
function uniforms(raw: Readonly<Record<string, number>>, prefix: string): Readonly<Record<string, number>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length > 64) throw new Error('At most 64 float effect uniforms');
  const checked: Record<string, number> = Object.create(null);
  for (const [name, value] of Object.entries(raw)) {
    if (!new RegExp(`^${prefix}_[A-Za-z][A-Za-z0-9_]*$`).test(name) || typeof value !== 'number' || !Number.isFinite(Math.fround(value))) throw new Error('Invalid effect uniform name or float32 value');
    checked[name] = value;
  }
  return Object.freeze(checked);
}
function source(raw: string): string {
  if (typeof raw !== 'string' || !raw.trim() || new TextEncoder().encode(raw).length > 256 * 1024) throw new Error('Effect source must contain at most 256 KiB');
  return raw;
}
/** Viewer-only effects. Idle/default rendering allocates no effects targets or programs. */
export class Effects implements ShaderEffects {
  private materials: readonly Program<RenderMaterial>[] = [];
  private post: readonly Program<RenderPostEffect>[] = [];
  private bodies = new Map<string, Program<RenderMaterial>>();
  private copy?: WebGLProgram;
  private mask?: WebGLProgram;
  private copyScene: WebGLUniformLocation | null = null;
  private maskResolution: WebGLUniformLocation | null = null;
  private vao?: WebGLVertexArrayObject;
  private buffer?: WebGLBuffer;
  private maskVao?: WebGLVertexArrayObject;
  private maskBuffer?: WebGLBuffer;
  private maskVertices = new Float32Array(0);
  private targets = new Map<number, Target>();
  private width = 0; private height = 0; private disposed = false;
  constructor(private readonly gl: WebGL2RenderingContext) {}
  configure(rawMaterials: readonly RenderMaterial[], rawPost: readonly RenderPostEffect[]): void {
    if (this.disposed) throw new Error('Shader effects disposed');
    if (!Array.isArray(rawMaterials) || rawMaterials.length > 8 || !Array.isArray(rawPost) || rawPost.length > 4) throw new Error('At most eight materials and four post effects');
    const ids = new Set<string>(), bodyIds = new Set<string>();
    const identity = (id: string) => { if (typeof id !== 'string' || !NAME.test(id) || ids.has(id)) throw new Error('Invalid or duplicate effect ID'); ids.add(id); };
    const materials = rawMaterials.map(raw => {
      identity(raw.id);
      if (!Array.isArray(raw.bodyIds) || raw.bodyIds.length > 256) throw new Error('At most 256 material bodies');
      for (const id of raw.bodyIds) { if (typeof id !== 'string' || !id || id.length > 256 || bodyIds.has(id)) throw new Error('Conflicting or invalid material body'); bodyIds.add(id); }
      return Object.freeze({ id: raw.id, bodyIds: Object.freeze([...raw.bodyIds]), fragment: source(raw.fragment), uniforms: uniforms(raw.uniforms, 'm') });
    });
    const pending = new Map(rawPost.map(raw => {
      identity(raw.id);
      if (!Array.isArray(raw.after) || raw.after.length > 4 || new Set(raw.after).size !== raw.after.length || (raw.scale !== 1 && raw.scale !== .5)) throw new Error('Invalid post-effect order/scale');
      return [raw.id, Object.freeze({ id: raw.id, fragment: source(raw.fragment), uniforms: uniforms(raw.uniforms, 'p'), after: Object.freeze([...raw.after]), scale: raw.scale })];
    }));
    for (const definition of pending.values()) for (const id of definition.after) if (!pending.has(id)) throw new Error('Missing post-effect dependency');
    const post: RenderPostEffect[] = [];
    while (pending.size) {
      const id = [...pending.keys()].sort().find(id => pending.get(id)!.after.every(dep => !pending.has(dep)));
      if (!id) throw new Error('Post-effect ordering cycle'); post.push(pending.get(id)!); pending.delete(id);
    }
    const gl = this.gl, owned: WebGLProgram[] = [];
    const compile = <T extends RenderMaterial | RenderPostEffect>(definition: T, material: boolean): Program<T> => {
      const declarations = Object.keys(definition.uniforms).map(name => `uniform float ${name};`).join('\n');
      const fragment = HEADER + (material ? MATERIAL : POST) + declarations + '\n' + definition.fragment + '\n' + (material ? MATERIAL_MAIN : POST_MAIN);
      const program = privateProgram(gl, QUAD, fragment, definition.id); owned.push(program);
      const allowed = new Map<string, number>([['u_resolution', gl.FLOAT_VEC2], ['u_time', gl.FLOAT], ...Object.keys(definition.uniforms).map(name => [name, gl.FLOAT] as [string, number])]);
      if (material) for (const [name, type] of [['u_center', gl.FLOAT_VEC2], ['u_radius', gl.FLOAT], ['u_radiusMetres', gl.FLOAT], ['u_rotation', gl.FLOAT], ['u_horizon', gl.FLOAT_VEC2], ['u_normal', gl.FLOAT_VEC2], ['u_hasSurface', gl.INT]] as const) allowed.set(name, type);
      else { allowed.set('u_scene', gl.SAMPLER_2D); allowed.set('u_sourceResolution', gl.FLOAT_VEC2); }
      if (gl.getProgramParameter(program, gl.ACTIVE_UNIFORM_BLOCKS)) throw new Error('Effect uniform blocks are unsupported');
      const locations = new Map<string, WebGLUniformLocation | null>();
      for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
        const info = gl.getActiveUniform(program, i)!;
        if (info.size !== 1 || allowed.get(info.name) !== info.type) throw new Error(`Unsupported effect uniform ${info.name}`);
      }
      for (const name of allowed.keys()) locations.set(name, gl.getUniformLocation(program, name));
      return { definition, program, uniforms: locations, values: Object.entries(definition.uniforms).map(([name,value]) => ({location:locations.get(name) ?? null,value})) };
    };
    let compiledMaterials: Program<RenderMaterial>[], compiledPost: Program<RenderPostEffect>[];
    let copy: WebGLProgram | undefined, mask: WebGLProgram | undefined;
    try {
      compiledMaterials = materials.map(definition => compile(definition, true)); compiledPost = post.map(definition => compile(definition, false));
      if (materials.length || post.length) { copy = privateProgram(gl, QUAD, COPY, 'Effect copy'); owned.push(copy); }
      if (materials.length) {
        mask = privateProgram(gl, `#version 300 es
          layout(location=0) in vec2 a_position;uniform vec2 u_resolution;
          void main(){vec2 p=a_position/u_resolution*2.0-1.0;gl_Position=vec4(p.x,-p.y,0.0,1.0);}`,
          '#version 300 es\nprecision highp float;out vec4 fragColor;void main(){fragColor=vec4(0.0);}', 'Terrain material mask'); owned.push(mask);
      }
    } catch (error) { for (const program of owned) gl.deleteProgram(program); throw error; }
    this.release(); this.materials = compiledMaterials; this.post = compiledPost; this.copy = copy; this.mask = mask;
    this.copyScene = copy ? gl.getUniformLocation(copy,'u_scene') : null;
    this.maskResolution = mask ? gl.getUniformLocation(mask,'u_resolution') : null;
    this.bodies = new Map(compiledMaterials.flatMap(material => material.definition.bodyIds.map(id => [id, material] as const)));
    if (!copy) return;
    this.vao = gl.createVertexArray()!; this.buffer = gl.createBuffer()!;
    if (!this.vao || !this.buffer) throw new Error('Cannot allocate effect quad');
    gl.bindVertexArray(this.vao); gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    if (mask) { this.maskVao = gl.createVertexArray()!; this.maskBuffer = gl.createBuffer()!; if (!this.maskVao || !this.maskBuffer) throw new Error('Cannot allocate material mask'); gl.bindVertexArray(this.maskVao); gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuffer); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); }
    gl.bindVertexArray(null);
  }
  begin(width: number, height: number): void {
    if (!this.copy) return;
    this.prepare(width, height);
    const target = this.target(0, width, height); this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, target.framebuffer);
  }
  /** Allocate the complete bounded pass schedule before a public configuration swap.
   * Two slots per resolution avoid read/write feedback and repeated per-pass resizing. */
  prepare(width: number, height: number): void {
    if (!this.copy) return;
    this.width = width; this.height = height; this.target(0,width,height);
    let index = 0;
    for (const pass of this.post) {
      const base = pass.definition.scale === 1 ? 0 : 2; index = base + (index === base ? 1 : 0);
      this.target(index,Math.max(1,Math.round(width*pass.definition.scale)),Math.max(1,Math.round(height*pass.definition.scale)));
    }
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER,null);
  }
  private target(index: number, width: number, height: number): Target {
    const gl = this.gl;
    let target = this.targets.get(index);
    if (!target) {
      const framebuffer = gl.createFramebuffer(), texture = gl.createTexture(), stencil = index === 0 && this.materials.length ? gl.createRenderbuffer() : undefined;
      if (!framebuffer || !texture || stencil === null) { if (framebuffer) gl.deleteFramebuffer(framebuffer); if (texture) gl.deleteTexture(texture); throw new Error('Cannot allocate effect framebuffer'); }
      target = { framebuffer, texture, ...(stencil ? { stencil } : {}), width: 0, height: 0 }; this.targets.set(index, target);
    }
    if (target.width === width && target.height === height) return target;
    gl.bindTexture(gl.TEXTURE_2D, target.texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    if (target.stencil) { gl.bindRenderbuffer(gl.RENDERBUFFER, target.stencil); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, width, height); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, target.stencil); }
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Effect framebuffer is incomplete');
    target.width = width; target.height = height; return target;
  }
  drawMaterials(bodies: readonly RenderBody[], camera: Camera, width: number, height: number, time: number, geometry: RenderGeometry): void {
    if (!this.materials.length) return;
    const gl = this.gl;
    const project = createProjector(camera, width, height);
    for (const body of bodies) {
      const material = this.bodies.get(body.id); if (!material) continue;
      const center = project(body.position), radius = body.radius * camera.scale;
      if (Math.hypot(center.x-Math.max(0,Math.min(width,center.x)),center.y-Math.max(0,Math.min(height,center.y))) > (body.surface?.bounds.maxRadius ?? body.radius)*camera.scale) continue;
      if (body.surface) {
        const polygon = terrainGeometry({ ...body, surface: body.surface }, camera, width, height, geometry).groundClip;
        if (polygon.length < 3) continue;
        gl.enable(gl.STENCIL_TEST); gl.stencilMask(1); gl.clearStencil(0); gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.stencilFunc(gl.ALWAYS, 1, 1); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT); gl.colorMask(false,false,false,false);
        gl.useProgram(this.mask!); gl.uniform2f(this.maskResolution, width, height);
        gl.bindVertexArray(this.maskVao!); gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuffer!);
        const size = polygon.length*2;
        if (this.maskVertices.length < size) { this.maskVertices = new Float32Array(2**Math.ceil(Math.log2(size))); gl.bufferData(gl.ARRAY_BUFFER,this.maskVertices.byteLength,gl.DYNAMIC_DRAW); }
        for (let i=0;i<polygon.length;i++) { this.maskVertices[i*2]=polygon[i]!.x;this.maskVertices[i*2+1]=polygon[i]!.y; }
        gl.bufferSubData(gl.ARRAY_BUFFER,0,this.maskVertices,0,size); gl.drawArrays(gl.TRIANGLE_FAN,0,polygon.length);
        gl.colorMask(true,true,true,true); gl.stencilMask(0); gl.stencilFunc(gl.EQUAL,1,1); gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);
      }
      gl.useProgram(material.program); gl.bindVertexArray(this.vao!);
      const u = material.uniforms;
      gl.uniform2f(u.get('u_resolution')!, width,height); gl.uniform1f(u.get('u_time')!,time);
      gl.uniform2f(u.get('u_center')!,center.x,center.y); gl.uniform1f(u.get('u_radius')!,radius); gl.uniform1f(u.get('u_radiusMetres')!,body.radius);
      gl.uniform1f(u.get('u_rotation')!,camera.rotation+(body.rotation??0)); gl.uniform1i(u.get('u_hasSurface')!,body.surface?1:0);
      const dx=width/2-center.x,dy=height/2-center.y,dist=Math.hypot(dx,dy),nx=dist?dx/dist:0,ny=dist?dy/dist:0;
      gl.uniform2f(u.get('u_horizon')!,center.x+nx*radius,center.y+ny*radius); gl.uniform2f(u.get('u_normal')!,nx,ny);
      for (const parameter of material.values) gl.uniform1f(parameter.location,parameter.value);
      gl.drawArrays(gl.TRIANGLES,0,6); gl.disable(gl.STENCIL_TEST);
    }
  }
  finish(time: number): void {
    if (!this.copy) return;
    const gl = this.gl; let index=0, source=this.targets.get(0)!;
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST);
    for (const pass of this.post) {
      const base=pass.definition.scale===1?0:2;index=base+(index===base?1:0);
      const target=this.target(index,Math.max(1,Math.round(this.width*pass.definition.scale)),Math.max(1,Math.round(this.height*pass.definition.scale)));
      gl.bindFramebuffer(gl.FRAMEBUFFER,target.framebuffer); gl.viewport(0,0,target.width,target.height); gl.useProgram(pass.program);gl.bindVertexArray(this.vao!);
      gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source.texture);gl.uniform1i(pass.uniforms.get('u_scene')!,0);
      gl.uniform2f(pass.uniforms.get('u_resolution')!,target.width,target.height);gl.uniform2f(pass.uniforms.get('u_sourceResolution')!,source.width,source.height);gl.uniform1f(pass.uniforms.get('u_time')!,time);
      for(const parameter of pass.values)gl.uniform1f(parameter.location,parameter.value);
      gl.drawArrays(gl.TRIANGLES,0,6);source=target;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,this.width,this.height);gl.useProgram(this.copy);gl.bindVertexArray(this.vao!);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,source.texture);gl.uniform1i(this.copyScene,0);gl.drawArrays(gl.TRIANGLES,0,6);
    gl.enable(gl.BLEND);gl.bindVertexArray(null);
  }
  private release(): void {
    const gl=this.gl;
    for(const entry of [...this.materials,...this.post])gl.deleteProgram(entry.program);
    if(this.copy)gl.deleteProgram(this.copy);if(this.mask)gl.deleteProgram(this.mask);
    if(this.vao)gl.deleteVertexArray(this.vao);if(this.maskVao)gl.deleteVertexArray(this.maskVao);if(this.buffer)gl.deleteBuffer(this.buffer);if(this.maskBuffer)gl.deleteBuffer(this.maskBuffer);
    for(const target of this.targets.values()){gl.deleteFramebuffer(target.framebuffer);gl.deleteTexture(target.texture);if(target.stencil)gl.deleteRenderbuffer(target.stencil);}
    this.materials=[];this.post=[];this.targets.clear();this.maskVertices=new Float32Array(0);this.bodies.clear();this.copy=undefined;this.mask=undefined;this.vao=undefined;this.maskVao=undefined;this.buffer=undefined;this.maskBuffer=undefined;
  }
  dispose(): void { if(this.disposed)return;this.disposed=true;this.release(); }
}
