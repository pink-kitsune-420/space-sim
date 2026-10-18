import type { SceneFrame, State, SurfaceProfile, SurfaceQuery } from '../../packages/game-api/src/index';
import { test, expect } from '@playwright/test';
import { cp, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
let directory: string;
let bundles: Record<string, { source: string; assets: Record<string,string> }>;
test.use({ viewport: {width:800,height:600} });
test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(),'portable-viewer-browser-')); bundles = {};
  for (const name of ['render-canvas','render-webgl','shaders-vector','theme','theme-customizer','audio-procedural','audio-controls']) {
    const folder = join(directory,name); await cp(resolve(`modules/${name}`),folder,{recursive:true});
    const built = await buildPortableModule(join(folder,'module.json'),join(directory,`${name}.spacemod`),{typecheck:false,shippedBuild:true});
    bundles[name] = {source:built.codeV2!.source,assets:Object.fromEntries(built.descriptor.assets.map(asset => [asset.path,new TextDecoder().decode(built.files.get(asset.path)!)]))};
  }
});
test.afterAll(async () => { await rm(directory,{recursive:true,force:true}); });

async function load(page: import('@playwright/test').Page) {
  await page.goto('about:blank');
  await page.setContent('<div id="viewer"><div class="view-toolbar"><div></div></div><canvas id="canvas" style="width:320px;height:240px"></canvas><button id="sound">Sound</button><input id="volume" type="range"><p id="status"></p></div>');
  await page.evaluate(bundles => {
    const services = new Map<string,any>(), owned: {dispose():void}[] = [];
    const geometry = {querySurface(profile:SurfaceProfile,angle:number):SurfaceQuery { return {elevation:0,intervalIndex:0,groundNormal:{x:Math.cos(angle),y:Math.sin(angle)},firstContactRadius:profile.referenceRadius,groundRadius:profile.referenceRadius,waterDepth:0,material:'rock',normal:{x:Math.cos(angle),y:Math.sin(angle)}}; }};
    for (const bundle of Object.values(bundles)) {
      const initialize = new Function(`"use strict";\n${bundle.source}\n;return SpaceSimModule.default;`)();
      initialize({settings:{},contributeGuide(){},assets:{text(path:string){if(!(path in bundle.assets))throw new Error('Missing asset');return bundle.assets[path];}},
        use(key:any){if(key.slot!=='core.motion')throw new Error('Unexpected private service');return {services:{surfaces:{query:geometry.querySurface}}};},
        provide(key:any,value:any){services.set(key.slot,value);},own(value:any){owned.push(value);return value;}});
    }
    (window as any).viewerFixture={services,owned,geometry};
  },bundles);
}

