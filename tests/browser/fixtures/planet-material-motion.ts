import{CanvasRenderer}from'../../../modules/render-canvas/src/canvas';
import{WebGLRenderer}from'../../../modules/render-webgl/src/webgl';
import{legacyRenderPorts}from'../../../packages/render-2d/src/compatibility';
import{DEFAULT_SHADERS}from'../../../packages/render-2d/src/index';
import{generateSurface,querySurface}from'../../../packages/sim-core/src/surface';
import{initialState}from'../../../packages/sim-core/src/context';
import{buildOverview}from'../../../apps/web/src/successor-overview';
import{appearanceAt,MATERIAL_DOMAINS}from'../../../apps/web/src/successor-materials';
import{SuccessorTiles,type TileStats}from'../../../apps/web/src/successor-tiles';
import preview from'../../../games/space-sim-successor/planet-preview.json';
import type{RenderFrame,Renderer}from'../../../packages/game-api/src/index';
export function run(wet=false,backend:'WebGL'|'Canvas'='WebGL'){
 const raw=preview.data.universes[0]!.definition.systems[0]!.bodies.find(b=>b.id==='planet')!,p=generateSurface(raw as unknown as Parameters<typeof generateSurface>[0]),domain=MATERIAL_DOMAINS.planet,authoredOverview=buildOverview(p,domain),tiles=new SuccessorTiles();
 const surface=authoredOverview.surface!;
 // A uniform supported summary isolates fallback layer coverage from Canvas's
 // deliberately coarser angular/depth color averaging. Physics stays authored.
 const overview=backend==='Canvas'?{...authoredOverview,surface:{...surface,samples:new Uint8Array(surface.samples.length).fill(5),levels:surface.levels.map(l=>{const fractions=new Uint8Array(l.fractions.length);for(let i=1;i<fractions.length;i+=2)fractions[i]=255;return{...l,fractions};})}}:authoredOverview;
 if(backend==='Canvas')tiles.size=0;
 const canvas=document.createElement('canvas');canvas.style.cssText='width:640px;height:480px';document.body.append(canvas);const renderer:Renderer=backend==='WebGL'?new WebGLRenderer(canvas,DEFAULT_SHADERS,{...legacyRenderPorts,maxPixelRatio:1}):new CanvasRenderer(canvas,{...legacyRenderPorts,maxPixelRatio:1}),gl=backend==='WebGL'?canvas.getContext('webgl2')!:null;
 const anchor=p.pads[0]!.angleRadians,sa=Math.sin(anchor),ca=Math.cos(anchor),site=wet?1.8352254254248182:1.8952254254248182,r=querySurface(p,site).groundRadius,origin={x:0,y:0};
 const rows:{scale:number;checked:number;wrong:number;worst:number;failures:unknown[];tiles:TileStats;error:number}[]=[];
 const identity=(x:number,y:number)=>backend==='Canvas'?'cool-aggregate':appearanceAt(domain,x*sa-y*ca,x*ca+y*sa-p.referenceRadius);
 try{for(const scale of(wet?[.6,1,2,3.9,4.1,6,10,30,10,4.1,3.9,3.1,2.9,4.1]:[3.9,4.1,6,10,30,10,4.1,3.9,3.1,2.9,4.1])){
  const spin=rows.length*.013,rotation=Math.PI/2-site-spin,cr=Math.cos(rotation),sr=Math.sin(rotation),cs=Math.cos(spin),ss=Math.sin(spin),pan=(rows.length%3-1)*.12;
  const center={x:r*Math.cos(site+spin)+pan,y:r*Math.sin(site+spin)};
  const frame:RenderFrame={state:initialState(),path:[],pathClosed:false,engine:false,camera:{center,rotation,scale},bodies:[{id:'planet',name:'Primus',radius:2048,position:origin,rotation:spin,surface:p,overview,color:raw.color,atmosphereColor:'#00000000',skyColor:'#00000000',horizonColor:'#00000000'}],theme:{highQuality:false,backdropStyle:'void',starsVisible:false,nebulaVisible:false,galaxiesVisible:false,gridEnabled:false},showShip:false,showPad:false,showScale:false,showBodyLabels:false};
  let overlays=tiles.draw(p,a=>querySurface(p,a).groundRadius,renderer,origin,spin,frame.camera!,640,480);for(let n=0;tiles.stats.pending&&n<50;n++){tiles.store.beginFrame();overlays=tiles.draw(p,a=>querySurface(p,a).groundRadius,renderer,origin,spin,frame.camera!,640,480);}
  renderer.draw({...frame,overlays});const pixels=new Uint8Array(640*480*4);if(gl)gl.readPixels(0,0,640,480,gl.RGBA,gl.UNSIGNED_BYTE,pixels);else pixels.set(canvas.getContext('2d')!.getImageData(0,0,640,480).data);let checked=0,wrong=0,worst=0;const failures=[];
  for(let x=10;x<630;x+=11)for(let y=wet?242:250;y<470;y+=wet?3:13){const dx=(x+.5-320)/scale,dy=(240-y-.5)/scale,wx=center.x+dx*cr+dy*sr,wy=center.y-dx*sr+dy*cr,bx=wx*cs+wy*ss,by=-wx*ss+wy*cs,q=querySurface(p,Math.atan2(by,bx)),depth=q.groundRadius-Math.hypot(bx,by);if((q.material==='water')!==wet||depth<2||depth>14)continue;
   const id=identity(bx,by);if([-1.6,0,1.6].some(a=>[-1.6,0,1.6].some(b=>identity(bx+a,by+b)!==id)))continue;
   const expected=[1,3,5].map(i=>parseInt(domain.colors[id].slice(i,i+2),16)),i=(((gl?479-y:y))*640+x)*4,rgb=Array.from(pixels.slice(i,i+3)),error=Math.max(...expected.map((v,i)=>Math.abs(v-rgb[i]!)));checked++;worst=Math.max(worst,error);if(error>(backend==='Canvas'?3:17)){wrong++;failures.push({x,y,depth,expected,rgb,error});}
  }
  rows.push({scale,checked,wrong,worst,failures,tiles:{...tiles.stats},error:gl?.getError()??0});
 }return rows;}finally{tiles.clear();tiles.store.clear();renderer.dispose?.();canvas.remove();}
}
Object.assign(window,{PlanetMaterialMotion:{run}});
