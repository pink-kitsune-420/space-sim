import type { Camera, RenderBody } from './presentation';
import type { RenderOverview, RenderPlanetMap } from './render-overview';
import type { SurfaceProfile } from './surface';
import { linearColor, displayColor } from './render-overview';
import { createPlanetField } from './planet-field/field';
import * as dm from './math';

const TAU=2*Math.PI;
let channels:Float64Array|undefined;
function channelTable(){if(!channels){channels=new Float64Array(256);for(let i=0;i<256;i++)channels[i]=linearColor(i/255);}return channels;}
function cover(height:number,z:number,moisture:number,sea:number,rocky:boolean,out:Float64Array){
 if(height<sea){const t=Math.max(0,Math.min(1,(sea-height)/15));out[0]=16-9*t;out[1]=117-73*t;out[2]=160-62*t;return;}
 if(rocky){const t=Math.max(0,Math.min(1,(height+24)/48));out[0]=75+t*65;out[1]=77+t*62;out[2]=80+t*58;return;}
 const altitude=Math.max(0,height-(Number.isFinite(sea)?sea:0)),temperature=1-Math.abs(z)*.90-altitude/48*.55;
 if(temperature<.18){out[0]=222;out[1]=out[2]=232;return;}
 if(altitude>20){out[0]=126;out[1]=111;out[2]=88;return;}
 if(altitude<1){out[0]=191;out[1]=184;out[2]=127;return;}
 if(moisture<.42){out[0]=171;out[1]=150;out[2]=94;return;}
 const t=Math.max(0,Math.min(1,(moisture-.42)/.4));out[0]=83-36*t;out[1]=125+14*t;out[2]=64+9*t;
}

/** @internal Cooperative cold construction for host loading; synchronous callers use buildPlanetMap. */
export function* planetMapWork(profile:SurfaceProfile):Generator<void,{planet:RenderPlanetMap;levels:RenderOverview['levels']}> {
 const data=profile.planet;if(!data)throw Error('Planet map requires a shared physical field');
 const field=createPlanetField(data.definition),size=512,rgba=new Uint8Array(size*size*4),equator=new Uint8Array(profile.sampleCount*4),out=new Float64Array(8),rgb=new Float64Array(3);
 const sea=(profile.seaRadiusMetres??-Infinity)-profile.referenceRadius,rocky=data.definition.recipe==='rocky';
 for(let y=0;y<size;y++){
 if(y%4===0)yield;
 for(let x=0;x<size;x++){
  const px=(x+.5)/size*2-1,py=(y+.5)/size*2-1,r2=px*px+py*py,i=(y*size+x)*4;if(r2>1)continue;
  const z=Math.sqrt(1-r2);field.evaluate(px,py,z,out);cover(out[0]!,z,out[7]!,sea,rocky,rgb);
  for(let c=0;c<3;c++)rgba[i+c]=Math.round(rgb[c]!);rgba[i+3]=255;
 }
 }
 for(let i=0;i<profile.sampleCount;i++){
  if(i%1024===0)yield;
  const a=profile.orientationRadians+i*TAU/profile.sampleCount;field.evaluate(dm.cos(a),dm.sin(a),0,out);
  const h=profile.sampleElevation(i);cover(h,0,out[7]!,sea,rocky,rgb);
  for(let c=0;c<3;c++)equator[i*4+c]=Math.round(rgb[c]!);equator[i*4+3]=h<sea?0:255;
 }
 const planet:RenderPlanetMap=Object.freeze({identity:data.identity+':north-rgba/1',projection:'north-pole-equator-rim/1',size,rgba,equator,coverMetres:rocky?0:.35,storageBytes:rgba.byteLength+equator.byteLength});
 const sample=new Float64Array(4),leaf=new Float32Array(128*16*4);
 for(let row=0;row<16;row++)for(let col=0;col<128;col++){
  const a=(col+.5)*TAU/128,r=(row+.5)/16;planetMapColor(planet,r*Math.cos(a),r*Math.sin(a),sample);
  for(let c=0;c<4;c++)leaf[(row*128+col)*4+c]=sample[c]!;
 }
 const levels:{sectors:number;rings:number;rgba:Float32Array}[]=[{sectors:128,rings:16,rgba:leaf}];
 while(levels[0]!.sectors>1||levels[0]!.rings>1){
  yield;
  const child=levels[0]!,sectors=Math.max(1,child.sectors/2),rings=Math.max(1,child.rings/2),rgba=new Float32Array(sectors*rings*4);
  for(let y=0;y<rings;y++)for(let x=0;x<sectors;x++){
   let weight=0;for(let dy=0;dy<(child.rings>1?2:1);dy++)for(let dx=0;dx<(child.sectors>1?2:1);dx++){
    const yy=y*2+dy,xx=x*2+dx,w=2*yy+1;weight+=w;for(let c=0;c<4;c++)rgba[(y*sectors+x)*4+c]=rgba[(y*sectors+x)*4+c]!+child.rgba[(yy*child.sectors+xx)*4+c]!*w;
   }for(let c=0;c<4;c++)rgba[(y*sectors+x)*4+c]=rgba[(y*sectors+x)*4+c]!/weight;
  }levels.unshift({sectors,rings,rgba});
 }
 return{planet,levels};
}

