import { expect, it } from 'vitest';
import { World } from '../../packages/sim-core/src/world';
import { DEFAULT_UNIVERSE } from '../../packages/sim-core/src/universe';
import { createSimulationContext } from '../../packages/sim-core/src/context';
import { elements, propagate } from '../../packages/sim-core/src/orbit';
import { frameSample, TRAJECTORY_MAX_SAMPLES } from '../../packages/sim-core/src/trajectory';
import { initialState } from '../../packages/sim-core/src/context';
import { Prediction } from '../../modules/flight-prediction/src/index';
import { trajectoryMarkers, getPathGeometry, type GhostEnd, type GhostSample, type State, type UniverseDefinition } from '../../packages/game-api/src/index';

function trace(job: Generator<GhostSample, GhostEnd>) {
 const samples: GhostSample[] = [];
 for (let count = 0; count < TRAJECTORY_MAX_SAMPLES + 8; count++) {
  const r = job.next(); if (r.done) return { samples, end: r.value }; samples.push(r.value);
 }
 throw new Error('Unbounded forecast');
}
function flyby(world: World) {
 const ship = world.spawn({ownerId:'pilot',presetId:'planet-orbit'}), system = world.system;
 const moon = system.getBodyPosition('moon',0), planet = system.getBodyPosition('planet',0);
 const mv = system.getBodyVelocity('moon',0), pv = system.getBodyVelocity('planet',0);
 const state = {...ship.state, position:{x:moon.x-planet.x-3000,y:moon.y-planet.y+600},velocity:{x:mv.x-pv.x+80,y:mv.y-pv.y}};
 world.put({...ship,state}); return ship.id;
}
it('continues through moving moon entry and exit with live fixed-grid frame/velocity agreement',()=>{
 const world = new World(DEFAULT_UNIVERSE), live = new World(DEFAULT_UNIVERSE), id = flyby(world); flyby(live);
 const before = JSON.stringify(world.ships()), result = trace(world.predictShip(id));
 expect(JSON.stringify(world.ships())).toBe(before);expect(world.tick).toBe(0);
 const encounters = result.samples.filter(s=>s.encounter);
 expect(encounters.slice(0,2).map(s=>s.encounter)).toEqual([{from:'planet',to:'moon'},{from:'moon',to:'planet'}]);
 expect(result.samples.at(-1)!.time).toBeGreaterThan(encounters[1]!.time);
 for(const predicted of encounters.slice(0,2)) {
  while(live.time < predicted.time - .005) live.step();
  const ship=live.ship(id)!, actual = frameSample({time:ship.state.time,position:ship.state.position,velocity:ship.state.velocity},ship.bodyId,'planet',live.system);
  expect(ship.bodyId).toBe(predicted.bodyId);expect(Math.abs(actual.time-predicted.time)).toBeLessThan(1e-6);
  expect(Math.hypot(actual.position.x-predicted.position.x,actual.position.y-predicted.position.y)).toBeLessThan(.001);
  expect(Math.hypot(actual.velocity.x-predicted.velocity.x,actual.velocity.y-predicted.velocity.y)).toBeLessThan(1e-5);
 }
 expect(['horizon','impact','open']).toContain(result.end);world.dispose();live.dispose();
});
it('captures future encounter bodies in the same moving reference frame as the ship path',()=>{
 const world=new World(DEFAULT_UNIVERSE),id=flyby(world),result=trace(world.predictShip(id)),point=result.samples.find(p=>p.encounter)!;
 const body=world.body(point.encounter!.to),at=world.system.getBodyPosition(body.id,point.time),origin=world.system.getBodyPosition(point.frameId!,point.time);
 expect(point.encounterBody).toEqual({name:body.name,radius:body.radius,position:{x:at.x-origin.x,y:at.y-origin.y}});
 const now=world.system.getBodyPosition(body.id,0),base=world.system.getBodyPosition(point.frameId!,0);
 expect(Math.hypot(at.x-origin.x-now.x+base.x,at.y-origin.y-now.y+base.y)).toBeGreaterThan(1);
 const reverse=frameSample({time:123,position:{x:1,y:2},velocity:{x:3,y:4}},'planet','moon',world.system,{from:'moon',to:'planet'});
 const planet=world.system.getBodyPosition('planet',123),moon=world.system.getBodyPosition('moon',123);
 expect(reverse.encounterBody!.position).toEqual({x:planet.x-moon.x,y:planet.y-moon.y});world.dispose();
});
it('includes the same timed body snapshots in conservative shared-rule forecasts without mutating authority',()=>{
 const world=new World(DEFAULT_UNIVERSE,{rules:[{moduleId:'test.noop',version:'0.1.0',hook:{modelIdentity:'noop/v1',seed:7,initialState:{version:1,value:0},evaluate:({state})=>({state})}}]});
 const id=flyby(world),before=JSON.stringify({ships:world.ships(),state:world.moduleState,time:world.time}),samples=trace(world.predictShip(id)).samples;
 const entry=samples.find(p=>p.encounter);expect(entry).toBeDefined();const at=world.system.getBodyPosition(entry!.encounter!.to,entry!.time),base=world.system.getBodyPosition(entry!.frameId!,entry!.time);
 expect(entry!.encounterBody!.position).toEqual({x:at.x-base.x,y:at.y-base.y});expect(JSON.stringify({ships:world.ships(),state:world.moduleState,time:world.time})).toBe(before);world.dispose();
});
it('places ghost bodies with one origin translation, camera-upright offsets and bounded legacy-compatible markers',()=>{
 const sample:GhostSample={time:20,position:{x:100,y:0},velocity:{x:0,y:1},frameId:'planet',bodyId:'moon',encounter:{from:'planet',to:'moon'},encounterBody:{position:{x:400,y:500},name:'Future moon',radius:20}};
 const state={...initialState('planet-orbit'),time:10},camera={center:{x:0,y:0},scale:2,rotation:Math.PI/2},frame={state,path:[sample],pathClosed:false,engine:false,camera,pathOrigin:{x:1000,y:2000}};
 const markers=trajectoryMarkers(frame),circle=markers.find(p=>p.kind==='circle'&&p.color==='#dba76a90');
 expect(circle).toMatchObject({center:{x:1400,y:2500},radius:20});
 const label=markers.find(p=>p.kind==='text'&&p.text.includes('at SOI'));expect(label).toMatchObject({at:{x:1419,y:2500},text:'Future moon at SOI · T−10.0 s'});
 const many=Array.from({length:100},(_,i)=>({...sample,time:20+i,encounter:{from:'planet',to:`moon-${i}`}}));
 const bounded=trajectoryMarkers({...frame,path:many});expect(bounded.filter(p=>p.kind==='text'&&p.text.includes('at SOI'))).toHaveLength(4);expect(bounded.length).toBeLessThanOrEqual(44);
 const repeated=trajectoryMarkers({...frame,path:[sample,{...sample,time:30}]});expect(repeated.filter(p=>p.kind==='text'&&p.text.includes('at SOI'))).toHaveLength(1);
 expect(trajectoryMarkers({...frame,path:[{...sample,encounterBody:undefined}]})).toHaveLength(2);
 expect(trajectoryMarkers({...frame,path:[{...sample,frameId:'moon'}]})).toHaveLength(2);
 expect(trajectoryMarkers({...frame,state:{...state,time:21}})).toHaveLength(0);
});
it('closes huge and eccentric unobstructed single-body orbits accurately, beyond the former radius and dt limits',()=>{
 const context=createSimulationContext(), body={id:'large',radius:512,mu:13107200};
 for(const [radius,speed] of [[1e7,Math.sqrt(body.mu/1e7)],[1000,Math.sqrt(body.mu/1000)*1.4]]) {
  const state:State={...initialState('planet-orbit'),position:{x:0,y:radius!},velocity:{x:speed!,y:0}}, result=trace(context.predict(state,false,body));
  expect(result.end).toBe('closed');expect(result.samples.length).toBeLessThan(256);
  expect(result.samples.at(-1)!.time).toBeCloseTo(elements(state,body.mu).period!,5);
  for(const sample of result.samples) {
   const exact=propagate(state,body.mu,sample.time);if(!exact.ok)throw Error('reference');
   expect(Math.hypot(sample.position.x-exact.state.position.x,sample.position.y-exact.state.position.y)).toBeLessThan(radius!*1e-10);
  }
 }
 context.dispose();
});
it('gives a useful first-frame orbit, progresses during ordinary flight and cancels changed burns immediately',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),prediction=new Prediction(()=>{}, {maxMs:16});
 world.step();let s=world.ship(ship.id)!;
 prediction.update(world.context,s.state,world.body(s.bodyId),world.surface(s.bodyId),s.id,1/60,false,s.controls,world);
 // A useful first-frame prefix is guaranteed by this fixture. A loaded runner
 // may exhaust the wall-time budget before closing the orbit; finish progressively.
 expect(prediction.path.length).toBeGreaterThan(20);
 for(let frame=0;frame<20&&prediction.pass;frame++)prediction.update(world.context,s.state,world.body(s.bodyId),world.surface(s.bodyId),s.id,1/60,false,s.controls,world);
 expect(prediction.pass).toBeUndefined();expect(prediction.pathEnd).toBe('closed');
 prediction.invalidate();const id=flyby(world);s=world.ship(id)!;
 for(let frame=0;frame<200;frame++) {
  prediction.update(world.context,s.state,world.body(s.bodyId),world.surface(s.bodyId),s.id,1/60,false,s.controls,world);
  if(!prediction.pass) break;
  for(let tick=0;tick<2;tick++)world.step();s=world.ship(id)!;
 }
 expect(prediction.pass).toBeUndefined();expect(prediction.path.some(s=>s.encounter)).toBe(true);
 const count=prediction.passCount;
 world.setControls(id,{turn:0,throttle:0,engine:true});world.step();s=world.ship(id)!;
 prediction.update(world.context,s.state,world.body(s.bodyId),world.surface(s.bodyId),s.id,1/60,true,s.controls,world);
 const path=prediction.path,key=prediction.passKey;
 world.step();s=world.ship(id)!;prediction.update(world.context,s.state,world.body(s.bodyId),world.surface(s.bodyId),s.id,1/60,true,s.controls,world);
 expect(prediction.passCount).toBeGreaterThan(count+1);expect(prediction.passKey).not.toBe(key);expect(prediction.path).not.toBe(path);expect(prediction.path[0]?.time).toBe(s.state.time);
 prediction.dispose();world.dispose();
});
it('bounds unbound previews and labels future SOI encounters with their times',()=>{
 const world=new World(DEFAULT_UNIVERSE),id=flyby(world), result=trace(world.predictShip(id)),ship=world.ship(id)!;
 expect(result.samples.length).toBeLessThanOrEqual(TRAJECTORY_MAX_SAMPLES+2);
 const markers=trajectoryMarkers({state:ship.state,path:result.samples,pathClosed:false,camera:{center:{x:0,y:0},scale:1,rotation:0},engine:false});
 expect(markers.some(m=>m.kind==='text'&&m.text.includes('Parvus · T−'))).toBe(true);
 expect(trajectoryMarkers({state:{...ship.state,time:1e8},path:result.samples,pathClosed:false,camera:{center:{x:0,y:0},scale:1,rotation:0},engine:false})).toEqual([]);
 world.dispose();
});
it('terminates a world forecast at actual terrain contact, preserving the verified material and impact velocity',()=>{
 const universe: UniverseDefinition = {...DEFAULT_UNIVERSE,defaultSystemId:'contact',systems:[{
  id:'contact',name:'Contact',centralBodyId:'rock',bodies:[{id:'rock',name:'Rock',radius:10,mu:100,
   surface:{kind:'radial' as const,generatorVersion:1,seed:0,sampleCount:64,maxReliefMetres:2,minFeatureWidthMetres:4,orientationRadians:0,mountainRangeCount:0,craterCount:0,
    pads:[{id:'crater',angleRadians:Math.PI*1.5,widthMetres:4,elevationMetres:-2}]} }],
  presets:[{id:'descent',name:'Descent',bodyId:'rock',kind:'state' as const,position:[0,-9] as const,velocity:[0,0] as const}]}]};
 const world=new World(universe),ship=world.spawn({ownerId:'pilot',presetId:'descent'}),result=trace(world.predictShip(ship.id));
 expect(result.end).toBe('impact');const hit=result.samples.at(-1)!;
 for(let tick=0;tick<1000&&!world.ship(ship.id)!.state.contact;tick++)world.step();
 const contact=world.ship(ship.id)!.state.contact!;
 expect(hit.time).toBe(contact.time);expect(hit.velocity).toEqual(contact.impactVelocity);expect(hit.position).toEqual(world.ship(ship.id)!.state.position);
 world.dispose();
});

