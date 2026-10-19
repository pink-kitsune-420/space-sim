import { test, expect, type Page } from '@playwright/test';
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { buildPortableModule } from '../../packages/module-tools/package.mjs';
// Keep fixed physical pixel probes independent of the browser device preset.
test.use({ deviceScaleFactor: 1 });
let directory:string,script:string,bundles:any[];
let airlessBodies: { id: string; name: string; radius: number; color?: string; accentColor?: string; atmosphereColor?: string }[];
test.beforeAll(async()=>{
  const bundle=await rolldown({input:'tests/fixtures/vehicle-host.ts',platform:'browser'});
  try{script=(await bundle.generate({format:'iife',name:'VehicleHost',exports:'named'})).output[0]!.code;}finally{await bundle.close();}
  directory=await mkdtemp(join(tmpdir(),'vehicle-browser-'));bundles=[];
  airlessBodies=[];
  for(const path of ['sandbox/default','astronomy/solar-system','astronomy/full-solar-system']){
    const universe=JSON.parse(await readFile(`games/space-sim/universes/${path}/universe.json`,'utf8'));
    airlessBodies.push(universe.systems.flatMap((system:any)=>system.bodies).find((body:any)=>body.name===(path==='sandbox/default'?'Parvus':'Moon')));
  }
  for(const name of ['vehicle-trainer','appearance-trainer','input-actions','player-controller','input-keyboard','input-touch','input-gamepad','camera-follow','local-views','render-canvas','render-webgl','shaders-vector','session-flight']){
    const source=join(directory,name);await cp(resolve('modules',name),source,{recursive:true});
    const built=await buildPortableModule(join(source,'module.json'),join(directory,`${name}.spacemod`),{typecheck:false,shippedBuild:true});
    bundles.push({name,manifest:built.descriptor.manifest,digest:built.integrity.digest,source:built.codeV2!.source,
      assets:[...built.files].filter(([path])=>built.descriptor.assets.some(asset=>asset.path===path)||built.descriptor.guides.includes(path)).map(([path,bytes])=>[path,Array.from(bytes)])});
  }
});
test.afterAll(async()=>{await rm(directory,{recursive:true,force:true});});
async function load(page:Page){
  await page.goto('about:blank');
  await page.setContent('<canvas id="canvas" style="width:320px;height:240px"></canvas><div id="touch" style="width:100px;height:80px;touch-action:none">Engine</div>');
  await page.addScriptTag({content:script});
  await page.evaluate(bundles=>{
    const h=(window as any).VehicleHost,graph=new h.ModuleRegistryV2(h.engineModuleServices());
    for(const bundle of bundles){const initialize=new Function(`"use strict";\n${bundle.source}\n;return SpaceSimModule.default;`)();
      graph.register({manifest:bundle.manifest,contentDigest:bundle.digest,supportsMultiplayer:true,initialize},h.moduleAssets(new Map(bundle.assets.map(([path,bytes]:any)=>[path,new Uint8Array(bytes)]))));}
    const profile={format:'space-sim-profile/2',id:'fixture.independent-flight',modules:bundles.map(b=>({id:b.manifest.id,version:b.manifest.version})),providers:Object.fromEntries(bundles.flatMap(b=>b.manifest.slots.map((slot:string)=>[slot,b.manifest.id]))),capabilities:{},settings:{}};
    const candidate=graph.prepare(profile,'browser'),get=(key:any)=>candidate.providedService(key);
    const definitions=candidate.contributions('vehicle').map((c:any)=>c.value),vehicles={format:'space-sim-vehicles/1',defaultId:h.TRAINER_VEHICLE_ID,definitions};
    const world=new h.World(h.DEFAULT_UNIVERSE,{vehicles}),sessions=get(h.FLIGHT_SESSIONS),host=sessions.host(world),pilot=host.seatLocal('Reader','a'.repeat(32)),ship=host.spawnShip(pilot,'planet-orbit');
    const actions=get(h.FLIGHT_ACTIONS).definitions,engine='spacelab.input-actions/engine';
    const binding={seatId:'reader',playerId:pilot,entityId:ship.id,viewportId:'map'};
    // This game explicitly adapts the public controller to the host's ownership checks.
    const adapter={schema:'spacelab-control-target/1',canControl:(b:any)=>world.record(b.entityId)?.ownerId===b.playerId,
      actions:()=>[engine],setAction:(b:any,_action:string,value:number)=>host.setControls(b.playerId,b.entityId,{turn:0,throttle:0,engine:value>0}),
      release:(b:any)=>{if(world.record(b.entityId)?.ownerId===b.playerId)host.setControls(b.playerId,b.entityId,{turn:0,throttle:0,engine:false});}};
    const keyboard=get(h.KEYBOARD_INPUT).create({actions,pilot:()=>0}),touch=get(h.TOUCH_INPUT).create({actions,pilot:()=>0,bindings:[{element:document.getElementById('touch'),action:engine,gesture:'hold'}]});
    let pad:any={index:0,id:'Test pad',connected:true,axes:[],buttons:[{pressed:false,touched:false,value:0}]};Object.defineProperty(navigator,'getGamepads',{value:()=>[pad],configurable:true});
    const gamepad=get(h.GAMEPAD_INPUT).create({actions,pad:()=>0,deadzone:.15,bindings:[{action:engine,button:0}]});
    const controller=get(h.PLAYER_CONTROLLERS).create(adapter,{pilot:0,sources:[keyboard]});controller.select(binding);
    const sample=()=>controller.sample({elapsed:.01,flightAllowed:true,shortcutsAllowed:true});
    const views=get(h.LOCAL_VIEWS).create({bindings:[{viewportId:'map',seatId:'reader',playerId:pilot,targetId:ship.id}],layout:'side',mode:'split',surface(){return{resize(){},draw(){},dispose(){}};}});views.reflow(320,240);
    const artwork=h.createVehicleArtwork(candidate.contributions('vehicleAppearance').map((c:any)=>c.value));
    (window as any).vehicle={h,graph,candidate,world,host,ship,binding,controller,sample,views,keyboard,touch,gamepad,get,artwork,
      setPad(pressed:boolean){pad.buttons[0]={pressed,touched:pressed,value:pressed?1:0};},disconnect(){pad=null;},reconnect(){pad={index:0,id:'Test pad',connected:true,axes:[],buttons:[{pressed:true,touched:true,value:1}]};}};
  },bundles);
}
test('an imported trainer flies with keyboard, touch and gamepad in a second game with replaceable independent cameras',async({page})=>{
  await load(page);
  await page.keyboard.down('Space');
  expect(await page.evaluate(()=>{const f=(window as any).vehicle;f.sample();f.host.step();return f.world.ship(f.ship.id).controls.engine;})).toBe(true);
  await page.keyboard.up('Space');
  expect(await page.evaluate(()=>{const f=(window as any).vehicle;f.sample();return f.world.ship(f.ship.id).controls.engine;})).toBe(false);
  await page.evaluate(()=>{const f=(window as any).vehicle;f.controller.bindInput({pilot:0,sources:[f.touch]});});
  await page.locator('#touch').dispatchEvent('pointerdown',{pointerId:1,pointerType:'touch',clientX:30,clientY:30,button:0});
  expect(await page.evaluate(()=>{const f=(window as any).vehicle;f.sample();f.host.step();return f.world.ship(f.ship.id).controls.engine;})).toBe(true);
  await page.locator('#touch').dispatchEvent('pointerup',{pointerId:1,pointerType:'touch'});
  expect(await page.evaluate(()=>{const f=(window as any).vehicle;f.sample();return f.world.ship(f.ship.id).controls.engine;})).toBe(false);
  const result=await page.evaluate(()=>{
    const f=(window as any).vehicle;f.controller.bindInput({pilot:0,sources:[f.gamepad]});f.sample();f.setPad(true);f.sample();f.host.step();const engine=f.world.ship(f.ship.id).controls.engine;
    f.disconnect();f.sample();const disconnected=f.world.ship(f.ship.id).controls.engine;f.reconnect();f.sample();const reconnectHeld=f.world.ship(f.ship.id).controls.engine;
    f.setPad(false);f.sample();f.setPad(true);f.sample();const freshPress=f.world.ship(f.ship.id).controls.engine;
    f.views.camera('map').changeZoom(2);const before=f.world.tick;f.views.render(.01,(id:string)=>({position:f.world.ship(id).state.position,orientation:0}));const camera=f.views.camera('map').frame({width:320,height:240,elapsed:.01,transform:(id:string)=>({position:f.world.ship(id).state.position,orientation:0})});
    const tick=f.world.tick;f.controller.dispose();const released=f.world.ship(f.ship.id).controls.engine;
    const saved=JSON.stringify(f.h.saveWorld(f.world));f.views.dispose();const unchanged=JSON.stringify(f.h.saveWorld(f.world))===saved;
    const publicOnly=!f.candidate.lock.order.some((id:string)=>id.includes('navball')||id.includes('hud')||id.includes('mod-menu'));const identity=f.world.ship(f.ship.id).vehicleId;
    f.candidate.dispose();f.world.dispose();return{engine,disconnected,reconnectHeld,freshPress,released,before,tick,camera,unchanged,publicOnly,identity};
  });
  expect(result).toMatchObject({engine:true,disconnected:false,reconnectHeld:false,freshPress:true,released:false,unchanged:true,publicOnly:true,identity:'spacelab.trainer/orbit-trainer'});expect(result.tick).toBe(result.before);expect(result.camera.scale).toBeGreaterThan(0);
});

