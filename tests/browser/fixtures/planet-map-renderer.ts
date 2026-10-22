import { WebGLRenderer } from '../../../modules/render-webgl/src/webgl';
import { legacyRenderPorts } from '../../../packages/render-2d/src/compatibility';
import { DEFAULT_SHADERS } from '../../../packages/render-2d/src/index';
import { generateSurface } from '../../../packages/sim-core/src/surface';
import { initialState } from '../../../packages/sim-core/src/context';
import { buildPlanetMap, type RenderFrame, type RenderBody } from '../../../packages/game-api/src/index';

export function run() {
 const surface=generateSurface({radius:2048,surface:{kind:'planet',generatorVersion:2,recipe:'oceanic',seed:741,radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,seaRadiusMetres:2051.09375,sampleCount:8192,orientationRadians:0}});
 const built=buildPlanetMap(surface),canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.append(canvas);
 const renderer=new WebGLRenderer(canvas,DEFAULT_SHADERS,{...legacyRenderPorts,maxPixelRatio:1}),gl=canvas.getContext('webgl2')!;
 const body:RenderBody={id:'planet',name:'Primus',radius:2048,position:{x:0,y:0},surface,overview:built,sunDirection:{x:-.6,y:.8}};
 const frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center:{x:0,y:0},rotation:0,scale:180/4096},bodies:[body],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showScale:false,showBodyLabels:false,showShipLabels:false};
 type Pass={resourceBytes:number;resourceCount:number;stats:{uploads:number;uploadedBytes:number;mapDraws:number;coverDraws:number}};
 const state=renderer as unknown as{planetMapPass?:Pass;planetMapFailed:boolean};
 try {
  renderer.draw({...frame,camera:{...frame.camera!,center:{x:1e8,y:0}}});const invisibleUploads=state.planetMapPass?.stats.uploads??0;
  renderer.draw(frame);gl.finish();const pass=state.planetMapPass;if(!pass)throw Error('Planet map pass was not created; failed='+state.planetMapFailed);
  const first={...pass.stats},pixels=new Uint8Array(640*480*4);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  let blue=0,land=0;const colors=new Set<string>();for(let y=155;y<325;y++)for(let x=235;x<405;x++){
   if((x-320)**2+(y-240)**2>80**2)continue;const i=(y*640+x)*4,r=pixels[i]!,g=pixels[i+1]!,b=pixels[i+2]!;if(b>g&&b>r)blue++;else if(g>b)land++;colors.add(`${r>>3},${g>>3},${b>>3}`);
  }
  for(let i=0;i<5;i++)renderer.draw(frame);const warmUploads=pass.stats.uploads-first.uploads;
  for(let i=0;i<3;i++){const map={...built.planet,identity:built.planet.identity+'-'+i};renderer.draw({...frame,bodies:[{...body,overview:{...built,planet:map}}]});}
  const resources={bytes:pass.resourceBytes,count:pass.resourceCount};gl.finish();const error=gl.getError(),failed=state.planetMapFailed;
  renderer.dispose();return{invisibleUploads,first,warmUploads,resources,disposedBytes:pass.resourceBytes,disposedCount:pass.resourceCount,error,failed,blue,land,colors:colors.size};
 }finally{renderer.dispose();canvas.remove();}
}
Object.assign(window,{PlanetMapRenderer:{run}});
