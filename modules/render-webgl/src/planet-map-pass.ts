/** First-party MIT private map pass. Public shader-pack ABI is unchanged. */
import{PlanetMapFrame,PlanetCoverMesh,type RenderBody,type Camera,type RenderPlanetMap,type SurfaceProfile}from'@space-sim/game-api';
import type{TerrainGeometry}from'./terrain';
interface Entry{map:RenderPlanetMap;profile:SurfaceProfile;heights:WebGLTexture;atlas?:WebGLTexture;cover?:WebGLTexture;width:number;bytes:number}
const VERTEX=`#version 300 es
layout(location=0)in vec2 a_position;uniform vec2 u_resolution;out vec2 v_pixel;
void main(){v_pixel=a_position;gl_Position=vec4((a_position/u_resolution*2.-1.)*vec2(1.,-1.),0.,1.);}`;
const FRAGMENT=`#version 300 es
precision highp float;precision highp int;
in vec2 v_pixel;out vec4 fragColor;
uniform vec2 u_resolution,u_axes,u_direction,u_angle,u_sun;
uniform float u_scale,u_cameraRadius,u_referenceOffset,u_referenceRadius,u_seaHeight,u_coverDepth,u_opacity,u_phase;
uniform int u_samples,u_width,u_mapSize,u_mode,u_clouds,u_air;
uniform highp sampler2D u_heights,u_atlas,u_cover;uniform highp sampler3D u_noise;
const float TAU=6.283185307179586;
int wrap(int i){return (i%u_samples+u_samples)%u_samples;}
ivec2 address(int i){i=wrap(i);return ivec2(i%u_width,i/u_width);}
vec3 decode(vec3 c){return mix(c/12.92,pow((c+.055)/1.055,vec3(2.4)),step(vec3(.04045),c));}
vec3 encode(vec3 c){return mix(c*12.92,1.055*pow(max(c,vec3(0.)),vec3(1./2.4))-.055,step(vec3(.0031308),c));}
void main(){
 vec2 p=(v_pixel-u_resolution*.5)*vec2(1.,-1.)/u_scale;
 float along=dot(p,u_axes),tangent=dot(p,vec2(-u_axes.y,u_axes.x));
 float radius=length(vec2(u_cameraRadius+along,tangent));
 float radial=u_cameraRadius>0.?(2.*u_cameraRadius*along+along*along+tangent*tangent)/(radius+u_cameraRadius):radius;
 float delta=atan(tangent,u_cameraRadius+along),local=u_angle.y+delta*float(u_samples)/TAU;
 int index=int(u_angle.x)+int(floor(local));float t=fract(local);
 float h=mix(texelFetch(u_heights,address(index),0).r,texelFetch(u_heights,address(index+1),0).r,t);
 float depth=u_referenceOffset+h-radial;
 if(u_mode==1){
  if(depth<0.||depth>u_coverDepth||h<u_seaHeight)discard;
  vec4 a=texelFetch(u_cover,address(index),0),b=texelFetch(u_cover,address(index+1),0);
  float alpha=mix(a.a,b.a,t);if(alpha<=0.)discard;
  vec3 rgb=mix(a.rgb*a.a,b.rgb*b.a,t)/alpha;
  fragColor=vec4(encode(rgb),alpha);return;
 }
 float rim=u_referenceRadius+max(h,u_seaHeight),fraction=radius/rim;
 if(fraction>1.00001)discard;
 vec2 direction=radius>0.?vec2(u_direction.x*(u_cameraRadius+along)-u_direction.y*tangent,u_direction.y*(u_cameraRadius+along)+u_direction.x*tangent)/radius:u_direction;
 vec2 disc=direction*min(1.,fraction);float z=sqrt(max(0.,1.-dot(disc,disc)));
 vec4 base=texture(u_atlas,disc*.5+.5);
 // Reconstruct the exact playable equator in the final atlas texels. The band
 // is body-fixed; zoom and spin never change its geography or wet/dry class.
 float rimWeight=smoothstep(1.-4./float(u_mapSize),1.-1./float(u_mapSize),min(1.,fraction));
 if(rimWeight>0.){
  vec3 rimColor;
  if(h<u_seaHeight){float d=clamp((u_seaHeight-h)/15.,0.,1.);rimColor=decode(vec3(16.-9.*d,117.-73.*d,160.-62.*d)/255.);}
  else{vec4 a=texelFetch(u_cover,address(index),0),b=texelFetch(u_cover,address(index+1),0);float alpha=mix(a.a,b.a,t);
   rimColor=alpha>0.?mix(a.rgb*a.a,b.rgb*b.a,t)/alpha:(base.a>0.?base.rgb/base.a:vec3(0.));}
  base=mix(base,vec4(rimColor,1.),rimWeight);
 }
 if(base.a<=0.)discard;
 float diffuse=max(0.,dot(disc,u_sun)+.35*z),light=.12+.88*min(1.,diffuse);
 vec3 result=base.rgb/base.a*light;
 if(u_clouds==1){float phase=u_phase*20.;vec3 q=vec3(cos(phase)*disc.x-sin(phase)*disc.y,sin(phase)*disc.x+cos(phase)*disc.y,z);
  float n=texture(u_noise,q*(8./64.)+vec3(.31,.17,.23)).r*.6+texture(u_noise,q*(21./64.)+vec3(.17,.63,.11)).r*.28+texture(u_noise,q*(47./64.)+vec3(.57,.29,.43)).r*.12;
  float cloud=smoothstep(.55,.76,n)*.55;result=mix(result,vec3(.82,.90,.96)*(.22+.78*min(1.,diffuse)),cloud);
 }
 if(u_air==1)result+=vec3(.018,.13,.25)*pow(min(1.,fraction),8.)*.23*(.3+.7*min(1.,diffuse));
 fragColor=vec4(encode(result),base.a*u_opacity);
}`;
function program(gl:WebGL2RenderingContext){
 const shaders:WebGLShader[]=[];let p:WebGLProgram|null=null;
 try{for(const[type,source]of[[gl.VERTEX_SHADER,VERTEX],[gl.FRAGMENT_SHADER,FRAGMENT]]as const){const s=gl.createShader(type);if(!s)throw Error('Planet shader allocation failed');shaders.push(s);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s)??'Planet shader failed');}
  p=gl.createProgram();if(!p)throw Error('Planet program allocation failed');for(const s of shaders)gl.attachShader(p,s);gl.linkProgram(p);if(!gl.getProgramParameter(p,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(p)??'Planet link failed');return p;
 }catch(e){if(p)gl.deleteProgram(p);throw e;}finally{for(const s of shaders)gl.deleteShader(s);}
}
/** Two last-visible immutable bodies. Lazy atlas/skin uploads, <4MiB logical GPU
 * textures even at65536 angular samples. The existing scene noise is borrowed. */
