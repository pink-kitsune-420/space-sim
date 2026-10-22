import {WebGLRenderer} from '../../../modules/render-webgl/src/webgl';
import {legacyRenderPorts} from '../../../packages/render-2d/src/compatibility';
import {DEFAULT_SHADERS} from '../../../packages/render-2d/src/index';
import {generateSurface,querySurface} from '../../../packages/sim-core/src/surface';
import {initialState} from '../../../packages/sim-core/src/context';
import {buildPlanetMap,type RenderBody,type RenderFrame} from '../../../packages/game-api/src/index';
export function run(){
 const p=generateSurface({radius:2048,surface:{kind:'planet',generatorVersion:2,recipe:'oceanic',seed:741,radiusMetres:2048,maxReliefMetres:48,continentWavelengthMetres:1100,rangeWavelengthMetres:280,hillWavelengthMetres:80,octaves:4,seaRadiusMetres:2051.09375,sampleCount:8192,orientationRadians:0}}),overview=buildPlanetMap(p);
 const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.append(canvas);const renderer=new WebGLRenderer(canvas,DEFAULT_SHADERS,{...legacyRenderPorts,maxPixelRatio:1}),gl=canvas.getContext('webgl2')!;
 const body:RenderBody={id:'planet',name:'Primus',position:{x:0,y:0},radius:2048,surface:p,overview,sunDirection:{x:-.6,y:.8}};
 const frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center:{x:0,y:0},rotation:0,scale:180/4096},bodies:[body],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showPad:false,showScale:false,showBodyLabels:false};
 const capture=(f:RenderFrame)=>{renderer.draw(f);const pixels=new Uint8Array(640*480*4);gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
 const compare=(a:Uint8Array,b:Uint8Array)=>{let wrong=0,worst=0,checked=0;for(let y=164;y<316;y++)for(let x=244;x<396;x++){if((x-320)**2+(y-240)**2>74**2)continue;const i=(y*640+x)*4,error=Math.max(...[0,1,2].map(c=>Math.abs(a[i+c]!-b[i+c]!)));checked++;worst=Math.max(worst,error);if(error>2)wrong++;}return{wrong,worst,checked};};
 const pixel=(a:Uint8Array,x:number,y:number)=>Array.from(a.slice(((479-y)*640+x)*4,((479-y)*640+x)*4+3));
 try{
  const baseline=capture(frame),spin=.73,c=Math.cos(spin),s=Math.sin(spin),origin={x:1e12,y:-1e12};
  const moved={...body,rotation:spin,position:origin,sunDirection:{x:c*(-.6)-s*.8,y:s*(-.6)+c*.8}};
  const fixed=capture({...frame,bodies:[moved],camera:{...frame.camera,center:origin,rotation:-spin}});
  const pan={x:12.25,y:-6.75},reference=capture({...frame,camera:{...frame.camera,center:pan,rotation:.2}});
  const translated=capture({...frame,bodies:[moved],camera:{...frame.camera,center:{x:origin.x+c*pan.x-s*pan.y,y:origin.y+s*pan.x+c*pan.y},rotation:.2-spin}});
  let index=-1;for(let i=0;i<p.sampleCount;i++)if(overview.planet.equator[i*4+3]===255&&overview.planet.equator[i*4+1]!>overview.planet.equator[i*4]!+15){index=i;break;}
  if(index<0)throw Error('Expected a vegetated land site');const a=index*2*Math.PI/p.sampleCount,r=querySurface(p,a).groundRadius;
  const near={...frame,camera:{center:{x:r*Math.cos(a),y:r*Math.sin(a)},rotation:Math.PI/2-a,scale:40}};
  const noSkin=capture({...near,bodies:[{...body,overview:undefined}]}),skin=capture(near),expected=Array.from(overview.planet.equator.slice(index*4,index*4+3));
  const actual=pixel(skin,320,246),coverError=Math.max(...actual.map((v,i)=>Math.abs(v-expected[i]!))),belowBefore=pixel(noSkin,320,280),belowAfter=pixel(skin,320,280),skyBefore=pixel(noSkin,320,230),skyAfter=pixel(skin,320,230);
  return{anchored:compare(baseline,fixed),panned:compare(reference,translated),cover:{index,expected,actual,error:coverError,belowBefore,belowAfter,skyBefore,skyAfter},error:gl.getError()};
 }finally{renderer.dispose();canvas.remove();}
}
Object.assign(window,{PlanetMapPoses:{run}});