test('portable body viewers need no trainer, flight HUD, private world or default planet; graphics resources belong to their provider',async({page})=>{
  await load(page);
  const result=await page.evaluate(async()=>{
    const {services}= (window as any).viewerFixture;
    const canvas=document.getElementById('canvas') as HTMLCanvasElement, canvasFactory=services.get('render.canvas');
    const labels:string[]=[];const context=canvas.getContext('2d')!,text=context.fillText.bind(context);
    context.fillText=((value:string,...args:any[])=>{labels.push(value);return Reflect.apply(text,context,[value,...args]);}) as typeof context.fillText;
    const renderer=canvasFactory.create(canvas);
    const frame:SceneFrame={time:2,camera:{center:{x:0,y:0},scale:1,rotation:0},bodies:[{id:'survey-body',name:'Survey',position:{x:0,y:0},radius:40,color:'#c83725',surfaceFeatures:'smooth'}],showScale:false,showShipLabels:false};
    renderer.drawScene(frame);const canvasPixel=Array.from(context.getImageData(160,120,1,1).data);
    canvasFactory.dispose();let canvasRejected=false;try{canvasFactory.create(canvas);}catch{canvasRejected=true;}
    const glCanvas=document.createElement('canvas');glCanvas.style.cssText='width:320px;height:240px';document.body.append(glCanvas);
    const shader=services.get('render.vector-shaders'), webglFactory=services.get('render.webgl');
    const invalidCanvas=document.createElement('canvas'),nativeGet=invalidCanvas.getContext.bind(invalidCanvas);let invalidContexts=0,invalidRejected=false;
    invalidCanvas.getContext=((...args:any[])=>{invalidContexts++;return Reflect.apply(nativeGet,invalidCanvas,args);}) as typeof invalidCanvas.getContext;
    try{webglFactory.preview(invalidCanvas,{...shader.defaults,passes:{...shader.defaults.passes,scene:{vertex:'',fragment:''}}});}catch{invalidRejected=true;}
    const webgl=webglFactory.create(glCanvas,shader.defaults);
    for(let i=0;i<10;i++){webgl.drawScene(frame);await new Promise(requestAnimationFrame);}
    const gl=glCanvas.getContext('webgl2')!,pixel=new Uint8Array(4);webgl.drawScene(frame);gl.readPixels(160,120,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);const error=gl.getError();
    const previewCanvas=document.createElement('canvas');previewCanvas.style.cssText='width:96px;height:96px';document.body.append(previewCanvas);
    const preview=webglFactory.preview(previewCanvas,shader.defaults);preview.draw(frame.bodies![0]!);webglFactory.dispose();
    let webglRejected=false;try{webglFactory.create(glCanvas,shader.defaults);}catch{webglRejected=true;}
    return {canvasPixel,webglPixel:Array.from(pixel),labels,canvasRejected,webglRejected,invalidContexts,invalidRejected,error,lost:gl.isContextLost(),previewReady:preview.ready};
  });
  expect(result.canvasPixel[0]).toBeGreaterThan(20);expect(result.webglPixel[0]).toBeGreaterThan(20);
  expect(result.labels.some(label=>label.includes('VESSEL')||label.includes('PRIMUS'))).toBe(false);
  expect(result).toMatchObject({canvasRejected:true,webglRejected:true,invalidContexts:0,invalidRejected:true,error:0,lost:true,previewReady:false});
});

