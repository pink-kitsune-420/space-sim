import {WebGLRenderer} from '../../../modules/render-webgl/src/webgl';
import {CanvasRenderer} from '../../../modules/render-canvas/src/canvas';
import {legacyRenderPorts} from '../../../packages/render-2d/src/compatibility';
import {DEFAULT_SHADERS} from '../../../packages/render-2d/src/index';
import {generateSurface,querySurface} from '../../../packages/sim-core/src/surface';
import {initialState} from '../../../packages/sim-core/src/context';
import {buildOverview} from '../../../apps/web/src/successor-overview';
import {MATERIAL_DOMAINS} from '../../../apps/web/src/successor-materials';
import preview from '../../../games/space-sim-successor/planet-preview.json';
import type{RenderFrame,Renderer}from '../../../packages/game-api/src/index';
export function run(backend:'WebGL'|'Canvas',rocky=false){
 const raw=preview.data.universes[0]!.definition.systems[0]!.bodies.find(b=>b.id===(rocky?'moon':'planet'))!,p=generateSurface(raw as unknown as Parameters<typeof generateSurface>[0]),overview=buildOverview(p,rocky?MATERIAL_DOMAINS.moon:MATERIAL_DOMAINS.planet);
 const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.append(canvas);
 const renderer:Renderer=backend==='WebGL'?new WebGLRenderer(canvas,DEFAULT_SHADERS,{...legacyRenderPorts,maxPixelRatio:1}):new CanvasRenderer(canvas,{...legacyRenderPorts,maxPixelRatio:1}),gl=backend==='WebGL'?canvas.getContext('webgl2')!:null;
 const angle=rocky?1.2:1.8652254254248182,r=querySurface(p,angle).groundRadius,center={x:r*Math.cos(angle),y:r*Math.sin(angle)},rotation=Math.PI/2-angle,rows=[];
 try{for(const scale of[.6,1,2,2.9,3,3.1,3.9,4,4.1]){
  const spin=rows.length*.017,pan=rows.length%2===0?2.25:-1.75,c=Math.cos(spin),s=Math.sin(spin);
  const frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center:{x:center.x*c-center.y*s+pan/scale,y:center.x*s+center.y*c},rotation:rotation-spin,scale},bodies:[{id:raw.id,name:rocky?'Parvus':'Primus',radius:raw.radius,position:{x:0,y:0},rotation:spin,surface:p,overview,color:raw.color,atmosphereColor:'#00000000',skyColor:'#00000000',horizonColor:'#00000000'}],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showPad:false,showScale:false,showBodyLabels:false};
  renderer.draw(frame);const pixels=new Uint8Array(640*480*4);if(gl)gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);else pixels.set(canvas.getContext('2d')!.getImageData(0,0,640,480).data);
  const probes=[];for(let k=-10;k<=10;k++){
   const a=angle+k*.003,q=querySurface(p,a),rad=q.groundRadius-32,wx=rad*Math.cos(a+spin)-frame.camera!.center.x,wy=rad*Math.sin(a+spin)-frame.camera!.center.y,rc=Math.cos(rotation-spin),rs=Math.sin(rotation-spin),x=Math.floor(320+(wx*rc-wy*rs)*scale),y=Math.floor(240-(wx*rs+wy*rc)*scale);
   if(x<2||x>637||y<2||y>477)continue;const i=((gl?479-y:y)*640+x)*4;probes.push({water:q.material==='water',rgb:Array.from(pixels.slice(i,i+3)),x,y});
  }
  rows.push({scale,probes,error:gl?.getError()??0});
 }return{backend,rows};}finally{renderer.dispose?.();canvas.remove();}
}
export function runRim(){
 const raw=preview.data.universes[0]!.definition.systems[0]!.bodies.find(b=>b.id==='planet')!,p=generateSurface(raw as unknown as Parameters<typeof generateSurface>[0]),overview=buildOverview(p,MATERIAL_DOMAINS.planet);
 const canvas=document.createElement('canvas');canvas.style.cssText='width:1024px;height:900px';document.body.append(canvas);const renderer=new WebGLRenderer(canvas,DEFAULT_SHADERS,{...legacyRenderPorts,maxPixelRatio:1}),gl=canvas.getContext('webgl2')!;
 const scale=315/2048,frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center:{x:0,y:0},rotation:0,scale},bodies:[{id:'planet',name:'Primus',radius:2048,position:{x:0,y:0},surface:p,overview,color:raw.color,atmosphereColor:'#00000000',skyColor:'#00000000',horizonColor:'#00000000'}],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showPad:false,showScale:false,showBodyLabels:false};
 try{renderer.draw(frame);const pixels=new Uint8Array(1024*900*4);gl.readPixels(0,0,1024,900,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const probes=[];
  for(let y=125;y<775;y++)for(let x=187;x<837;x++){const dx=(x+.5-512)/scale,dy=(450-y-.5)/scale,a=Math.atan2(dy,dx),q=querySurface(p,a),fraction=Math.hypot(dx,dy)/Math.max(q.groundRadius,p.seaRadiusMetres!);if(fraction<.99805||fraction>.99835||Math.abs(q.groundRadius-p.seaRadiusMetres!)<1)continue;const i=((899-y)*1024+x)*4,rgb=Array.from(pixels.slice(i,i+3)),wet=q.groundRadius<p.seaRadiusMetres!;probes.push({x,y,wet,rgb,wrong:(rgb[2]!>rgb[0]!&&rgb[2]!>rgb[1]!)!==wet});}
  return{error:gl.getError(),probes};
 }finally{renderer.dispose();canvas.remove();}
}
Object.assign(window,{PlanetTransition:{run,runRim}});