/** Caller-owned bounded Cartesian colour projection from the actual v2 field,
 * including its physical pads. Cold construction only, no fine terrain queries.
 * Returns coarse fallback levels as well as the rich atlas; <=~1.1MiB/body.
 * Synchronous compatibility construction, identical to cooperative host loading. */
export function buildPlanetMap(profile:SurfaceProfile):{planet:RenderPlanetMap;levels:RenderOverview['levels']} {
 const work=planetMapWork(profile);let step=work.next();while(!step.done)step=work.next();return step.value;
}

/** Bilinear unlit map sample in premultiplied linear RGBA. Body-fixed Cartesian
 * x/y are unit-disc coordinates; writes four caller-owned slots without allocation.
 * An optional matching physical profile reconstructs the last atlas texels from
 * its exact equator. The fixed body-space band preserves wet/dry class and cover
 * while the camera zooms; it queries at most two profile samples, never a field. */
export function planetMapColor(map:RenderPlanetMap,x:number,y:number,out:Float64Array,profile?:SurfaceProfile):void{
 const n=map.size,fx=Math.max(0,Math.min(n-1,(x*.5+.5)*n-.5)),fy=Math.max(0,Math.min(n-1,(y*.5+.5)*n-.5));
 const ix=Math.floor(fx),iy=Math.floor(fy),tx=fx-ix,ty=fy-iy,lut=channelTable();out.fill(0);
 for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
  const i=(Math.min(n-1,iy+dy)*n+Math.min(n-1,ix+dx))*4,w=(dx?tx:1-tx)*(dy?ty:1-ty),alpha=map.rgba[i+3]!/255;
  for(let c=0;c<3;c++)out[c]=out[c]!+lut[map.rgba[i+c]!]!*alpha*w;out[3]=out[3]!+alpha*w;
 }
 const start=1-4/n,r2=x*x+y*y;
 if(profile&&r2>start*start){
  const t=Math.max(0,Math.min(1,(Math.sqrt(r2)-start)/(3/n))),w=t*t*(3-2*t),count=profile.sampleCount;
  const address=((Math.atan2(y,x)-profile.orientationRadians)/TAU*count%count+count)%count,i=Math.floor(address),f=address-i,j=(i+1)%count;
  const h=profile.sampleElevation(i)*(1-f)+profile.sampleElevation(j)*f,sea=(profile.seaRadiusMetres??-Infinity)-profile.referenceRadius;
  if(h<sea){
   const d=Math.max(0,Math.min(1,(sea-h)/15));
   out[0]=out[0]!*(1-w)+linearColor((16-9*d)/255)*w;
   out[1]=out[1]!*(1-w)+linearColor((117-73*d)/255)*w;
   out[2]=out[2]!*(1-w)+linearColor((160-62*d)/255)*w;
  }else{
   const a=(1-f)*map.equator[i*4+3]!/255,b=f*map.equator[j*4+3]!/255,alpha=a+b;
   for(let c=0;c<3;c++){
    const land=alpha>0?(lut[map.equator[i*4+c]!]!*a+lut[map.equator[j*4+c]!]!*b)/alpha:(out[3]!>0?out[c]!/out[3]!:0);
    out[c]=out[c]!*(1-w)+land*w;
   }
  }
  out[3]=out[3]!*(1-w)+w;
 }
}

/** Shared float64 camera frame for independently built renderers. All world
 * differences are formed before projection; integer/fractional angular addresses
 * keep fine cover stable at large zoom. update never samples a field or allocates. */