export class PlanetMapPass{
 private readonly program:WebGLProgram;private readonly u:Record<string,WebGLUniformLocation|null>={};private readonly entries=new Map<RenderPlanetMap,Entry>();
 private readonly frame=new PlanetMapFrame();private readonly mesh=new PlanetCoverMesh();private readonly vao:WebGLVertexArrayObject;private readonly buffer:WebGLBuffer;
 readonly stats={uploads:0,uploadedBytes:0,mapDraws:0,coverDraws:0};
 constructor(private readonly gl:WebGL2RenderingContext,private readonly noise:WebGLTexture){
  this.program=program(gl);for(const name of['resolution','axes','direction','angle','sun','scale','cameraRadius','referenceOffset','referenceRadius','seaHeight','coverDepth','opacity','phase','samples','width','mapSize','mode','clouds','air','heights','atlas','cover','noise'])this.u[name]=gl.getUniformLocation(this.program,'u_'+name);
  const vao=gl.createVertexArray(),buffer=gl.createBuffer();if(!vao||!buffer){if(vao)gl.deleteVertexArray(vao);if(buffer)gl.deleteBuffer(buffer);gl.deleteProgram(this.program);throw Error('Planet cover buffer allocation failed');}this.vao=vao;this.buffer=buffer;
  gl.bindVertexArray(vao);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,this.mesh.vertices.byteLength,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
 }
 get resourceBytes(){let bytes=0;for(const e of this.entries.values())bytes+=e.bytes;return bytes;}
 get resourceCount(){return this.entries.size;}
 private free(e:Entry){this.gl.deleteTexture(e.heights);if(e.atlas)this.gl.deleteTexture(e.atlas);if(e.cover)this.gl.deleteTexture(e.cover);}
 private texture(unit:number){const gl=this.gl,t=gl.createTexture();if(!t)throw Error('Planet texture allocation failed');gl.activeTexture(unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);return t;}
 private prepare(map:RenderPlanetMap,p:SurfaceProfile,atlas:boolean,cover:boolean):Entry|undefined{
  if(map.projection!=='north-pole-equator-rim/1'||!Number.isInteger(map.size)||map.size<32||map.size>512||(map.size&(map.size-1))!==0||map.rgba.length!==map.size*map.size*4||map.equator.length!==p.sampleCount*4||p.sampleCount<2||p.sampleCount>65536)return;
  let e=this.entries.get(map);if(e&&e.profile!==p){this.free(e);this.entries.delete(map);e=undefined;}
  if(e){this.entries.delete(map);this.entries.set(map,e);}
  if(e&&(!atlas||e.atlas)&&(!cover||e.cover))return e;
  const gl=this.gl,alignment=gl.getParameter(gl.UNPACK_ALIGNMENT)as number;
  try{gl.pixelStorei(gl.UNPACK_ALIGNMENT,1);
   if(!e){if(this.entries.size===2){const oldest=this.entries.entries().next().value!;this.free(oldest[1]);this.entries.delete(oldest[0]);}
    const width=Math.min(1024,p.sampleCount);if(p.sampleCount%width)return;
    const heights=new Float32Array(p.sampleCount);for(let i=0;i<heights.length;i++){heights[i]=p.sampleElevation(i);if(!Number.isFinite(heights[i]))return;}
    const texture=this.texture(gl.TEXTURE5);gl.texImage2D(gl.TEXTURE_2D,0,gl.R32F,width,p.sampleCount/width,0,gl.RED,gl.FLOAT,heights);
    e={map,profile:p,heights:texture,width,bytes:heights.byteLength};this.entries.set(map,e);this.stats.uploads++;this.stats.uploadedBytes+=heights.byteLength;
   }
   if(atlas&&!e.atlas){const texture=this.texture(gl.TEXTURE4);e.atlas=texture;gl.texImage2D(gl.TEXTURE_2D,0,gl.SRGB8_ALPHA8,map.size,map.size,0,gl.RGBA,gl.UNSIGNED_BYTE,map.rgba);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.generateMipmap(gl.TEXTURE_2D);
    for(let n=map.size;n>=1;n/=2)e.bytes+=n*n*4;this.stats.uploads++;this.stats.uploadedBytes+=map.rgba.byteLength;
   }
   if(cover&&!e.cover){e.cover=this.texture(gl.TEXTURE6);gl.texImage2D(gl.TEXTURE_2D,0,gl.SRGB8_ALPHA8,e.width,p.sampleCount/e.width,0,gl.RGBA,gl.UNSIGNED_BYTE,map.equator);e.bytes+=map.equator.byteLength;this.stats.uploads++;this.stats.uploadedBytes+=map.equator.byteLength;}
   return e;
  }catch(error){if(e){this.free(e);this.entries.delete(map);}throw error;}
  finally{gl.pixelStorei(gl.UNPACK_ALIGNMENT,alignment);gl.activeTexture(gl.TEXTURE0);}
 }
 private bind(e:Entry,width:number,height:number,mode:number){const gl=this.gl,u=this.u,f=this.frame,p=e.profile;gl.useProgram(this.program);
  gl.uniform2f(u.resolution!,width,height);gl.uniform2f(u.axes!,f.axisX,f.axisY);gl.uniform2f(u.direction!,f.directionX,f.directionY);gl.uniform2f(u.angle!,f.angleIndex,f.angleFraction);gl.uniform2f(u.sun!,f.sunX,f.sunY);
  gl.uniform1f(u.scale!,f.scale);gl.uniform1f(u.cameraRadius!,f.cameraRadius);gl.uniform1f(u.referenceOffset!,f.referenceOffset);gl.uniform1f(u.referenceRadius!,p.referenceRadius);gl.uniform1f(u.seaHeight!,p.seaRadiusMetres===undefined?-1e20:p.seaRadiusMetres-p.referenceRadius);gl.uniform1f(u.coverDepth!,e.map.coverMetres);gl.uniform1f(u.opacity!,f.opacity);gl.uniform1f(u.phase!,f.cloudPhase);
  gl.uniform1i(u.samples!,p.sampleCount);gl.uniform1i(u.width!,e.width);gl.uniform1i(u.mapSize!,e.map.size);gl.uniform1i(u.mode!,mode);gl.uniform1i(u.clouds!,f.clouds?1:0);gl.uniform1i(u.air!,f.air?1:0);
  gl.activeTexture(gl.TEXTURE5);gl.bindTexture(gl.TEXTURE_2D,e.heights);gl.uniform1i(u.heights!,5);
  gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,e.atlas??e.cover??null);gl.uniform1i(u.atlas!,4);
  gl.activeTexture(gl.TEXTURE6);gl.bindTexture(gl.TEXTURE_2D,e.cover??e.atlas??null);gl.uniform1i(u.cover!,6);
  gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_3D,this.noise);gl.uniform1i(u.noise!,1);gl.activeTexture(gl.TEXTURE0);
 }
 /** Caller retains terrain VAO/buffer and supplies only canonical map faces. */
 drawMap(body:RenderBody,camera:Camera,width:number,height:number,first:number,count:number):boolean{
  const map=body.overview?.planet,p=body.surface;if(!map||!p||!count||!this.frame.update(body,camera,width,height)||this.frame.opacity<=0)return false;
  const e=this.prepare(map,p,true,true);if(!e)return false;this.bind(e,width,height,0);this.gl.drawArrays(this.gl.TRIANGLES,first,count);this.stats.mapDraws++;return true;
 }
 /** Bounded visible skin, after tile overlays. No fine buffers or global quad. */
 drawCover(body:RenderBody,camera:Camera,geometry:TerrainGeometry,width:number,height:number):void{
  const map=body.overview?.planet,p=body.surface;if(!map||!p||!this.frame.update(body,camera,width,height))return;this.mesh.update(map,this.frame,geometry.boundary,width,height);if(!this.mesh.length)return;
  const e=this.prepare(map,p,false,true);if(!e)return;const gl=this.gl;this.bind(e,width,height,1);gl.bindVertexArray(this.vao);gl.bindBuffer(gl.ARRAY_BUFFER,this.buffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.mesh.vertices,0,this.mesh.length);gl.drawArrays(gl.TRIANGLES,0,this.mesh.length/2);this.stats.coverDraws++;
 }
 dispose(){for(const e of this.entries.values())this.free(e);this.entries.clear();this.gl.deleteVertexArray(this.vao);this.gl.deleteBuffer(this.buffer);this.gl.deleteProgram(this.program);}
}