for(const renderer of ['canvas','webgl'] as const)test(`shared trainer vector data draws primary and mixed fleet shapes with ${renderer}, with an optional-artwork fallback`,async({page})=>{
  await load(page);
  const result=await page.evaluate(renderer=>{
    const f=(window as any).vehicle,h=f.h,canvas=document.getElementById('canvas') as HTMLCanvasElement;
    const shapes=f.candidate.contributions('vehicleAppearance').map((c:any)=>c.value),custom={vehicleId:'fixture.square/test',hull:[{x:20,y:-20},{x:-20,y:-20},{x:-20,y:20},{x:20,y:20}]},art=h.createVehicleArtwork([...shapes,custom]);
    const provider=f.get(renderer==='canvas'?h.CANVAS_DRAWING:h.WEBGL_DRAWING),shaders=f.get(h.VECTOR_SHADERS).defaults;
    const drawing=renderer==='canvas'?provider.create(canvas,{vehicles:art}):provider.create(canvas,shaders,{vehicles:art});
    const frame={state:{time:0,position:{x:0,y:0},velocity:{x:0,y:0},heading:0,throttle:1,status:'flying',revision:0},camera:{center:{x:0,y:0},rotation:0,scale:1},path:[],pathClosed:false,engine:true,showShipLabels:false,showScale:false,
      ships:[{id:'mixed',vehicleId:custom.vehicleId,position:{x:60,y:0},heading:0,status:'flying',engine:false,throttle:0,label:''},{id:'trainer',position:{x:-60,y:0},heading:0,status:'flying',engine:true,throttle:1,label:''}]};
    const before=JSON.stringify(h.saveWorld(f.world));drawing.draw(frame);
    const pixel=(x:number,y:number)=>{if(renderer==='canvas')return Array.from(canvas.getContext('2d')!.getImageData(x,y,1,1).data);const gl=canvas.getContext('webgl2')!,bytes=new Uint8Array(4);gl.readPixels(x,canvas.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes);};
    const trainer=pixel(166,120),flame=pixel(142,120),mixed=pixel(230,130),background=pixel(230,155);
    drawing.draw({...frame,vehicleId:'fixture.unknown/craft',ships:[]});const absent=pixel(166,120),marker=pixel(160,120);
    drawing.dispose();const unchanged=JSON.stringify(h.saveWorld(f.world))===before;f.candidate.dispose();f.world.dispose();return{trainer,flame,mixed,background,absent,marker,unchanged};
  },renderer);
  expect(result.unchanged).toBe(true);expect(result.trainer).not.toEqual(result.absent);expect(result.mixed).not.toEqual(result.background);expect(result.flame).not.toEqual(result.background);expect(result.marker).not.toEqual(result.background);
});