export class PlanetMapFrame {
 cameraRadius=0;referenceOffset=0;axisX=1;axisY=0;directionX=1;directionY=0;
 angleIndex=0;angleFraction=0;opacity=0;sunX=-.6;sunY=.8;cloudPhase=0;clouds=false;air=false;
 scale=1;rotation=0;visible=false;
 update(body:RenderBody,camera:Camera,width:number,height:number):boolean{
  const p=body.surface,map=body.overview?.planet;this.visible=false;if(!p||!map)return false;
  const x=camera.center.x-body.position.x,y=camera.center.y-body.position.y,spin=body.rotation??0,c=Math.cos(spin),s=Math.sin(spin),bx=c*x+s*y,by=-s*x+c*y;
  const distance=Math.hypot(bx,by),view=Math.hypot(width,height)/(2*camera.scale);
  if(distance-view>p.bounds.maxRadius+1)return false;
  const angle=Math.atan2(by,bx),axes=angle+camera.rotation+spin,index=((angle-p.orientationRadians)/TAU*p.sampleCount%p.sampleCount+p.sampleCount)%p.sampleCount;
  this.cameraRadius=distance;this.referenceOffset=p.referenceRadius-distance;this.scale=camera.scale;this.rotation=camera.rotation+spin;
  this.axisX=Math.cos(axes);this.axisY=Math.sin(axes);this.directionX=Math.cos(angle);this.directionY=Math.sin(angle);
  this.angleIndex=Math.floor(index);this.angleFraction=index-this.angleIndex;
  const global=Math.max(0,Math.min(1,(1.4-p.referenceRadius*camera.scale/Math.max(width,height))/.55));
  const local=distance>p.bounds.minRadius*.7?Math.max(0,Math.min(1,(16*camera.scale-2)/6)):0;
  this.opacity=global*(1-local);
  if(this.opacity===0&&distance+view<(p.groundBounds??p.bounds).minRadius-16)return false;
  const sun=body.sunDirection??body.air?.sunDirection;
  this.sunX=sun?c*sun.x+s*sun.y:-.6;this.sunY=sun?-s*sun.x+c*sun.y:.8;
  this.air=!!body.air&&body.air.mode!=='off';this.clouds=body.air?.mode==='clouds';this.cloudPhase=body.air?.phaseRadians??0;
  this.visible=this.opacity>0||map.coverMetres*camera.scale>=.2;return this.visible;
 }
 /** CSS sample into seven caller-owned float64 slots: angular index/fraction,
  * ground depth(m), radius/rim ratio, map x/y, ground elevation(m). No field query. */
 sample(x:number,y:number,width:number,height:number,p:SurfaceProfile,out:Float64Array):void{
  const sx=(x-width/2)/this.scale,sy=-(y-height/2)/this.scale,along=sx*this.axisX+sy*this.axisY,tangent=-sx*this.axisY+sy*this.axisX;
  const radius=Math.hypot(this.cameraRadius+along,tangent),radial=this.cameraRadius>0?(2*this.cameraRadius*along+along*along+tangent*tangent)/(radius+this.cameraRadius):radius;
  const local=this.angleFraction+Math.atan2(tangent,this.cameraRadius+along)*p.sampleCount/TAU,whole=Math.floor(local),fraction=local-whole;
  const i=((this.angleIndex+whole)%p.sampleCount+p.sampleCount)%p.sampleCount,h=p.sampleElevation(i)*(1-fraction)+p.sampleElevation((i+1)%p.sampleCount)*fraction;
  const ratio=radius/Math.max(p.referenceRadius+h,p.seaRadiusMetres??0),factor=radius>0?Math.min(1,ratio)/radius:0;
  out[0]=i;out[1]=fraction;out[2]=this.referenceOffset+h-radial;out[3]=ratio;
  out[4]=(this.directionX*(this.cameraRadius+along)-this.directionY*tangent)*factor;
  out[5]=(this.directionY*(this.cameraRadius+along)+this.directionX*tangent)*factor;out[6]=h;
 }
}

/** Structural canonical-boundary point, in CSS pixels plus body-fixed polar
 * metres/radians. Existing terrain geometry remains the silhouette authority. */
export interface PlanetBoundaryPoint{readonly x:number;readonly y:number;readonly angle:number;readonly radius:number}
/** Bounded visible skin bands shared by Canvas and WebGL. Borrow vertices until
 * next update; zero warm allocation, max512 quads. Shader/sampler still clips to
 * exact ground/cover depth. A configurable CSS-pixel margin covers canonical chord error. */
export class PlanetCoverMesh {
 readonly vertices=new Float32Array(512*12);length=0;
 update(map:RenderPlanetMap,frame:PlanetMapFrame,boundary:readonly PlanetBoundaryPoint[],width:number,height:number,marginPixels=1):void{
  this.length=0;if(!frame.visible||map.coverMetres*frame.scale<.2)return;
  const depth=map.coverMetres*frame.scale+marginPixels;
  for(let i=1;i<boundary.length;i++){
   const p=boundary[i-1]!,q=boundary[i]!;
   if(Math.max(p.x,q.x)<-depth||Math.min(p.x,q.x)>width+depth||Math.max(p.y,q.y)<-depth||Math.min(p.y,q.y)>height+depth)continue;
   if(this.length+12>this.vertices.length){this.length=0;return;}
   const pa=p.angle+frame.rotation,qa=q.angle+frame.rotation,px=Math.cos(pa),py=-Math.sin(pa),qx=Math.cos(qa),qy=-Math.sin(qa);
   const ax=p.x+px*marginPixels,ay=p.y+py*marginPixels,bx=q.x+qx*marginPixels,by=q.y+qy*marginPixels,cx=q.x-qx*depth,cy=q.y-qy*depth,dx=p.x-px*depth,dy=p.y-py*depth;
   const v=this.vertices;let j=this.length;v[j++]=ax;v[j++]=ay;v[j++]=bx;v[j++]=by;v[j++]=cx;v[j++]=cy;v[j++]=ax;v[j++]=ay;v[j++]=cx;v[j++]=cy;v[j++]=dx;v[j++]=dy;this.length=j;
  }
 }
}

/** Shared low-cost display conversion for simplified Canvas map sampling. */
export function planetDisplayChannel(linear:number):number{return Math.round(Math.max(0,Math.min(1,displayColor(linear)))*255);}