test('materials preserve the authoritative surface mask; ordered post effects compile atomically and release their GPU resources',async({page})=>{
  await load(page);
  const result=await page.evaluate(async()=>{
    const {services}= (window as any).viewerFixture, factory=services.get('render.webgl');
    const canvas=document.getElementById('canvas') as HTMLCanvasElement;
    const renderer=factory.create(canvas,services.get('render.vector-shaders').defaults), gl=canvas.getContext('webgl2')!;
    const counts={programs:0,framebuffers:0,textures:0,renderbuffers:0};
    // Track only additional effect resources; the base renderer retains its own programs/textures.
    for(const [kind,singular] of [['programs','Program'],['framebuffers','Framebuffer'],['textures','Texture'],['renderbuffers','Renderbuffer']] as const){
      const tracked=new Set<any>(),object=gl as any,create=object[`create${singular}`].bind(gl),remove=object[`delete${singular}`].bind(gl);
      object[`create${singular}`]=()=>{const value=create();if(value){tracked.add(value);counts[kind]++;}return value;};object[`delete${singular}`]=(value:any)=>{if(tracked.delete(value))counts[kind]--;return remove(value);};
    }
    const material={id:'fixture.effects/red',bodyIds:['surface'],fragment:'vec4 material(vec2 p){return vec4(m_red,0.0,0.0,1.0);}',uniforms:{m_red:1}};
    const post=[{id:'fixture.effects/second',fragment:'vec4 effect(vec2 uv,vec4 color){return color+vec4(0.0,p_green,0.0,0.0);}',uniforms:{p_green:.25},after:['fixture.effects/first'],scale:1},
      {id:'fixture.effects/first',fragment:'vec4 effect(vec2 uv,vec4 color){return vec4(color.r,p_green,color.b,1.0);}',uniforms:{p_green:.25},after:[],scale:.5}];
    const surface:SurfaceProfile={identity:'survey-surface',referenceRadius:40,orientationRadians:0,sampleCount:64,coastAngles:[],hasWater:false,bounds:{minRadius:40,maxRadius:40,maxAbsDerivative:0,maxSlope:0},features:[],pads:[],storageBytes:0,sampleElevation(){return 0;},intervalBounds(){return this.bounds;},copyElevations(){return new Float64Array(64);}};
    const frame:SceneFrame={time:3,camera:{center:{x:0,y:0},scale:1,rotation:0},bodies:[{id:'surface',name:'Survey',position:{x:0,y:0},radius:40,surface,atmosphereColor:'#00000000',surfaceFeatures:'smooth'}],showScale:false,showShipLabels:false};
    // Finish asynchronous base shader work before tracking atomic effect replacements.
    for(let i=0;i<10;i++){renderer.drawScene(frame);await new Promise(requestAnimationFrame);}
    const baseline={...counts};renderer.features.effects.configure([material],post);renderer.drawScene(frame);
    const read=(x:number,y:number)=>{const pixel=new Uint8Array(4);gl.readPixels(x,y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return Array.from(pixel);};
    const inside=read(160,120),outside=read(20,20),before={...counts};let rejected=0;
    for(const invalid of [
      [{...post[0],fragment:'not valid GLSL'},post[1]],
      [{...post[0],after:['fixture.effects/first']},{...post[1],after:['fixture.effects/second']}],
      [{...post[0],after:[],fragment:'uniform sampler2D u_unapproved;vec4 effect(vec2 uv,vec4 color){return texture(u_unapproved,uv);}'}],
    ]){try{renderer.features.effects.configure([material],invalid);}catch{rejected++;}}
    renderer.drawScene(frame);const retained=read(160,120),after={...counts},error=gl.getError();
    renderer.features.effects.configure([],[]);const afterClear={...counts};factory.dispose();const released={...counts};
    return {inside,outside,retained,before,after,released,afterClear,baseline,error,rejected};
  });
  expect(result.inside).toEqual([255,128,0,255]);expect(result.outside[0]).toBeLessThan(50);expect(result.outside[1]).toBe(128);
  expect(result.retained).toEqual(result.inside);expect(result.rejected).toBe(3);expect(result.error).toBe(0);expect(result.after).toEqual(result.before);expect(result.afterClear).toEqual(result.baseline);
  expect(result.released).toEqual({programs:0,framebuffers:0,textures:0,renderbuffers:0});
});

test('theme and sound controls are reusable, isolated, persistent and disposable without stale shortcuts or pending audio',async({page})=>{
  await load(page);
  const result=await page.evaluate(()=>{
    const {services}= (window as any).viewerFixture, root=document.getElementById('viewer')!,themes=services.get('presentation.themes');
    const saved=new Map<string,string>(),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
    const original=root.getAttribute('data-window-style'),theme=themes.create({root,storage}),other=themes.create();
    const controls=services.get('ui.theme-customizer').create({root,theme,storage});controls.open();
    root.querySelector<HTMLButtonElement>('[data-window-option="apollo"]')!.click();const changed=theme.current().windowStyle;
    const unrelated=other.current().windowStyle;const dialogCount=root.querySelectorAll('#theme-dialog').length;
    controls.dispose();const before=theme.current().gridEnabled;window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',cancelable:true}));const stale=theme.current().gridEnabled!==before;
    const replacement=services.get('ui.theme-customizer').create({root,theme,storage});const restored=replacement.getSettings().windowStyle;replacement.dispose();
    const calls:string[]=[],makeOutput=()=>({resume:async()=>{},suspend(){calls.push('suspend');},setVolume(){},setThrust(level:number){calls.push(`thrust:${level}`);},play(cue:string){calls.push(cue);},dispose(){calls.push('dispose');}});
    const audio=services.get('audio.flight-controls').create({toggle:document.getElementById('sound'),slider:document.getElementById('volume'),status:document.getElementById('status'),storage});
    audio.setProvider({id:'fixture.sound',version:'1.0.0',label:'Survey sound',create:makeOutput});
    document.getElementById('sound')!.click();document.getElementById('sound')!.click();
    const state:State={time:2,status:'landed',throttle:.5,position:{x:0,y:40},velocity:{x:0,y:0},heading:0,revision:0};audio.status('flying',state,false,true);audio.status('flying',state,false,true);
    audio.reset(2);audio.status('flying',state,false,true);audio.flight({...state,status:'flying'},true,false,1,false,true);
    audio.dispose();const mount=document.createElement('section');mount.textContent='Previous content';root.append(mount);
    const mounted=services.get('audio.flight-controls').mount({root:mount,storage,prefix:'survey-sound'});
    const mountedUi=!!mount.querySelector('#survey-sound-toggle');mounted.dispose();const mountRestored=mount.textContent==='Previous content';
    const soundWrites=saved.get('space-sim.audio/1');document.getElementById('sound')!.click();
    const noStaleAudio=saved.get('space-sim.audio/1')===soundWrites;
    theme.dispose();other.dispose();themes.dispose();return {changed,unrelated,dialogCount,stale,restored,calls,noStaleAudio,mountedUi,mountRestored,restoredDom:root.getAttribute('data-window-style')===original,styles:document.head.querySelectorAll('style').length,dialogs:root.querySelectorAll('#theme-dialog').length};
  });
  expect(result).toMatchObject({changed:'apollo',unrelated:'classic',dialogCount:1,stale:false,restored:'apollo',noStaleAudio:true,mountedUi:true,mountRestored:true,restoredDom:true,styles:0,dialogs:0});
  expect(result.calls.filter(cue=>cue==='land')).toHaveLength(1);expect(result.calls).toContain('thrust:0.5');expect(result.calls).toContain('dispose');
});

test('portable providers finish borrowed cleanup and restore every control root after a child fails',async({page})=>{
 await load(page);
 const result=await page.evaluate(()=>{
  const {services}=(window as any).viewerFixture,root=document.getElementById('viewer')!,themes=services.get('presentation.themes'),theme=themes.create();
  const sections=[0,1].map(index=>{const section=document.createElement('section');section.textContent=`Original ${index}`;root.append(section);return section;});
  const controls=services.get('ui.theme-customizer'),failures:string[]=[];
  const badTheme={...theme,subscribe(listener:any){const lease=theme.subscribe(listener);return{dispose(){lease.dispose();throw new Error('theme subscription failure');}};}};
  controls.create({root:sections[0],theme:badTheme});controls.create({root:sections[1],theme});
  const collect=(error:any):void=>{if(error instanceof AggregateError)error.errors.forEach(collect);else failures.push(error.message);};
  try{controls.dispose();}catch(error){collect(error);}
  controls.dispose();
  const themeReleased=sections.every(section=>!section.querySelector('#theme-dialog'))&&document.head.querySelectorAll('style').length===0;
  const audioFactory=services.get('audio.flight-controls'),closed:number[]=[],saved=new Map<string,string>(),storage={getItem:(key:string)=>saved.get(key)??null,setItem:(key:string,value:string)=>{saved.set(key,value);}};
  const buttons:HTMLButtonElement[]=[];
  for(let index=0;index<2;index++){
   const audio=audioFactory.mount({root:sections[index],storage,prefix:`failure-sound-${index}`});
   audio.setProvider({id:'fixture.failure-sound',version:'1.0.0',label:'Failure sound',create(){return{resume:async()=>{},suspend(){},setVolume(){},setThrust(){},play(){},dispose(){closed.push(index);if(index===0)throw new Error('audio output failure');}};}});
   const button=sections[index]!.querySelector<HTMLButtonElement>('button')!;buttons.push(button);button.click();button.click();
  }
  try{audioFactory.dispose();}catch(error){collect(error);}audioFactory.dispose();
  const old=saved.get('space-sim.audio/1');buttons.forEach(button=>button.click());
  let audioRejected=false,themeRejected=false;
  try{audioFactory.mount({root:sections[0]});}catch{audioRejected=true;}
  try{controls.create({root:sections[0],theme});}catch{themeRejected=true;}
  theme.dispose();themes.dispose();
  return{failures,closed,themeReleased,roots:sections.map(section=>section.textContent),staleWrites:saved.get('space-sim.audio/1')!==old,audioRejected,themeRejected};
 });
 expect(result).toEqual({failures:['theme subscription failure','audio output failure'],closed:[0,1],themeReleased:true,roots:['Original 0','Original 1'],staleWrites:false,audioRejected:true,themeRejected:true});
});
