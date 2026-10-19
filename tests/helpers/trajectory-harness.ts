/** Real shared predictor + both vector renderers; bundled only for browser checks. */
import { CanvasRenderer, WebGLRenderer } from '../../packages/render-2d/src/index';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import {createProjector,type GhostSample,type RenderFrame} from '../../packages/game-api/src/index';

export function draw(kind: 'canvas' | 'webgl') {
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),system=world.system;
 const m=system.getBodyPosition('moon',0),p=system.getBodyPosition('planet',0),v=system.getBodyVelocity('moon',0),pv=system.getBodyVelocity('planet',0);
 const state={...ship.state,position:{x:m.x-p.x-5500,y:m.y-p.y+600},velocity:{x:v.x-pv.x+80,y:v.y-pv.y}};
 world.put({...ship,state});const job=world.predictShip(ship.id),path:GhostSample[]=[];let encounters=0,last=Infinity;
 for(let n=0;n<20000;n++){const r=job.next();if(r.done)break;path.push(r.value);if(r.value.encounter&&++encounters===2)last=r.value.time+200;if(r.value.time>last)break;}
 job.return('open');
 const first=path.find(s=>s.encounter)!;
 const canvas=document.createElement('canvas');canvas.style.cssText='width:800px;height:600px;display:block';document.body.replaceChildren(canvas);
 const renderer=kind==='canvas'?new CanvasRenderer(canvas):new WebGLRenderer(canvas);
 const frame:RenderFrame={state,path,pathClosed:false,engine:false,camera:{center:{x:first.position.x+2500,y:first.position.y},rotation:0,scale:.08},pathOrigin:{x:0,y:0},
  bodies:[{id:'moon',name:'Parvus',position:{x:m.x-p.x,y:m.y-p.y},radius:128,color:'#556166',accentColor:'#9aaab0'}],showPad:false,showScale:true,
  theme:{highQuality:false,starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false,backdropStyle:'void'}};
 const gl=kind==='webgl'?canvas.getContext('webgl2'):null;
 const read=()=>{
  if(!gl)return new Uint8Array(canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data);
  const pixels=new Uint8Array(canvas.width*canvas.height*4);gl.readPixels(0,0,canvas.width,canvas.height,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;
 };
 renderer.draw({...frame,path:path.map(point=>({...point,encounterBody:undefined}))});const baseline=read();
 renderer.draw(frame);const pixels=read();
 const ghost=first.encounterBody!,at=createProjector(frame.camera,800,600)(ghost.position),radius=Math.max(3,ghost.radius*frame.camera.scale),dpr=canvas.width/800;
 let outlinePixels=0;
 for(let y=Math.max(0,Math.floor((at.y-radius-2)*dpr));y<Math.min(canvas.height,(at.y+radius+2)*dpr);y++)for(let x=Math.max(0,Math.floor((at.x-radius-2)*dpr));x<Math.min(canvas.width,(at.x+radius+2)*dpr);x++){
  if(Math.abs(Math.hypot(x/dpr-at.x,y/dpr-at.y)-radius)>2)continue;
  const i=((gl?canvas.height-1-y:y)*canvas.width+x)*4;
  if(Math.abs(pixels[i]!-baseline[i]!)+Math.abs(pixels[i+1]!-baseline[i+1]!)+Math.abs(pixels[i+2]!-baseline[i+2]!)>20)outlinePixels++;
 }
 let amber=0,mint=0;for(let i=0;i<pixels.length;i+=4){const r=pixels[i]!,g=pixels[i+1]!,b=pixels[i+2]!;if(r>110&&r>g*1.18&&g>b*1.2)amber++;if(g>100&&g>r*1.2&&b>r*1.1)mint++;}
 const result={encounters:path.filter(s=>s.encounter).map(s=>s.encounter),samples:path.length,amber,mint,outlinePixels,
  bodyDisplacement:Math.hypot(ghost.position.x-(m.x-p.x),ghost.position.y-(m.y-p.y)),ghost:at,error:gl?.getError()??0,tick:world.tick};
 world.dispose();return result;
}