for(const renderer of ['canvas','webgl'] as const)test(`airless bundled moons have no orbital or surface atmosphere while lit worlds retain daylight with ${renderer}`,async({page})=>{
  await load(page);
  const results=await page.evaluate(({renderer,bodies})=>{
    const f=(window as any).vehicle,h=f.h,canvas=document.getElementById('canvas') as HTMLCanvasElement;
    const provider=f.get(renderer==='canvas'?h.CANVAS_DRAWING:h.WEBGL_DRAWING),shaders=f.get(h.VECTOR_SHADERS).defaults;
    const drawing=renderer==='canvas'?provider.create(canvas):provider.create(canvas,shaders);
    const pixel=(x:number,y:number)=>{if(renderer==='canvas')return Array.from(canvas.getContext('2d')!.getImageData(x,y,1,1).data);const gl=canvas.getContext('webgl2')!,bytes=new Uint8Array(4);gl.readPixels(x,canvas.height-y-1,1,1,gl.RGBA,gl.UNSIGNED_BYTE,bytes);return Array.from(bytes);};
    const results=[];
    for(const source of bodies)for(const surface of [false,true]){
      const body={id:source.id,name:source.name,radius:source.radius,position:{x:0,y:0},color:source.color,accentColor:source.accentColor,atmosphereColor:source.atmosphereColor,sunDirection:{x:1,y:0}};
      const camera={center:{x:0,y:surface?body.radius:0},rotation:0,scale:surface?2560/body.radius:70/body.radius};
      const draw=(atmosphereColor:string)=>drawing.drawScene({time:0,camera,bodies:[{...body,atmosphereColor}],showScale:false,showBodyLabels:false});
      draw(body.atmosphereColor!);const airless=pixel(160,surface?110:47),day=pixel(190,120),night=pixel(130,120);
      draw('#00000000');const vacuum=pixel(160,surface?110:47);
      draw('#48cae480');const atmospheric=pixel(160,surface?110:47);
      results.push({name:body.name,surface,airless,vacuum,atmospheric,day,night});
    }
    drawing.dispose();f.candidate.dispose();f.world.dispose();return results;
  },{renderer,bodies:airlessBodies});
  for(const result of results){
    expect(result.airless).toEqual(result.vacuum);
    expect(result.atmospheric).not.toEqual(result.vacuum);
    if(!result.surface)expect(result.day.slice(0,3).some((channel,index)=>channel>result.night[index]!+3)).toBe(true);
  }
});
