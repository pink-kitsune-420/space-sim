import { CANVAS_DRAWING, WEBGL_DRAWING, type ModuleEnvironment, type ModuleProfileV2, type RenderFrame } from '../../../packages/game-api/src/index';
import {ModuleRegistryV2,moduleAssets} from '../../../packages/game-runtime/src/modules-v2';
import {loadCodeModuleV2} from '../../../packages/game-runtime/src/loader';
import {decodeModulePackage,requiredFile} from '../../../packages/game-library/src/portable';
import {engineModuleServices} from '../../../packages/sim-core/src/module-services';
import {generateSurface} from '../../../packages/sim-core/src/surface';
import {buildPlanetMap} from '../../../packages/game-api/src/planet-map';
import {initialState} from '../../../packages/sim-core/src/context';
import {DEFAULT_SHADERS} from '../../../packages/render-2d/src/index';
declare const __RENDER_PACKAGES__:Record<string,string>;
export async function run(backend:'webgl'|'canvas',environment:ModuleEnvironment){
 const pkg=await decodeModulePackage(Uint8Array.from(atob(__RENDER_PACKAGES__[backend]!),c=>c.charCodeAt(0)));
 if(!pkg.codeV2||pkg.descriptor.manifest.format!=='space-sim-module/2')throw Error('Expected verified renderer archive');
 const manifest=pkg.descriptor.manifest,digest=pkg.codeV2.digest,registry=new ModuleRegistryV2(engineModuleServices());
 registry.register(loadCodeModuleV2({manifest,digest,source:pkg.codeV2.source,supportsMultiplayer:pkg.descriptor.compatibility.multiplayer},{environment,allowRuntimeCode:true,approvedDigests:new Set([digest])}),moduleAssets(new Map(pkg.descriptor.guides.map(p=>[p,requiredFile(pkg.files,p)]))));
 const key=backend==='webgl'?WEBGL_DRAWING:CANVAS_DRAWING;
 const profile:ModuleProfileV2={format:'space-sim-profile/2',id:'test.renderer-archive',modules:[{id:manifest.id,version:manifest.version}],providers:{[key.slot]:manifest.id},capabilities:{},settings:{}};
 const candidate=registry.prepare(profile,environment),canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.append(canvas);
 const factory=backend==='webgl'?candidate.providedService(WEBGL_DRAWING):candidate.providedService(CANVAS_DRAWING);
 const renderer=backend==='webgl'?candidate.providedService(WEBGL_DRAWING).create(canvas,DEFAULT_SHADERS,{maxPixelRatio:1}):candidate.providedService(CANVAS_DRAWING).create(canvas,{maxPixelRatio:1});
 try{
  const p=generateSurface({radius:2048,surface:{kind:'planet',generatorVersion:2,recipe:'oceanic',seed:741,radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,seaRadiusMetres:2051.09375,sampleCount:8192,orientationRadians:0}}),overview=buildPlanetMap(p);
  renderer.features?.shaders?.set({...DEFAULT_SHADERS,name:'Existing shader-pack ABI'});
  const frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center:{x:0,y:0},rotation:0,scale:180/4096},bodies:[{id:'planet',name:'Primus',radius:2048,position:{x:0,y:0},surface:p,overview,sunDirection:{x:-.6,y:.8}}],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showScale:false,showBodyLabels:false};
  renderer.draw(frame);const pixels=new Uint8Array(640*480*4),gl=backend==='webgl'?canvas.getContext('webgl2')!:null;
  if(gl)gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);else pixels.set(canvas.getContext('2d')!.getImageData(0,0,640,480).data);
  let blue=0,land=0;for(let y=160;y<320;y++)for(let x=240;x<400;x++){if((x-320)**2+(y-240)**2>78**2)continue;const i=(y*640+x)*4;if(pixels[i+2]!>pixels[i+1]!&&pixels[i+2]!>pixels[i]!)blue++;else if(pixels[i+1]!>pixels[i+2]!)land++;}
  const capability=renderer.features?.planetMap?.version,error=gl?.getError()??0;
  candidate.dispose();let rejected=false;try{if(backend==='webgl')candidate.providedService(WEBGL_DRAWING).create(canvas,DEFAULT_SHADERS);else candidate.providedService(CANVAS_DRAWING).create(canvas);}catch{rejected=true;}
  return{backend,environment,id:manifest.id,digest,capability,error,blue,land,rejected,hasFactory:!!factory};
 }finally{candidate.dispose();canvas.remove();}
}
Object.assign(window,{PlanetRendererArchive:{run}});