it('refreshes cached Hermite geometry when a prediction sample buffer is reused',()=>{
 const sample=(x:number,time:number):GhostSample=>({position:{x,y:0},velocity:{x:1,y:0},time});
 const buffer=[sample(0,0),sample(1,1)], first=getPathGeometry(buffer).controls[0];
 buffer.length=0;buffer.push(sample(50,0),sample(70,1));
 expect(getPathGeometry(buffer).controls[0]).not.toEqual(first);
 expect(getPathGeometry(buffer).cumulativeChords).toEqual([0,20]);
});

it('invalidates a paused same-epoch state replacement instead of retaining the previous orbit',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'}),prediction=new Prediction(()=>{}, {maxMs:16}),body=world.body(ship.bodyId);
 prediction.update(world.context,ship.state,body,undefined,ship.id,0,false,ship.controls,world);const before=prediction.passCount;
 const changed={...ship.state,velocity:{x:ship.state.velocity.x+15,y:0}};world.put({...ship,state:changed});
 prediction.update(world.context,changed,body,undefined,ship.id,0,false,ship.controls,world);
 expect(prediction.passCount).toBe(before+1);expect(prediction.path[0]!.velocity).toEqual(changed.velocity);
 prediction.dispose();world.dispose();
});

it('retains a circular-body impact endpoint, incoming velocity and fractional contact time through the world predictor',()=>{
 const world=new World(DEFAULT_UNIVERSE),ship=world.spawn({ownerId:'pilot',presetId:'planet-orbit'});
 const state={...ship.state,velocity:{x:50,y:0}};world.put({...ship,state});const result=trace(world.predictShip(ship.id)),hit=result.samples.at(-1)!;
 expect(result.end).toBe('impact');expect(Math.hypot(hit.position.x,hit.position.y)).toBeCloseTo(world.body(ship.bodyId).radius,7);
 expect(Math.hypot(hit.velocity.x,hit.velocity.y)).toBeGreaterThan(50);expect(hit.linear).toBe(true);
 while(world.time<hit.time+.005)world.step();expect(world.ship(ship.id)!.state.status).not.toBe('flying');
 world.dispose();
});
